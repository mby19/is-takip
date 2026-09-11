import { fetchQuery, executeQuery, executeTransaction } from "./db";
import { DROP_TRIGGERS, CREATE_TRIGGERS, TRIGGER_SCHEMA_VERSION } from "../schema/triggers";
import { isTauri, saveTextFileToDownloads } from "./tauri";
import { sqlLiteral } from "./sql";
import { APP_VERSION } from "./appInfo";
import type { AttendanceStatus, WorkerType } from "../types";

/**
 * Yedekleme dosyası biçim sürümü.
 *
 * 1 — ilk biçim (worker_rate_history yok)
 * 2 — worker_rate_history, app_version ve schema_version eklendi
 *
 * KURAL: Mevcut alan adları asla değiştirilmez veya kaldırılmaz, yalnızca
 * yeni alan eklenir. Böylece eski uygulama sürümleri yeni yedekleri okumaya
 * devam edebilir.
 */
export const BACKUP_FORMAT_VERSION = 2;

/** Bu uygulamanın okuyabileceği en yüksek biçim sürümü. */
const MAX_SUPPORTED_VERSION = BACKUP_FORMAT_VERSION;

const VALID_STATUSES: AttendanceStatus[] = ["FULL", "HALF", "ABSENT", "HOLIDAY"];
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
  }[];
  rates: {
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
  audit_logs: {
    id: number;
    action_type: string;
    entity_table: string;
    record_id: number;
    old_data: string | null;
    new_data: string | null;
    created_at: string | null;
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
      created_at: row.created_at === undefined ? null : String(row.created_at),
      is_active: bool(row.is_active ?? 1),
    };
  });

  const attendance = asArray(b.attendance, "attendance").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    const status = text(row.status, "attendance.status", i) as AttendanceStatus;
    if (!VALID_STATUSES.includes(status)) {
      throw new BackupError(
        `Bilinmeyen puantaj durumu "${status}" (satır ${i + 1}). ` +
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
      description:
        row.description === null || row.description === undefined ? null : String(row.description),
    };
  });

  const audit_logs = asArray(b.audit_logs, "audit_logs").map((r, i) => {
    const row = (r ?? {}) as Record<string, unknown>;
    return {
      id: num(row.id, "audit_logs.id", i),
      action_type: text(row.action_type, "audit_logs.action_type", i),
      entity_table: text(row.entity_table, "audit_logs.entity_table", i),
      record_id: num(row.record_id ?? 0, "audit_logs.record_id", i),
      old_data: row.old_data === null || row.old_data === undefined ? null : String(row.old_data),
      new_data: row.new_data === null || row.new_data === undefined ? null : String(row.new_data),
      created_at: row.created_at === undefined ? null : String(row.created_at),
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
            worker_id: num(row.worker_id, "worker_rate_history.worker_id", i),
            valid_from: text(row.valid_from, "worker_rate_history.valid_from", i),
            daily_wage: num(row.daily_wage ?? 0, "worker_rate_history.daily_wage", i),
            worker_type: (VALID_WORKER_TYPES.includes(worker_type as WorkerType)
              ? worker_type
              : "GUNLUK") as WorkerType,
          };
        })
      : workers.map((w) => ({
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
  };
}

// ---------------------------------------------------------------------------
// Dışa aktarma
// ---------------------------------------------------------------------------

const buildBackupJson = async (): Promise<{ json: string; summary: BackupSummary }> => {
  const workers = await fetchQuery("SELECT * FROM workers");
  const worker_rate_history = await fetchQuery("SELECT * FROM worker_rate_history");
  const attendance = await fetchQuery("SELECT * FROM attendance");
  const daily_metrics = await fetchQuery("SELECT * FROM daily_metrics");
  const payments = await fetchQuery("SELECT * FROM payments");
  const audit_logs = await fetchQuery("SELECT * FROM audit_logs");

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
  const fileName = timestampedName("is_takip_backup_");

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
  const fileName = timestampedName("is_takip_otomatik_yedek_");
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
 */
export const importDatabase = async (jsonString: string): Promise<ImportResult> => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonString);
  } catch {
    throw new BackupError("Yedek dosyası geçerli bir JSON değil. Dosya bozulmuş olabilir.");
  }

  const data = validateBackup(parsed);

  const safetyBackupPath = await createSafetyBackup();

  const statements: string[] = [
    ...DROP_TRIGGERS,

    "DELETE FROM audit_logs",
    "DELETE FROM attendance",
    "DELETE FROM payments",
    "DELETE FROM daily_metrics",
    "DELETE FROM worker_rate_history",
    "DELETE FROM workers",
    "DELETE FROM sqlite_sequence WHERE name IN ('workers', 'attendance', 'payments', 'daily_metrics', 'audit_logs', 'worker_rate_history')",

    ...chunkedInsert(
      "workers",
      ["id", "name", "daily_wage", "worker_type", "created_at", "is_active"],
      data.workers.map((w) => [
        w.id,
        w.name,
        w.daily_wage,
        w.worker_type,
        w.created_at,
        w.is_active,
      ]),
    ),

    ...chunkedInsert(
      "worker_rate_history",
      ["worker_id", "valid_from", "daily_wage", "worker_type"],
      data.rates.map((r) => [r.worker_id, r.valid_from, r.daily_wage, r.worker_type]),
    ),

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
      ["id", "action_type", "entity_table", "record_id", "old_data", "new_data", "created_at"],
      data.audit_logs.map((l) => [
        l.id,
        l.action_type,
        l.entity_table,
        l.record_id,
        l.old_data,
        l.new_data,
        l.created_at,
      ]),
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

  await executeTransaction(statements);

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
  };
}
