import { create } from "zustand";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { executeTransaction } from "../lib/db";
import { sqlLiteral } from "../lib/sql";
import type { AuditLog } from "../types";
import { getRevertStrategy, createRevertContext } from "./revertStrategies";
import { reportError } from "../lib/errorMonitoring";
import { isDateInClosedPeriod, ClosedPeriodError } from "./periodStore";

interface AuditLogState {
  logs: AuditLog[];
  isLoading: boolean;
  error: string | null;
  fetchLogs: () => Promise<void>;
  revertLog: (log: AuditLog) => Promise<boolean>;
}

const syncStoresAfterRevert = async (
  log: AuditLog,
  oldData: Record<string, string> | null,
  newData: Record<string, string> | null,
) => {
  const { useMetricsStore } = await import("./metricsStore");
  const { useAttendanceStore } = await import("./attendanceStore");
  const { usePaymentStore } = await import("./paymentStore");
  const { useWorkerStore } = await import("./workerStore");

  const date = oldData?.date || newData?.date;
  if (log.entity_table === "daily_metrics" && date) {
    await useMetricsStore.getState().fetchMetricsByDate(date);
    await useAttendanceStore.getState().fetchAttendanceByDate(date);
  } else if (log.entity_table === "attendance" && date) {
    await useAttendanceStore.getState().fetchAttendanceByDate(date);
  } else if (log.entity_table === "payments") {
    const workerId = oldData?.worker_id || newData?.worker_id;
    if (workerId) {
      await usePaymentStore.getState().fetchWorkerPayments(parseInt(workerId, 10));
    }
  } else if (log.entity_table === "workers") {
    await useWorkerStore.getState().fetchWorkers();
    await useWorkerStore.getState().fetchRateHistory();
  }
};

export const useAuditLogStore = create<AuditLogState>((set, get) => ({
  logs: [],
  isLoading: false,
  error: null,

  fetchLogs: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await auditLogRepository.findAll();
      set({ logs: result, isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  /**
   * Bir denetim kaydını geri alır.
   *
   * Tüm adımlar tek transaction içinde uygulanır — geri alma yarıda kalıp
   * tutarsız duruma yol açamaz. Kayıt silinmez, `reverted_at` ile işaretlenir
   * ve geri alma işleminin kendisi ayrı bir REVERT kaydı olarak yazılır;
   * böylece denetim izi eksiksiz kalır.
   */
  revertLog: async (log: AuditLog): Promise<boolean> => {
    if (log.reverted_at) {
      throw new Error("Bu işlem daha önce geri alınmış.");
    }

    try {
      const strategy = getRevertStrategy(log.action_type, log.entity_table);
      if (!strategy) {
        throw new Error("Bu işlem türü geri alınamaz.");
      }

      const ctx = createRevertContext(log);

      // Geri alma kapalı bir dönemin verisine dokunuyorsa engellenir.
      const affectedDate = ctx.oldData?.date || ctx.newData?.date;
      if (affectedDate && isDateInClosedPeriod(affectedDate)) {
        throw new ClosedPeriodError(affectedDate);
      }

      const statements = await strategy.execute(ctx);

      const revertNote = JSON.stringify({
        reverted_log_id: log.id,
        action_type: log.action_type,
        entity_table: log.entity_table,
        record_id: log.record_id,
      });

      await executeTransaction([
        ...statements,
        `UPDATE audit_logs SET reverted_at = DATETIME('now', 'localtime') WHERE id = ${sqlLiteral(log.id)}`,
        `INSERT INTO audit_logs (action_type, entity_table, record_id, new_data) VALUES ('REVERT', ${sqlLiteral(log.entity_table)}, ${sqlLiteral(log.record_id)}, ${sqlLiteral(revertNote)})`,
      ]);

      await syncStoresAfterRevert(log, ctx.oldData, ctx.newData);
      await get().fetchLogs();
      return true;
    } catch (error: unknown) {
      reportError(error instanceof Error ? error : new Error(String(error)), {
        scope: "revertLog",
        log_id: log.id,
      });
      throw error;
    }
  },
}));
