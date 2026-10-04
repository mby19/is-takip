import { fetchQuery, executeQuery, executeTransaction } from "./db";
import { DROP_TRIGGERS, CREATE_TRIGGERS, TRIGGER_SCHEMA_VERSION } from "../schema/triggers";
import {
  isTauri,
  saveTextFileToDownloads,
  MANUAL_BACKUP_PREFIX,
  AUTOMATIC_BACKUP_PREFIX,
} from "./tauri";
import { sqlLiteral } from "./sql";
import { APP_VERSION } from "./appInfo";
import type { AttendanceStatus, WorkerType } from "../types";

/**
 * Yedekleme dosyası biçim sürümü.
 *
 * 1 — ilk biçim (worker_rate_history yok)
 * 2 — worker_rate_history, app_version ve schema_version eklendi
 * 3 — audit_logs.reverted_at eklendi (geri alma işareti korunur)
 * 4 — worker_rate_history.id eklendi (geri alma denetim kaydıyla eşleşir)
 *
 * KURAL: Mevcut alan adları asla değiştirilmez veya kaldırılmaz, yalnızca
 * yeni alan eklenir. Böylece eski uygulama sürümleri yeni yedekleri okumaya
 * devam eder.
 *
 * Sürüm 3'te `reverted_at` ZORUNLUDUR: bu alan geri alınmış bir denetim
 * kaydını taşır. Eksik bir yedekte alan null sayılıp aynı işlemin ikinci kez
 * geri alınabilir hâle gelirdi. Bu yüzden v3 yedeklerinde eksik alan sessizce
 * doldurulmaz, yedeğin bozuk sayılıp reddedilir. v1/v2 yedekleri (geri alma
 * işareti hiç yoktu) etkilenmez.
 *
 * Sürüm 4 `worker_rate_history.id` alanını EKLER ve bu alan opsiyoneldir:
 * v1-v3 yedeklerinde yoktur ve o yedeklerde id'ler geri yükleme sırasında
 * yeniden atanır (v3'e kadar olan davranış). Alan neden gerekli:
 * `audit_logs.record_id` bu tablonun `id` değerine referans verir; id
 * yeniden atanırsa denetim kaydı başka bir çalışanın ücret geçmişine işaret
 * eder ve "Geri al" sessizce YANLIŞ satıra düşer (ya da hiçbir satıra
 * düşmez). Bu, sessiz yanlış maaştır.
 */
export const BACKUP_FORMAT_VERSION = 4;

/** Bu uygulamanın okuyabileceği en yüksek biçim sürümü. */
const MAX_SUPPORTED_VERSION = BACKUP_FORMAT_VERSION;

// Yedek dosyası adı tanıyıcıları `tauri.ts`'te yaşar: dosya listeleme ve
// dosya adı üretme aynı kaynaktan beslenmeli, yoksa liste ile üretim
// birbirinden ayrılır ve kullanıcının yedeği "yok" görünür.
export { BACKUP_FILE_PREFIXES, isBackupFileName, isAutomaticBackupFileName } from "./tauri";

const VALID_STATUSES: AttendanceStatus[] = ["FULL", "HALF", "ABSENT"];

/**
 * Kaldırılan durum → bugünkü karşılığı.
 *
 * Eski yedeklerde 'HOLIDAY' bulunabilir. Geri yükleme reddedilirse kullanıcı
 * yedeğini geri yükleyemez; bu yüzden kabul edip 'ABSENT'a çeviriyoruz
 * (db.rs v14 migration'ının yaptığı dönüşümün aynısı).
 */
const LEGACY_STATUS_MAP: Record<string, AttendanceStatus> = { HOLIDAY: "ABSENT" };
const VALID_WORKER_TYPES: WorkerType[] = ["ORTAK", "GUNLUK"];

export interface BackupSummary {
  version: number;
  exported_at: string;
  workers: number;
  attendance: number;
  daily_metrics: number;
  payments: number;
  audit_logs: number;
  worker_rate_history: number;
  closed_periods: number;
}

// ---------------------------------------------------------------------------
// Doğrulama
// ---------------------------------------------------------------------------

class BackupError extends Error {}

const asArray = (value: unknown, field: string): unknown[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new BackupError(`Yedek dosyasında "${field}" alanı liste değil.`);
  }
  return value;
};

const num = (value: unknown, field: string, row: number): number => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new BackupError(`${field} alanı geçersiz (satır ${row + 1}): ${String(value)}`);
  }
  return n;
};

const text = (value: unknown, field: string, row: number, required = true): string => {
  if (value === null || value === undefined) {
    if (required) throw new BackupError(`${field} alanı boş olamaz (satır ${row + 1}).`);
    return "";
  }
  const s = String(value);
  if (required && !s.trim()) {
    throw new BackupError(`${field} alanı boş olamaz (satır ${row + 1}).`);
  }
  return s;
};

const bool = (value: unknown): 0 | 1 => {
  if (value === true || value === 1 || value === "1" || value === "true") return 1;
  return 0;
};

/**
 * NULL olabilen metin alanı.
 *
 * `String(null)` "null" ürettiği için eski kod boş bir alanı veritabanına
 * metin olarak yazıyordu. Burada null/undefined gerçek NULL'a çevrilir; nesne,
 * dizi ve mantıksal değerler ise sessizce yutulmak yerine reddedilir.
 */
const nullableText = (value: unknown, field: string, row: number): string | null => {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") return value;
  // SQLite bir zaman damgasını sayı olarak saklamış olabilir; metne çevir.
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  throw new BackupError(
    `${field} alanı metin veya null olmalı (satır ${row + 1}): ${typeof value}`,
  );
};

interface NormalizedBackup {
  version: number;
  exported_at: string;
  workers: {
    id: number;
    name: string;
    daily_wage: number;
    worker_type: WorkerType;
    created_at: string | null;
    is_active: 0 | 1;
    color: string | null;
    short_label: string | null;
  }[];
  /**
   * `id` v1-v3 yedeklerinde yoktur; o durumda `null` gelir ve geri yüklemede
   * SQLite yeni değer atar. v4+ yedeklerinde korunur — `audit_logs.record_id`
   * bu değere referans verir ve id kayarsa "Geri al" yanlış satıra düşer.
   *
   * `created_at` yine taşınmaz: hesaplamalarda kullanılmaz.
   */
  rates: {
    id: number | null;
    worker_id: number;
    valid_from: string;
    daily_wage: number;
    worker_type: WorkerType;
  }[];
  attendance: { id: number; worker_id: number; date: string; status: AttendanceStatus }[];
  daily_metrics: {
    id: number;
    date: string;
    production_amount: number;
    total_earned: number;
    extra_expenses: number;
    is_holiday: 0 | 1;
  }[];
  payments: {
    id: number;
    worker_id: number;
    amount: number;
    date: string;
    description: string | null;
  }[];
  closed_periods: { period: string; closed_at: string | null; note: string | null }[];
  audit_logs: {
    id: number;
    action_type: string;
    entity_table: string;
    record_id: number;
    old_data: string | null;
    new_data: string | null;
    created_at: string | null;
    /** Dolu ise bu denetim kaydı geri alınmıştır. Geri yüklemeden sonra korunur. */
    reverted_at: string | null;
  }[];
}

/**
 * Yedeği doğrular ve normalleştirir.
 * Bu adımda veritabanına hiçbir şey yazılmaz — hata çıkarsa mevcut veri
 * hiç dokunulmamış olarak kalır.
 */
export function validateBackup(raw: unknown): NormalizedBackup {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new BackupError("Yedek dosyası okunamadı: beklenen JSON nesnesi bulunamadı.");
  }

  const b = raw as Record<string, unknown>;
  const version = b.version === undefined ? 1 : Number(b.version);

  if (!Number.isFinite(version) || version < 1) {
    throw new BackupError("Yedek dosyasının sürüm bilgisi geçersiz.");
  }

  if (version > MAX_SUPPORTED_VERSION) {
    throw new BackupError(
      `Bu yedek daha yeni bir uygulama sürümüyle alınmış (biçim v${version}). ` +
        `Bu kurulum en fazla v${MAX_SUPPORTED_VERSION} okuyabiliyor. ` +
        `Lütfen uygulamayı güncelleyip tekrar deneyin. Mevcut verilerinize dokunulmadı.`,
    );
  }

  if (b.workers === undefined && b.attendance === undefined && b.daily_metrics === undefined) {
    throw new BackupError("Geçersiz yedekleme dosyası formatı: veri tabloları bulunamadı.");
  }

  const workers = asArray(b.workers, "workers").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const worker_type = text(row.worker_type, "worker_type", i) as WorkerType;
    if (!VALID_WORKER_TYPES.includes(worker_type)) {
      throw new BackupError(
        `Bilinmeyen çalışan tipi "${worker_type}" (satır ${i + 1}). ` +
          `Bu yedek muhtemelen daha yeni bir sürümden geliyor.`,
      );
    }
    return {
      id: num(row.id, "workers.id", i),
      name: text(row.name, "workers.name", i),
      daily_wage: num(row.daily_wage ?? 0, "workers.daily_wage", i),
      worker_type,
      created_at: nullableText(row.created_at, "workers.created_at", i),
      is_active: bool(row.is_active ?? 1),
      color: nullableText(row.color, "workers.color", i),
      short_label: nullableText(row.short_label, "workers.short_label", i),
    };
  });

  const attendance = asArray(b.attendance, "attendance").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const raw = text(row.status, "attendance.status", i);
    const status = LEGACY_STATUS_MAP[raw] ?? (raw as AttendanceStatus);
    if (!VALID_STATUSES.includes(status)) {
      throw new BackupError(
        `Bilinmeyen puantaj durumu "${raw}" (satır ${i + 1}). ` +
          `Bu yedek muhtemelen daha yeni bir uygulama sürümünden geliyor; ` +
          `geri yükleme yapılmadı, mevcut verileriniz duruyor.`,
      );
    }
    return {
      id: num(row.id, "attendance.id", i),
      worker_id: num(row.worker_id, "attendance.worker_id", i),
      date: text(row.date, "attendance.date", i),
      status,
    };
  });

  const daily_metrics = asArray(b.daily_metrics, "daily_metrics").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      id: num(row.id, "daily_metrics.id", i),
      date: text(row.date, "daily_metrics.date", i),
      production_amount: num(row.production_amount ?? 0, "daily_metrics.production_amount", i),
      total_earned: num(row.total_earned ?? 0, "daily_metrics.total_earned", i),
      extra_expenses: num(row.extra_expenses ?? 0, "daily_metrics.extra_expenses", i),
      is_holiday: bool(row.is_holiday ?? 0),
    };
  });

  const payments = asArray(b.payments, "payments").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      id: num(row.id, "payments.id", i),
      worker_id: num(row.worker_id, "payments.worker_id", i),
      amount: num(row.amount ?? 0, "payments.amount", i),
      date: text(row.date, "payments.date", i),
      description: nullableText(row.description, "payments.description", i),
    };
  });

  // Denetim günlüğü. `reverted_at` geri alınmış kaydı işaretler; bu alan
  // yedeğe girmezse geri yükleme sonrası aynı işlem ikinci kez geri alınabilir
  // hâle gelir. Bu yüzden v3+ yedeklerinde alanın KENDİSİ bulunmalıdır —
  // null veya tarih olabilir, ama hiç yok olamaz.
  const audit_logs = asArray(b.audit_logs, "audit_logs").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    if (version >= 3 && !("reverted_at" in row)) {
      throw new BackupError(
        `audit_logs.reverted_at alanı eksik (satır ${i + 1}). ` +
          `Bu yedek bozuk — geri alma işaretleri kaybolursa aynı işlem iki kez ` +
          `geri alınabilir. Geri yükleme yapılmadı, mevcut verileriniz duruyor.`,
      );
    }
    return {
      id: num(row.id, "audit_logs.id", i),
      action_type: text(row.action_type, "audit_logs.action_type", i),
      entity_table: text(row.entity_table, "audit_logs.entity_table", i),
      record_id: num(row.record_id ?? 0, "audit_logs.record_id", i),
      old_data: nullableText(row.old_data, "audit_logs.old_data", i),
      new_data: nullableText(row.new_data, "audit_logs.new_data", i),
      created_at: nullableText(row.created_at, "audit_logs.created_at", i),
      reverted_at: nullableText(row.reverted_at, "audit_logs.reverted_at", i),
    };
  });

  // Dönem kilitleri. Eski yedeklerde bu alan yok — o zaman hiç kapalı dönem
  // yokmuş gibi yüklenir (alan ekleme geriye dönük uyumludur, bkz. ADR-0004).
  const closed_periods = asArray(b.closed_periods, "closed_periods").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      period: text(row.period, "closed_periods.period", i),
      closed_at: nullableText(row.closed_at, "closed_periods.closed_at", i),
      note: nullableText(row.note, "closed_periods.note", i),
    };
  });

  // v1 yedeklerinde ücret geçmişi yok — çalışanların güncel değerlerinden
  // açılış kaydı üretilir. Böylece eski yedekler kayıpsız yüklenir.
  const rawRates = asArray(b.worker_rate_history, "worker_rate_history");
  const rates =
    rawRates.length > 0
      ? rawRates.map((r, i) => {
          const row = (r ?? {}) as Record<string, unknown>;
          const worker_type = text(row.worker_type, "worker_rate_history.worker_type", i) as
            | WorkerType
            | "";
          return {
            // v1-v3 yedeklerinde alan yoktur; `null` gelir ve geri yüklemede
            // id'yi SQLite'a bırakır (v3'e kadarki davranış).
            id:
              row.id === undefined || row.id === null
                ? null
                : num(row.id, "worker_rate_history.id", i),
            worker_id: num(row.worker_id, "worker_rate_history.worker_id", i),
            valid_from: text(row.valid_from, "worker_rate_history.valid_from", i),
            daily_wage: num(row.daily_wage ?? 0, "worker_rate_history.daily_wage", i),
            worker_type: (VALID_WORKER_TYPES.includes(worker_type as WorkerType)
              ? worker_type
              : "GUNLUK") as WorkerType,
          };
        })
      : workers.map((w) => ({
          id: null,
          worker_id: w.id,
          valid_from: "2000-01-01",
          daily_wage: w.daily_wage,
          worker_type: w.worker_type,
        }));

  return {
    version,
    exported_at: b.exported_at === undefined ? "" : String(b.exported_at),
    workers,
    rates,
    attendance,
    daily_metrics,
    payments,
    audit_logs,
    closed_periods,
  };
}

// ---------------------------------------------------------------------------
// Dışa aktarma
// ---------------------------------------------------------------------------

/**
 * Tablo gerçekten var mı diye bakar.
 *
 * `fetchOptional` ile karıştırılmamalı: "tablo yok" ile "tablo okunamadı"
 * farklı durumlardır. İkincisi sessizce yutulursa yedek eksik çıkar ve
 * geri yükleme o eksik veriyi kalıcı olarak siler.
 */
const tableExists = async (table: string): Promise<boolean> => {
  const rows = await fetchQuery<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    [table],
  );
  return Number(rows[0]?.n ?? 0) > 0;
};

/**
 * İsteğe bağlı tablodan okur.
 *
 * Tablo YOKSA boş döner — şema onarımı açılışta bu tabloları tamamlıyor, ve
 * yedek alma eksik bir tablo yüzünden başarısız olmamalı (yedek, kullanıcının
 * verisini kurtaran son mekanizma).
 *
 * Tablo VARSA okuma hatası yutulmaz: aksi halde yedek sessizce eksik çıkar ve
 * geri yüklemede o tablo kalıcı olarak boşalır. Böyle bir hata yedek almayı
 * durdurur — mevcut veri hâlâ diskte durur, yedek alamamak onu silmez.
 */
const fetchOptional = async (table: string): Promise<unknown[]> => {
  if (!(await tableExists(table))) {
    console.warn(`[Yedek] ${table} tablosu yok, boş geçiliyor.`);
    return [];
  }
  return fetchQuery(`SELECT * FROM ${table}`);
};

/**
 * Denetim günlüğünü okur.
 *
 * `reverted_at` kolonu şema onarımı yapılamamışsa yoktur. Bu durumda her
 * satıra `reverted_at: null` yazılır — anahtar yedekte BULUNUR, yani v3
 * biçim doğrulaması geçer ve geri yükleme tutarlı kalır. Gerçek veri
 * zaten o kolon olmadan geri alınamaz durumdadır; sessizce "geri alınmamış"
 * göstermektense şemadaki bu eksikliği kayda geçiriyoruz.
 */
const fetchAuditLogs = async (): Promise<Record<string, unknown>[]> => {
  const rows = await fetchQuery<Record<string, unknown>>("SELECT * FROM audit_logs");
  const hasRevertColumn =
    rows.length === 0 || Object.prototype.hasOwnProperty.call(rows[0], "reverted_at");
  if (hasRevertColumn) return rows;

  console.error(
    "[Yedek] audit_logs.reverted_at kolonu yok. Geri alma işaretleri yedeğe " +
      "giremiyor; yedekten geri yükleme geri alma korumasını kaybettirir.",
  );
  return rows.map((row) => ({ ...row, reverted_at: null }));
};

const buildBackupJson = async (): Promise<{ json: string; summary: BackupSummary }> => {
  const workers = await fetchQuery("SELECT * FROM workers");
  const attendance = await fetchQuery("SELECT * FROM attendance");
  const daily_metrics = await fetchQuery("SELECT * FROM daily_metrics");
  const payments = await fetchQuery("SELECT * FROM payments");
  const audit_logs = await fetchAuditLogs();
  const worker_rate_history = await fetchOptional("worker_rate_history");
  const closed_periods = await fetchOptional("closed_periods");

  const exported_at = new Date().toISOString();
  const backup = {
    version: BACKUP_FORMAT_VERSION,
    app_version: APP_VERSION,
    schema_version: TRIGGER_SCHEMA_VERSION,
    exported_at,
    workers,
    worker_rate_history,
    attendance,
    daily_metrics,
    payments,
    audit_logs,
    closed_periods,
  };

  return {
    json: JSON.stringify(backup, null, 2),
    summary: {
      version: BACKUP_FORMAT_VERSION,
      exported_at,
      workers: workers.length,
      worker_rate_history: worker_rate_history.length,
      attendance: attendance.length,
      daily_metrics: daily_metrics.length,
      payments: payments.length,
      audit_logs: audit_logs.length,
      closed_periods: closed_periods.length,
    },
  };
};

const timestampedName = (prefix: string) => {
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
  return `${prefix}${dateStr}_${timeStr}.json`;
};

const writeBackupFile = async (fileName: string, json: string): Promise<string> => {
  if (isTauri()) {
    await saveTextFileToDownloads(fileName, json);
    try {
      const { downloadDir, join } = await import("@tauri-apps/api/path");
      return await join(await downloadDir(), fileName);
    } catch {
      return fileName;
    }
  }

  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  return fileName;
};

/** Kullanıcı tarafından başlatılan yedek alma. */
export const exportDatabase = async (): Promise<string> => {
  const { json } = await buildBackupJson();
  const fileName = timestampedName(MANUAL_BACKUP_PREFIX);

  const fullPath = await writeBackupFile(fileName, json);

  // Kayıt yalnızca dosya gerçekten yazıldıysa atılır.
  await executeQuery(
    "INSERT INTO audit_logs (action_type, entity_table, record_id, new_data) VALUES (?, ?, ?, ?)",
    [
      "EXPORT",
      "backup",
      0,
      JSON.stringify({ file: fileName, exported_at: new Date().toISOString() }),
    ],
  );

  return fullPath;
};

/** Geri yükleme öncesi otomatik güvenlik yedeği. */
export const createSafetyBackup = async (): Promise<string> => {
  const { json } = await buildBackupJson();
  const fileName = timestampedName(AUTOMATIC_BACKUP_PREFIX);
  return writeBackupFile(fileName, json);
};

// ---------------------------------------------------------------------------
// İçe aktarma
// ---------------------------------------------------------------------------

/** Çok satırlı INSERT'leri parçalara böler — tek dev ifade yerine makul boyutlar. */
function chunkedInsert(table: string, columns: string[], rows: unknown[][], size = 400): string[] {
  const statements: string[] = [];
  for (let i = 0; i < rows.length; i += size) {
    const slice = rows.slice(i, i + size);
    const values = slice.map((r) => `(${r.map(sqlLiteral).join(", ")})`).join(", ");
    // OR ROLLBACK: bir kısıt ihlali TÜM transaction'ı geri alır. Aksi halde
    // SQLite yalnızca hatalı ifadeyi geri alır ve transaction açık kalır.
    statements.push(`INSERT OR ROLLBACK INTO ${table} (${columns.join(", ")}) VALUES ${values}`);
  }
  return statements;
}

export interface ImportResult {
  summary: BackupSummary;
  safetyBackupPath: string;
}

/**
 * Yedekten geri yükler.
 *
 * Sıra önemlidir ve bilerek şöyledir:
 *  1. Doğrula (hiçbir şey silinmeden)
 *  2. Mevcut verinin otomatik yedeğini al
 *  3. Silme + yazma işlemlerinin TAMAMINI tek transaction'da uygula
 *
 * Üçüncü adım ya tamamen uygulanır ya hiç uygulanmaz; ikinci adım ise
 * beklenmedik bir durumda elle dönüş imkânı bırakır.
 *
 * YABANCI ANAHTAR SIRASI (doğrulanmış):
 *  Silme: çocuk → ebeveyn. `attendance`, `payments` ve `worker_rate_history`
 *  `workers(id)` yabancı anahtarı taşır; bu yüzden `workers` en SON silinir.
 *  Yazma: ebeveyn → çocuk. `workers` önce yazılır, FK'si ona bağlı tablolar
 *  sonra. `closed_periods` yabancı anahtarı yoktur ama sona bırakıldı.
 *
 * TETİKLEYİCİLER: yazma sırasında denetim tetikleyicileri açık olsaydı her
 * satır için ek denetim kaydı üretilir ve yedekten gelen geçmiş, yeni
 * INSERT/UPDATE kayıtlarıyla kirlenirdi. Bu yüzden önce düşürülüyor, veri
 * yazıldıktan sonra geri kuruluyor. `DROP_TRIGGERS` transaction içinde
 * olduğu için bir hata olursa tetikleyiciler de eski hâline döner.
 */
export const importDatabase = async (jsonString: string): Promise<ImportResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new BackupError("Yedek dosyası geçerli bir JSON değil. Dosya bozulmuş olabilir.");
  }

  const data = validateBackup(parsed);

  // Güvenlik yedeği yazılamazsa geri yükleme HİÇ başlamaz: transaction'a
  // girilmeden hata fırlatılır, mevcut veri yerinde kalır. Kullanıcıya
  // neden olduğunu açıkça söylüyoruz — sessizce devam etmek, güvenlik ağı
  // olmadan veri silmek demektir.
  let safetyBackupPath: string;
  try {
    safetyBackupPath = await createSafetyBackup();
  } catch (err: unknown) {
    throw new BackupError(
      "Geri yükleme öncesi güvenlik yedeği alınamadı, bu yüzden geri yükleme " +
        "başlatılmadı; mevcut verileriniz olduğu gibi duruyor. " +
        `Yedekleme klasörünün yazılabilir olduğundan emin olup tekrar deneyin. (${
          err instanceof Error ? err.message : String(err)
        })`,
    );
  }

  const statements: string[] = [
    ...DROP_TRIGGERS,

    "DELETE FROM audit_logs",
    "DELETE FROM attendance",
    "DELETE FROM payments",
    "DELETE FROM daily_metrics",
    "DELETE FROM worker_rate_history",
    "DELETE FROM closed_periods",
    "DELETE FROM workers",
    "DELETE FROM sqlite_sequence WHERE name IN ('workers', 'attendance', 'payments', 'daily_metrics', 'audit_logs', 'worker_rate_history')",

    ...chunkedInsert(
      "workers",
      [
        "id",
        "name",
        "daily_wage",
        "worker_type",
        "created_at",
        "is_active",
        "color",
        "short_label",
      ],
      data.workers.map((w) => [
        w.id,
        w.name,
        w.daily_wage,
        w.worker_type,
        w.created_at,
        w.is_active,
        w.color,
        w.short_label,
      ]),
    ),

    // `id` yedekte varsa korunur: `audit_logs.record_id` bu değere referans
    // verir. Yoksa (v1-v3) kolon dışarıda bırakılır ve SQLite atar.
    ...(data.rates.every((r) => r.id !== null)
      ? chunkedInsert(
          "worker_rate_history",
          ["id", "worker_id", "valid_from", "daily_wage", "worker_type"],
          data.rates.map((r) => [r.id, r.worker_id, r.valid_from, r.daily_wage, r.worker_type]),
        )
      : chunkedInsert(
          "worker_rate_history",
          ["worker_id", "valid_from", "daily_wage", "worker_type"],
          data.rates.map((r) => [r.worker_id, r.valid_from, r.daily_wage, r.worker_type]),
        )),

    ...chunkedInsert(
      "attendance",
      ["id", "worker_id", "date", "status"],
      data.attendance.map((a) => [a.id, a.worker_id, a.date, a.status]),
    ),

    ...chunkedInsert(
      "daily_metrics",
      ["id", "date", "production_amount", "total_earned", "extra_expenses", "is_holiday"],
      data.daily_metrics.map((m) => [
        m.id,
        m.date,
        m.production_amount,
        m.total_earned,
        m.extra_expenses,
        m.is_holiday,
      ]),
    ),

    ...chunkedInsert(
      "payments",
      ["id", "worker_id", "amount", "date", "description"],
      data.payments.map((p) => [p.id, p.worker_id, p.amount, p.date, p.description]),
    ),

    ...chunkedInsert(
      "audit_logs",
      [
        "id",
        "action_type",
        "entity_table",
        "record_id",
        "old_data",
        "new_data",
        "created_at",
        "reverted_at",
      ],
      data.audit_logs.map((l) => [
        l.id,
        l.action_type,
        l.entity_table,
        l.record_id,
        l.old_data,
        l.new_data,
        l.created_at,
        l.reverted_at,
      ]),
    ),

    ...chunkedInsert(
      "closed_periods",
      ["period", "closed_at", "note"],
      data.closed_periods.map((c) => [c.period, c.closed_at, c.note]),
    ),

    ...CREATE_TRIGGERS,
    `PRAGMA user_version = ${TRIGGER_SCHEMA_VERSION}`,

    `INSERT INTO audit_logs (action_type, entity_table, record_id, new_data) VALUES ('IMPORT', 'backup', 0, ${sqlLiteral(
      JSON.stringify({
        imported_at: new Date().toISOString(),
        format_version: data.version,
        workers: data.workers.length,
        attendance: data.attendance.length,
      }),
    )})`,
  ];

  // Transaction ya tamamen uygulanır ya hiç uygulanmaz. Hata olursa veri eski
  // hâlindedir; yine de kullanıcıya elle dönüş yolunu söylüyoruz.
  try {
    await executeTransaction(statements);
  } catch (err: unknown) {
    throw new BackupError(
      `Geri yükleme uygulanamadı, verileriniz değişmedi. ` +
        `Gerekirse geri yüklemeden hemen önce alınan güvenlik yedeğini ` +
        `kullanabilirsiniz: ${safetyBackupPath} ` +
        `(${err instanceof Error ? err.message : String(err)})`,
    );
  }

  return {
    safetyBackupPath,
    summary: {
      version: data.version,
      exported_at: data.exported_at,
      workers: data.workers.length,
      worker_rate_history: data.rates.length,
      attendance: data.attendance.length,
      daily_metrics: data.daily_metrics.length,
      payments: data.payments.length,
      audit_logs: data.audit_logs.length,
      closed_periods: data.closed_periods.length,
    },
  };
};

/** Yedek dosyasının içeriğini yüklemeden özetler (onay ekranı için). */
export function summarizeBackupFile(jsonString: string): BackupSummary {
  const data = validateBackup(JSON.parse(jsonString));
  return {
    version: data.version,
    exported_at: data.exported_at,
    workers: data.workers.length,
    worker_rate_history: data.rates.length,
    attendance: data.attendance.length,
    daily_metrics: data.daily_metrics.length,
    payments: data.payments.length,
    audit_logs: data.audit_logs.length,
    closed_periods: data.closed_periods.length,
  };
}
