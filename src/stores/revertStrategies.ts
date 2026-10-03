import { fetchQuery } from "../lib/db";
import { sqlLiteral } from "../lib/sql";
import type { AuditLog } from "../types";
import { parseLogData, parseAttendanceSnapshot } from "../utils/parseLogData";
import { REVERTABLE_TABLES } from "../utils/auditLogFormat";

export { REVERTABLE_TABLES };

/**
 * Tablo başına denetim kaydındaki tarih alanı.
 *
 * Dönem kilidi kontrolü bu alana bakar; alan eksikse geri alma **reddedilir**
 * (fail-closed). `workers` satırında tarih yoktur — dönem kilidi oraya
 * uygulanmaz, çünkü çalışan kaydı tek bir güne ait değildir.
 */
const DATE_FIELD: Record<string, string> = {
  attendance: "date",
  daily_metrics: "date",
  payments: "date",
  worker_rate_history: "valid_from",
};

export interface RevertContext {
  log: AuditLog;
  oldData: Record<string, string> | null;
  newData: Record<string, string> | null;
}

/**
 * Geri alma stratejisi.
 *
 * `execute` doğrudan yazmaz; uygulanacak SQL ifadelerini üretir. Çağıran taraf
 * bunların tamamını TEK bir transaction içinde çalıştırır — böylece geri alma
 * yarıda kalıp tutarsız duruma yol açamaz.
 */
export interface RevertStrategy {
  execute(ctx: RevertContext): Promise<string[]>;

  /**
   * Bu geri alma İKİNCİ bir tabloya dokunuyorsa, o tablonun tarih alanından
   * gelen tarihler. `workers` UPDATE'i `worker_rate_history` satırını
   * siliyordu ama `workers` kaydında tarih alanı olmadığı için dönem kilidi
   * hiç çalışmıyordu: kapalı bir dönemin ücret geçmişi sessizce siliniyordu.
   *
   * Tarih çözülemiyorsa **istisna fırlatılır** — sessizce boş dönmek
   * fail-closed'i deler.
   */
  resolveAffectedDates?(ctx: RevertContext): Promise<string[]>;
}

// ---------------------------------------------------------------------------
// Sayısal alan doğrulama
// ---------------------------------------------------------------------------

/**
 * Denetim kaydındaki sayısal alanı çözer.
 *
 * Neden şart: `old_data` JSON'u elle düzenlenmiş ya da bozuk olabilir.
 * `parseInt("abc")` → NaN üretir ve `sqlLiteral` NaN'yı zaten reddeder —
 * ama hata o noktada, transaction'ın ortasında ve neyi bozduğu belirsiz
 * biçimde çıkar. Burada fail-closed: işlem başlamadan reddet.
 */
function requiredNumber(raw: string | undefined, label: string): number {
  const n = Number(raw);
  if (raw === undefined || raw === null || String(raw).trim() === "" || !Number.isFinite(n)) {
    throw new Error(`Denetim kaydında geçersiz ${label}: "${String(raw)}"`);
  }
  return n;
}

function requiredInt(raw: string | undefined, label: string): number {
  const n = requiredNumber(raw, label);
  if (!Number.isInteger(n)) throw new Error(`Denetim kaydında tamsayı olmayan ${label}: "${raw}"`);
  return n;
}

/**
 * Eski kayıtlarda alan bulunmayabilir; o durumda `fallback` kullanılır.
 * Alan VARSA geçersizse sessizce yutulmaz.
 */
function optionalNumber(raw: string | undefined, label: string, fallback = 0): number {
  if (raw === undefined || raw === null || String(raw).trim() === "") return fallback;
  return requiredNumber(raw, label);
}

function optionalInt(raw: string | undefined, label: string, fallback = 0): number {
  const n = optionalNumber(raw, label, fallback);
  return Number.isInteger(n) ? n : Math.trunc(n);
}

interface AttendanceEntry {
  id: number;
  status: string;
}

/** İsimden çalışan id'si çözer (eski loglarda worker_id bulunmayabilir). */
async function resolveWorkerId(data: Record<string, string> | null): Promise<number | null> {
  const direct = data?.worker_id ? Number(data.worker_id) : null;
  if (direct !== null && Number.isInteger(direct) && direct > 0) return direct;

  const name = data?.worker_name;
  if (!name) return null;

  const rows = await fetchQuery<{ id: number }>("SELECT id FROM workers WHERE name = ?", [name]);
  return rows.length > 0 ? rows[0].id : null;
}

/** Anlık görüntüde olmayan çalışan "YOK" demektir — puantaj kaydı yoktur. */
const NO_RECORD = "YOK";

// ---------------------------------------------------------------------------
// INSERT (kaydı eklemeyi geri al)
// ---------------------------------------------------------------------------

/**
 * O güne ait puantajı, yalnızca bu işlemin bıraktığı satırlara indir.
 *
 * `status = <snapshot>` koşulu bilinçlidir: gün kaydından sonra o kişinin
 * puantajı ayrı bir işlemle değiştirildiyse bu geri alma onu silmez.
 * Kapsam dışı satırlara dokunmak, geri almayı veri kaybına çevirirdi.
 */
function deleteAttendanceFromSnapshot(entries: AttendanceEntry[], date: string): string[] {
  return entries
    .filter((entry) => entry.status !== NO_RECORD)
    .map(
      (entry) =>
        `DELETE FROM attendance WHERE worker_id = ${sqlLiteral(entry.id)} AND date = ${sqlLiteral(date)} AND status = ${sqlLiteral(entry.status)}`,
    );
}

const insertStrategy: RevertStrategy = {
  async execute({ log, newData }: RevertContext) {
    if (!REVERTABLE_TABLES.includes(log.entity_table)) {
      throw new Error("Bu tablo için silme desteklenmiyor.");
    }

    const statements: string[] = [];

    // Günlük veri kaydı eklenmesini geri alırken o güne ait puantaj da geri alınır.
    // Önceden `DELETE FROM attendance WHERE date = X` idi: günün TÜM
    // puantajını silip, başka işlemlerle yazılmış kayıtları da yok ediyordu.
    if (log.entity_table === "daily_metrics") {
      const date = newData?.date;
      if (!date) throw new Error("Gün verisi tarihi bulunamadı.");

      const entries = parseAttendanceSnapshot(newData.atts);
      if (entries.length === 0) {
        throw new Error(
          "Bu gün kaydında puantaj anlık görüntüsü yok; hangi satırların silineceği bilinemiyor.",
        );
      }
      statements.push(...deleteAttendanceFromSnapshot(entries, date));
    }

    statements.push(`DELETE FROM ${log.entity_table} WHERE id = ${sqlLiteral(log.record_id)}`);
    return statements;
  },
};

// ---------------------------------------------------------------------------
// UPDATE
// ---------------------------------------------------------------------------

const updateAttendanceStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const status = oldData?.status;
    if (!status) throw new Error("Önceki durum bilgisi bulunamadı.");

    const workerId = await resolveWorkerId(oldData);

    // Kayıt hâlâ duruyorsa güncelle; silinmişse tarih + çalışandan yeniden kur.
    // NOT: DELETE değil UPSERT. `attendance.upsert` `INSERT OR REPLACE`
    // kullanmaz (bkz. attendanceRepository) — bir puantaj değişikliği bu
    // yüzden UPDATE olarak denetlenir ve geri alma önceki değeri yazar.
    if (!workerId || !oldData?.date) {
      return [
        `UPDATE OR ROLLBACK attendance SET status = ${sqlLiteral(status)} WHERE id = ${sqlLiteral(log.record_id)}`,
      ];
    }

    return [
      `INSERT OR ROLLBACK INTO attendance (worker_id, date, status) VALUES (${sqlLiteral(workerId)}, ${sqlLiteral(oldData.date)}, ${sqlLiteral(status)})
         ON CONFLICT(worker_id, date) DO UPDATE SET status = excluded.status`,
    ];
  },
};

const updatePaymentsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const date = oldData?.date;
    if (!date) throw new Error("Önceki ödeme bilgileri eksik.");

    const amount = requiredNumber(oldData.amount, "ödeme tutarı");
    const description = oldData.description || null;

    return [
      `UPDATE OR ROLLBACK payments SET amount = ${sqlLiteral(amount)}, date = ${sqlLiteral(date)}, description = ${sqlLiteral(description)} WHERE id = ${sqlLiteral(log.record_id)}`,
    ];
  },
};

const updateWorkerRateHistoryStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const validFrom = oldData?.valid_from;
    if (!validFrom) throw new Error("Önceki ücret geçmişi tarihi eksik.");

    const wage = requiredNumber(oldData.wage, "yevmiye");
    const type = oldData.type || oldData.worker_type;
    if (!type) throw new Error("Önceki çalışan tipi eksik.");

    return [
      `UPDATE OR ROLLBACK worker_rate_history SET valid_from = ${sqlLiteral(validFrom)}, daily_wage = ${sqlLiteral(wage)}, worker_type = ${sqlLiteral(type)} WHERE id = ${sqlLiteral(log.record_id)}`,
    ];
  },
};

/**
 * Gün verisi UPDATE'inde puantaj anlık görüntüsünü geri yükler.
 *
 * Yalnızca ESKİ ve YENİ anlık görüntü arasında durumu DEĞİŞEN çalışanlara
 * dokunur. Önceden tüm anlık görüntü işleniyordu: 'YOK' olan herkes için
 * `DELETE FROM attendance` üretiliyor, yani bu gün verisi kaydıyla ilgisi
 * olmayan puantajlar da siliniyordu.
 */
function attendanceDiffStatements(
  before: AttendanceEntry[],
  after: AttendanceEntry[],
  date: string,
): string[] {
  const beforeById = new Map(before.map((entry) => [entry.id, entry.status]));
  const statements: string[] = [];

  for (const entry of after) {
    const previous = beforeById.get(entry.id) ?? NO_RECORD;
    if (previous === entry.status) continue;

    if (previous === NO_RECORD) {
      // Bu işlem kaydı oluşturmuştu; yalnızca hâlâ aynı durumdaysa silinir.
      statements.push(
        `DELETE FROM attendance WHERE worker_id = ${sqlLiteral(entry.id)} AND date = ${sqlLiteral(date)} AND status = ${sqlLiteral(entry.status)}`,
      );
      continue;
    }

    // Önce kayıt vardı: önceki durum geri yazılır (UPSERT, silme değil).
    statements.push(
      `INSERT OR ROLLBACK INTO attendance (worker_id, date, status) VALUES (${sqlLiteral(entry.id)}, ${sqlLiteral(date)}, ${sqlLiteral(previous)})
         ON CONFLICT(worker_id, date) DO UPDATE SET status = excluded.status`,
    );
  }

  return statements;
}

interface AttendanceEntry {
  id: number;
  status: string;
}

const updateDailyMetricsStrategy: RevertStrategy = {
  async execute({ log, oldData, newData }: RevertContext) {
    if (!oldData?.date) {
      if (oldData?.production) {
        return [
          `UPDATE OR ROLLBACK daily_metrics SET production_amount = ${sqlLiteral(requiredInt(oldData.production, "üretim miktarı"))} WHERE id = ${sqlLiteral(log.record_id)}`,
        ];
      }
      throw new Error("Önceki üretim verisi bulunamadı.");
    }

    const pAmt = requiredInt(
      oldData.production || oldData.production_amount || "0",
      "üretim miktarı",
    );
    const tEarned = optionalNumber(oldData.earned || oldData.total_earned, "kazanç", 0);
    const eExp = optionalNumber(oldData.expenses || oldData.extra_expenses, "gider", 0);
    const isHol = optionalInt(oldData.holiday || oldData.is_holiday, "tatil", 0);

    const statements = [
      `UPDATE OR ROLLBACK daily_metrics SET production_amount = ${sqlLiteral(pAmt)}, total_earned = ${sqlLiteral(tEarned)}, extra_expenses = ${sqlLiteral(eExp)}, is_holiday = ${sqlLiteral(isHol)} WHERE id = ${sqlLiteral(log.record_id)}`,
    ];

    const before = parseAttendanceSnapshot(oldData.atts);
    const after = parseAttendanceSnapshot(newData?.atts);
    if (before.length > 0 && after.length > 0) {
      statements.push(...attendanceDiffStatements(before, after, oldData.date));
    }

    return statements;
  },
};

/** Ücret değişikliği geri alınırken dokunulan `worker_rate_history` satırı. */
interface ChangedRateRow {
  action: string;
  recordId: number;
  /** Satırın `valid_from` tarihi — dönem kilidi kontrolü bunu kullanır. */
  validFrom: string;
}

/**
 * Bu `workers` UPDATE'inin `worker_rate_history`'de hangi satırı değiştirdiğini
 * bulur.
 *
 * `valid_from` workers denetim kaydında YOKTUR: trigger `workers` tablosunu
 * okur, ücret geçmişi yazımı ise `workerStore.updateWorker` içinde hemen
 * sonra ayrı bir SQL çağrısıyla yapılır. Tahmin yürütmek (ör. "en yeni satır")
 * geçmişe dönük ücret değişikliklerinde YANLIŞ satırı geri alır; o yüzden
 * eşleşen ücret geçmişi denetim kaydından okunur. Bulunamazsa işlem reddedilir.
 */
async function findChangedRateRow(
  workerId: number,
  newWage: number,
  newType: string,
): Promise<ChangedRateRow | null> {
  const rows = await fetchQuery<{
    action_type: string;
    record_id: number;
    valid_from: string | null;
  }>(
    `SELECT action_type, record_id, json_extract(new_data, '$.valid_from') AS valid_from
       FROM audit_logs
       WHERE entity_table = 'worker_rate_history'
         AND action_type IN ('INSERT', 'UPDATE')
         AND reverted_at IS NULL
         AND new_data LIKE '{%'
         AND json_extract(new_data, '$.worker_id') = ?
         AND json_extract(new_data, '$.wage') = ?
         AND json_extract(new_data, '$.type') = ?
       ORDER BY id DESC
       LIMIT 1`,
    [workerId, newWage, newType],
  );
  if (rows.length === 0) return null;
  return {
    action: rows[0].action_type,
    recordId: rows[0].record_id,
    validFrom: rows[0].valid_from ?? "",
  };
}

const updateWorkersStrategy: RevertStrategy = {
  /**
   * `workers` kaydında tarih alanı yok; ücret geçmişi satırının `valid_from`
   * tarihi kilit kontrolüne girer. Ücret değişmediyse ikinci tabloya da
   * dokunulmuyor, tarih de getirilmiyor.
   */
  async resolveAffectedDates({ log, oldData, newData }: RevertContext) {
    const workerId = requiredInt(String(log.record_id), "çalışan id");
    const type = oldData?.type || oldData?.worker_type;
    const oldWageRaw = oldData?.wage ?? oldData?.daily_wage;
    const newWageRaw = newData?.wage ?? newData?.daily_wage;
    const newType = newData?.type || newData?.worker_type;
    const wageChanged = oldWageRaw !== newWageRaw || type !== newType;
    if (!wageChanged) return [];

    if (!newWageRaw || !newType) {
      throw new Error("Değişen ücret bilgisi bulunamadı; ücret geçmişi geri alınamıyor.");
    }
    const changed = await findChangedRateRow(
      workerId,
      requiredNumber(newWageRaw, "değişen yevmiye"),
      newType,
    );
    if (!changed) {
      throw new Error(
        "Bu ücret değişikliğine ait ücret geçmişi kaydı bulunamadı; geri alma durduruldu.",
      );
    }
    if (!changed.validFrom) {
      // Tarih bilinmeden kilit kontrolü yapılamaz — sessizce geçmek
      // fail-closed'i deler, bu yüzden reddedilir.
      throw new Error(
        "Ücret geçmişi tarihi okunamadı; kapalı dönem kontrolü yapılamadığı için geri alma durduruldu.",
      );
    }
    return [changed.validFrom];
  },
  async execute({ log, oldData, newData }: RevertContext) {
    const name = oldData?.name;
    const type = oldData?.type || oldData?.worker_type;
    if (!name || !type) throw new Error("Önceki çalışan bilgileri eksik.");

    const workerId = requiredInt(String(log.record_id), "çalışan id");
    const wage = requiredNumber(oldData?.wage || oldData?.daily_wage, "yevmiye");
    const isActive = optionalInt(oldData?.is_active, "aktiflik", 1);

    const statements = [
      `UPDATE OR ROLLBACK workers SET name = ${sqlLiteral(name)}, worker_type = ${sqlLiteral(type)}, daily_wage = ${sqlLiteral(wage)}, is_active = ${sqlLiteral(isActive)} WHERE id = ${sqlLiteral(workerId)}`,
    ];

    // Ücret değişmediyse ücret geçmişinde de bir şey değişmemiştir.
    const oldWageRaw = oldData?.wage ?? oldData?.daily_wage;
    const newWageRaw = newData?.wage ?? newData?.daily_wage;
    const newType = newData?.type || newData?.worker_type;
    const wageChanged = oldWageRaw !== newWageRaw || type !== newType;
    if (!wageChanged) return statements;

    // Ekran workers.daily_wage'i gösterir, hesaplama ise worker_rate_history
    // kaydını kullanır. Yalnız workers'ı geri almak, ekranda 1000 görünürken
    // ocak ayını 1500'ten hesaplamaya devam eder — sessiz yanlış maaş.
    if (!newWageRaw || !newType) {
      throw new Error("Değişen ücret bilgisi bulunamadı; ücret geçmişi geri alınamıyor.");
    }
    const newWage = requiredNumber(newWageRaw, "değişen yevmiye");
    const changed = await findChangedRateRow(workerId, newWage, newType);
    if (!changed) {
      throw new Error(
        "Bu ücret değişikliğine ait ücret geçmişi kaydı bulunamadı; geri alma durduruldu.",
      );
    }

    if (changed.action === "INSERT") {
      // Yeni eklenmiş geçmiş satırı: değişiklikten önce yoktu, silinmeli.
      statements.push(`DELETE FROM worker_rate_history WHERE id = ${sqlLiteral(changed.recordId)}`);
    } else {
      statements.push(
        `UPDATE OR ROLLBACK worker_rate_history SET daily_wage = ${sqlLiteral(wage)}, worker_type = ${sqlLiteral(type)} WHERE id = ${sqlLiteral(changed.recordId)}`,
      );
    }

    return statements;
  },
};

// ---------------------------------------------------------------------------
// DELETE (silmeyi geri al)
// ---------------------------------------------------------------------------

const deleteAttendanceStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const status = oldData?.status;
    const date = oldData?.date;
    if (!status || !date) throw new Error("Silinen çalışma durumu bilgileri eksik.");

    const workerId = await resolveWorkerId(oldData);
    if (!workerId) throw new Error("Çalışan bilgisi bulunamadı.");

    return [
      `INSERT OR ROLLBACK INTO attendance (id, worker_id, date, status) VALUES (${sqlLiteral(log.record_id)}, ${sqlLiteral(workerId)}, ${sqlLiteral(date)}, ${sqlLiteral(status)})
         ON CONFLICT(worker_id, date) DO UPDATE SET status = excluded.status`,
    ];
  },
};

const deletePaymentsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const date = oldData?.date;
    if (!date) throw new Error("Silinen ödeme bilgileri eksik.");

    const workerId = await resolveWorkerId(oldData);
    if (!workerId) throw new Error("Silinen ödemenin çalışanı bulunamadı.");

    const amount = requiredNumber(oldData.amount, "ödeme tutarı");
    const description = oldData.description || null;

    return [
      `INSERT OR ROLLBACK INTO payments (id, worker_id, amount, date, description) VALUES (${sqlLiteral(log.record_id)}, ${sqlLiteral(workerId)}, ${sqlLiteral(amount)}, ${sqlLiteral(date)}, ${sqlLiteral(description)})`,
    ];
  },
};

const deleteWorkersStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const name = oldData?.name;
    const type = oldData?.type || oldData?.worker_type;
    if (!name || !type) throw new Error("Silinen çalışan bilgileri eksik.");

    const wage = requiredNumber(oldData?.wage || oldData?.daily_wage, "yevmiye");
    const isActive = optionalInt(oldData?.is_active, "aktiflik", 1);

    return [
      `INSERT OR ROLLBACK INTO workers (id, name, daily_wage, worker_type, is_active) VALUES (${sqlLiteral(log.record_id)}, ${sqlLiteral(name)}, ${sqlLiteral(wage)}, ${sqlLiteral(type)}, ${sqlLiteral(isActive)})`,
    ];
  },
};

const deleteDailyMetricsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const date = oldData?.date;
    if (!date) throw new Error("Silinen günlük veri tarihi eksik.");

    const production = requiredInt(
      oldData.production || oldData.production_amount || "0",
      "üretim miktarı",
    );
    const earned = optionalNumber(oldData.earned || oldData.total_earned, "kazanç", 0);
    const expenses = optionalNumber(oldData.expenses || oldData.extra_expenses, "gider", 0);
    const holiday = optionalInt(oldData.holiday || oldData.is_holiday, "tatil", 0);

    return [
      `INSERT OR ROLLBACK INTO daily_metrics (id, date, production_amount, total_earned, extra_expenses, is_holiday) VALUES (${sqlLiteral(log.record_id)}, ${sqlLiteral(date)}, ${sqlLiteral(production)}, ${sqlLiteral(earned)}, ${sqlLiteral(expenses)}, ${sqlLiteral(holiday)})`,
    ];
  },
};

const deleteWorkerRateHistoryStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const validFrom = oldData?.valid_from;
    if (!validFrom) throw new Error("Silinen ücret geçmişi tarihi eksik.");

    const workerId = await resolveWorkerId(oldData);
    if (!workerId) throw new Error("Silinen ücret geçmişinin çalışanı bulunamadı.");

    const wage = requiredNumber(oldData.wage, "yevmiye");
    const type = oldData.type || oldData.worker_type;
    if (!type) throw new Error("Silinen çalışan tipi eksik.");

    return [
      `INSERT OR ROLLBACK INTO worker_rate_history (id, worker_id, valid_from, daily_wage, worker_type) VALUES (${sqlLiteral(log.record_id)}, ${sqlLiteral(workerId)}, ${sqlLiteral(validFrom)}, ${sqlLiteral(wage)}, ${sqlLiteral(type)})`,
    ];
  },
};

// ---------------------------------------------------------------------------
// Kayıt
// ---------------------------------------------------------------------------

const registry = new Map<string, RevertStrategy>();

function register(action: string, table: string, strategy: RevertStrategy): void {
  registry.set(`${action}:${table}`, strategy);
}

for (const table of REVERTABLE_TABLES) {
  register("INSERT", table, insertStrategy);
}

register("UPDATE", "attendance", updateAttendanceStrategy);
register("UPDATE", "payments", updatePaymentsStrategy);
register("UPDATE", "daily_metrics", updateDailyMetricsStrategy);
register("UPDATE", "worker_rate_history", updateWorkerRateHistoryStrategy);
register("UPDATE", "workers", updateWorkersStrategy);

register("DELETE", "attendance", deleteAttendanceStrategy);
register("DELETE", "payments", deletePaymentsStrategy);
register("DELETE", "daily_metrics", deleteDailyMetricsStrategy);
register("DELETE", "worker_rate_history", deleteWorkerRateHistoryStrategy);
register("DELETE", "workers", deleteWorkersStrategy);

export function getRevertStrategy(action: string, table: string): RevertStrategy | undefined {
  return registry.get(`${action}:${table}`);
}

/** Kaydın dönem kilidine dokunduğu tarihi çözer (yoksa `null`). */
export function resolveAffectedDate(ctx: RevertContext): string | null {
  const field = DATE_FIELD[ctx.log.entity_table];
  if (!field) return null;
  return ctx.oldData?.[field] || ctx.newData?.[field] || null;
}

export function createRevertContext(log: AuditLog): RevertContext {
  return {
    log,
    oldData: parseLogData(log.old_data),
    newData: parseLogData(log.new_data),
  };
}
