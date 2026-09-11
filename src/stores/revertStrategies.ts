import { fetchQuery } from "../lib/db";
import { sqlLiteral } from "../lib/sql";
import type { AuditLog } from "../types";
import { parseLogData, parseAttendanceSnapshot } from "../utils/parseLogData";

const ALLOWED_TABLES = ["workers", "attendance", "daily_metrics", "payments"];

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
}

/** İsimden çalışan id'si çözer (eski loglarda worker_id bulunmayabilir). */
async function resolveWorkerId(data: Record<string, string> | null): Promise<number | null> {
  const direct = data?.worker_id ? parseInt(data.worker_id, 10) : null;
  if (direct && Number.isFinite(direct)) return direct;

  const name = data?.worker_name;
  if (!name) return null;

  const rows = await fetchQuery<{ id: number }>("SELECT id FROM workers WHERE name = ?", [name]);
  return rows.length > 0 ? rows[0].id : null;
}

const insertStrategy: RevertStrategy = {
  async execute({ log, newData }: RevertContext) {
    if (!ALLOWED_TABLES.includes(log.entity_table)) {
      throw new Error("Bu tablo için silme desteklenmiyor.");
    }

    const statements: string[] = [];

    // Günlük veri kaydı eklenmesini geri alırken o güne ait puantaj da geri alınır.
    if (log.entity_table === "daily_metrics" && newData?.date) {
      statements.push(`DELETE FROM attendance WHERE date = ${sqlLiteral(newData.date)}`);
    }

    statements.push(`DELETE FROM ${log.entity_table} WHERE id = ${sqlLiteral(log.record_id)}`);
    return statements;
  },
};

const updateAttendanceStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const status = oldData?.status;
    if (!status) throw new Error("Önceki durum bilgisi bulunamadı.");

    const workerId = await resolveWorkerId(oldData);

    // Kayıt hâlâ duruyorsa güncelle; silinmişse tarih + çalışandan yeniden kur.
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

    const amount = parseFloat(oldData?.amount || "0");
    const description = oldData?.description || null;

    return [
      `UPDATE OR ROLLBACK payments SET amount = ${sqlLiteral(amount)}, date = ${sqlLiteral(date)}, description = ${sqlLiteral(description)} WHERE id = ${sqlLiteral(log.record_id)}`,
    ];
  },
};

const updateDailyMetricsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    if (!oldData?.date) {
      if (oldData?.production) {
        return [
          `UPDATE OR ROLLBACK daily_metrics SET production_amount = ${sqlLiteral(parseInt(oldData.production, 10))} WHERE id = ${sqlLiteral(log.record_id)}`,
        ];
      }
      throw new Error("Önceki üretim verisi bulunamadı.");
    }

    const pAmt = parseInt(oldData.production || oldData.production_amount || "0", 10);
    const tEarned = parseFloat(oldData.earned || oldData.total_earned || "0");
    const eExp = parseFloat(oldData.expenses || oldData.extra_expenses || "0");
    const isHol = parseInt(oldData.holiday || oldData.is_holiday || "0", 10);

    const statements = [
      `UPDATE OR ROLLBACK daily_metrics SET production_amount = ${sqlLiteral(pAmt)}, total_earned = ${sqlLiteral(tEarned)}, extra_expenses = ${sqlLiteral(eExp)}, is_holiday = ${sqlLiteral(isHol)} WHERE id = ${sqlLiteral(log.record_id)}`,
    ];

    // O günün personel anlık görüntüsünü de geri yükle.
    for (const entry of parseAttendanceSnapshot(oldData.atts)) {
      if (entry.status && entry.status !== "YOK") {
        statements.push(
          `INSERT OR ROLLBACK INTO attendance (worker_id, date, status) VALUES (${sqlLiteral(entry.id)}, ${sqlLiteral(oldData.date)}, ${sqlLiteral(entry.status)})
             ON CONFLICT(worker_id, date) DO UPDATE SET status = excluded.status`,
        );
      } else {
        statements.push(
          `DELETE FROM attendance WHERE worker_id = ${sqlLiteral(entry.id)} AND date = ${sqlLiteral(oldData.date)}`,
        );
      }
    }

    return statements;
  },
};

const updateWorkersStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const name = oldData?.name;
    const type = oldData?.type || oldData?.worker_type;
    if (!name || !type) throw new Error("Önceki çalışan bilgileri eksik.");

    const wage = parseFloat(oldData?.wage || oldData?.daily_wage || "0");
    const isActive = parseInt(oldData?.is_active || "1", 10);

    return [
      `UPDATE OR ROLLBACK workers SET name = ${sqlLiteral(name)}, worker_type = ${sqlLiteral(type)}, daily_wage = ${sqlLiteral(wage)}, is_active = ${sqlLiteral(isActive)} WHERE id = ${sqlLiteral(log.record_id)}`,
    ];
  },
};

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

    const amount = parseFloat(oldData?.amount || "0");
    const description = oldData?.description || null;

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

    const wage = parseFloat(oldData?.wage || oldData?.daily_wage || "0");
    const isActive = parseInt(oldData?.is_active || "1", 10);

    return [
      `INSERT OR ROLLBACK INTO workers (id, name, daily_wage, worker_type, is_active) VALUES (${sqlLiteral(log.record_id)}, ${sqlLiteral(name)}, ${sqlLiteral(wage)}, ${sqlLiteral(type)}, ${sqlLiteral(isActive)})`,
    ];
  },
};

const deleteDailyMetricsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const date = oldData?.date;
    if (!date) throw new Error("Silinen günlük veri tarihi eksik.");

    return [
      `INSERT OR ROLLBACK INTO daily_metrics (id, date, production_amount, total_earned, extra_expenses, is_holiday) VALUES (${sqlLiteral(log.record_id)}, ${sqlLiteral(date)}, ${sqlLiteral(parseInt(oldData.production || oldData.production_amount || "0", 10))}, ${sqlLiteral(parseFloat(oldData.earned || oldData.total_earned || "0"))}, ${sqlLiteral(parseFloat(oldData.expenses || oldData.extra_expenses || "0"))}, ${sqlLiteral(parseInt(oldData.holiday || oldData.is_holiday || "0", 10))})`,
    ];
  },
};

const registry = new Map<string, RevertStrategy>();

function register(action: string, table: string, strategy: RevertStrategy): void {
  registry.set(`${action}:${table}`, strategy);
}

for (const table of ALLOWED_TABLES) {
  register("INSERT", table, insertStrategy);
}

register("UPDATE", "attendance", updateAttendanceStrategy);
register("UPDATE", "payments", updatePaymentsStrategy);
register("UPDATE", "daily_metrics", updateDailyMetricsStrategy);
register("UPDATE", "workers", updateWorkersStrategy);

register("DELETE", "attendance", deleteAttendanceStrategy);
register("DELETE", "payments", deletePaymentsStrategy);
register("DELETE", "daily_metrics", deleteDailyMetricsStrategy);
register("DELETE", "workers", deleteWorkersStrategy);

export function getRevertStrategy(action: string, table: string): RevertStrategy | undefined {
  return registry.get(`${action}:${table}`);
}

export function createRevertContext(log: AuditLog): RevertContext {
  return {
    log,
    oldData: parseLogData(log.old_data),
    newData: parseLogData(log.new_data),
  };
}
