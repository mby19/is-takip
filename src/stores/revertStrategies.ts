import { executeQuery, fetchQuery } from "../lib/db";
import type { AuditLog } from "../types";
import { parseLogData } from "../utils/parseLogData";

const ALLOWED_TABLES = ["workers", "attendance", "daily_metrics", "payments"];

export interface RevertContext {
  log: AuditLog;
  oldData: Record<string, string> | null;
  newData: Record<string, string> | null;
}

export interface RevertStrategy {
  execute(ctx: RevertContext): Promise<void>;
}

const insertStrategy: RevertStrategy = {
  async execute({ log, newData }: RevertContext) {
    if (!ALLOWED_TABLES.includes(log.entity_table)) {
      throw new Error("Bu tablo için silme desteklenmiyor.");
    }
    if (log.entity_table === "daily_metrics" && newData?.date) {
      await executeQuery("DELETE FROM attendance WHERE date = ?", [newData.date]);
    }
    await executeQuery(`DELETE FROM ${log.entity_table} WHERE id = ?`, [log.record_id]);
  },
};

const updateAttendanceStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const status = oldData?.status;
    if (!status) throw new Error("Önceki durum bilgisi bulunamadı.");

    const updated = await executeQuery("UPDATE attendance SET status = ? WHERE id = ?", [
      status,
      log.record_id,
    ]);

    if ((!updated || updated.rowsAffected === 0) && oldData?.date) {
      let workerId = oldData?.worker_id ? parseInt(oldData.worker_id) : null;
      if (!workerId && oldData?.worker_name) {
        const workers = await fetchQuery<{ id: number }>("SELECT id FROM workers WHERE name = ?", [
          oldData.worker_name,
        ]);
        if (workers.length > 0) workerId = workers[0].id;
      }
      if (!workerId) throw new Error("Çalışan bulunamadı.");
      await executeQuery(
        "INSERT OR REPLACE INTO attendance (worker_id, date, status) VALUES (?, ?, ?)",
        [workerId, oldData.date, status],
      );
    }
  },
};

const updatePaymentsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const amount = parseFloat(oldData?.amount || "0");
    const date = oldData?.date;
    const description = oldData?.description || null;
    if (!date) throw new Error("Önceki ödeme bilgileri eksik.");

    await executeQuery("UPDATE payments SET amount = ?, date = ?, description = ? WHERE id = ?", [
      amount,
      date,
      description,
      log.record_id,
    ]);
  },
};

const updateDailyMetricsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    if (oldData?.date) {
      const pAmt = parseInt(oldData.production || oldData.production_amount || "0");
      const tEarned = parseFloat(oldData.earned || oldData.total_earned || "0");
      const eExp = parseFloat(oldData.expenses || oldData.extra_expenses || "0");
      const isHol = parseInt(oldData.holiday || oldData.is_holiday || "0");

      await executeQuery(
        "UPDATE daily_metrics SET production_amount = ?, total_earned = ?, extra_expenses = ?, is_holiday = ? WHERE id = ?",
        [pAmt, tEarned, eExp, isHol, log.record_id],
      );

      // Attendance snapshot geri yükleme (v8+)
      if (oldData.atts) {
        const attsParts = oldData.atts.split(",");
        for (const part of attsParts) {
          const subParts = part.trim().split(":");
          if (subParts.length >= 3) {
            const [wId, , wStatus] = subParts;
            if (wStatus && wStatus !== "YOK") {
              await executeQuery(
                "INSERT OR REPLACE INTO attendance (worker_id, date, status) VALUES (?, ?, ?)",
                [parseInt(wId), oldData.date, wStatus],
              );
            } else {
              await executeQuery("DELETE FROM attendance WHERE worker_id = ? AND date = ?", [
                parseInt(wId),
                oldData.date,
              ]);
            }
          }
        }
      }
    } else if (oldData?.production) {
      await executeQuery("UPDATE daily_metrics SET production_amount = ? WHERE id = ?", [
        parseInt(oldData.production),
        log.record_id,
      ]);
    } else {
      throw new Error("Önceki üretim verisi bulunamadı.");
    }
  },
};

const updateWorkersStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const name = oldData?.name;
    const type = oldData?.type || oldData?.worker_type;
    const wage = parseFloat(oldData?.wage || oldData?.daily_wage || "0");
    const isActive = parseInt(oldData?.is_active || "1");
    if (!name || !type) throw new Error("Önceki çalışan bilgileri eksik.");

    await executeQuery(
      "UPDATE workers SET name = ?, worker_type = ?, daily_wage = ?, is_active = ? WHERE id = ?",
      [name, type, wage, isActive, log.record_id],
    );
  },
};

const deleteAttendanceStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const status = oldData?.status;
    const date = oldData?.date;
    if (!status || !date) throw new Error("Silinen çalışma durumu bilgileri eksik.");

    let workerId = oldData?.worker_id ? parseInt(oldData.worker_id) : null;
    if (!workerId && oldData?.worker_name) {
      const workers = await fetchQuery<{ id: number }>("SELECT id FROM workers WHERE name = ?", [
        oldData.worker_name,
      ]);
      if (workers.length > 0) workerId = workers[0].id;
    }
    if (!workerId) throw new Error("Çalışan bilgisi bulunamadı.");

    await executeQuery(
      "INSERT OR REPLACE INTO attendance (id, worker_id, date, status) VALUES (?, ?, ?, ?)",
      [log.record_id, workerId, date, status],
    );
  },
};

const deletePaymentsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const workerId = oldData?.worker_id;
    const amount = parseFloat(oldData?.amount || "0");
    const date = oldData?.date;
    const description = oldData?.description || null;
    if (!workerId || !date) throw new Error("Silinen ödeme bilgileri eksik.");

    await executeQuery(
      "INSERT INTO payments (id, worker_id, amount, date, description) VALUES (?, ?, ?, ?, ?)",
      [log.record_id, parseInt(workerId), amount, date, description],
    );
  },
};

const deleteWorkersStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const name = oldData?.name;
    const type = oldData?.type || oldData?.worker_type;
    const wage = parseFloat(oldData?.wage || oldData?.daily_wage || "0");
    const isActive = parseInt(oldData?.is_active || "1");
    if (!name || !type) throw new Error("Silinen çalışan bilgileri eksik.");

    await executeQuery(
      "INSERT INTO workers (id, name, daily_wage, worker_type, is_active) VALUES (?, ?, ?, ?, ?)",
      [log.record_id, name, wage, type, isActive],
    );
  },
};

const deleteDailyMetricsStrategy: RevertStrategy = {
  async execute({ log, oldData }: RevertContext) {
    const date = oldData?.date;
    if (!date) throw new Error("Silinen günlük veri tarihi eksik.");

    await executeQuery(
      "INSERT INTO daily_metrics (id, date, production_amount, total_earned, extra_expenses, is_holiday) VALUES (?, ?, ?, ?, ?, ?)",
      [
        log.record_id,
        date,
        parseInt(oldData.production || oldData.production_amount || "0"),
        parseFloat(oldData.earned || oldData.total_earned || "0"),
        parseFloat(oldData.expenses || oldData.extra_expenses || "0"),
        parseInt(oldData.holiday || oldData.is_holiday || "0"),
      ],
    );
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
