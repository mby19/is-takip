import { create } from "zustand";
import { auditLogRepository } from "../repositories/auditLogRepository";
import type { AuditLog } from "../types";
import { getRevertStrategy, createRevertContext } from "./revertStrategies";

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
      await usePaymentStore.getState().fetchWorkerPayments(parseInt(workerId));
    }
  } else if (log.entity_table === "workers") {
    await useWorkerStore.getState().fetchWorkers();
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

  revertLog: async (log: AuditLog): Promise<boolean> => {
    try {
      const strategy = getRevertStrategy(log.action_type, log.entity_table);
      if (!strategy) {
        throw new Error("Bu işlem türü geri alınamaz.");
      }

      const ctx = createRevertContext(log);
      await strategy.execute(ctx);

      await auditLogRepository.removeById(log.id);

      await syncStoresAfterRevert(log, ctx.oldData, ctx.newData);

      await get().fetchLogs();
      return true;
    } catch (error: unknown) {
      console.error("[AuditLog] Revert error:", error);
      throw error;
    }
  },
}));
