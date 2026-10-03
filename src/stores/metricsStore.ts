import { create } from "zustand";
import { metricsRepository } from "../repositories/metricsRepository";
import type { DailyMetric } from "../types";
import { reportError } from "../lib/errorMonitoring";
import { isDateInClosedPeriod, ClosedPeriodError } from "./periodStore";

interface MetricsState {
  metrics: DailyMetric[];
  isLoading: boolean;
  error: string | null;
  /** `silent: true` ise yükleme göstergesi kaldırılır — ekran açıkken tazeleme için. */
  fetchMetricsByDate: (date: string, options?: { silent?: boolean }) => Promise<void>;
  fetchMetricsByDateRange: (start: string, end: string) => Promise<void>;
  updateMetrics: (
    date: string,
    production_amount: number,
    total_earned: number,
    extra_expenses: number,
    is_holiday: boolean,
  ) => Promise<void>;
}

export const useMetricsStore = create<MetricsState>((set, get) => ({
  metrics: [],
  isLoading: false,
  error: null,

  fetchMetricsByDate: async (date: string, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) set({ isLoading: true, error: null });
    try {
      const result = await metricsRepository.findByDate(date);
      set((state) => ({
        metrics: [
          ...state.metrics.filter((m) => String(m.date).trim() !== String(date).trim()),
          ...(result.length > 0 ? [result[0]] : []),
        ],
        ...(silent ? {} : { isLoading: false }),
      }));
    } catch (error: unknown) {
      set({
        error: error instanceof Error ? error.message : String(error),
        ...(silent ? {} : { isLoading: false }),
      });
    }
  },

  fetchMetricsByDateRange: async (start: string, end: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await metricsRepository.findByDateRange(start, end);
      set({ metrics: result, isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  /**
   * Günlük veriyi tek atomik UPSERT ile yazar ve hatayı yukarı fırlatır.
   */
  updateMetrics: async (
    date: string,
    production_amount: number,
    total_earned: number,
    extra_expenses: number,
    is_holiday: boolean,
  ) => {
    const dStr = String(date).trim();

    if (isDateInClosedPeriod(dStr)) throw new ClosedPeriodError(dStr);

    const p = Number(production_amount) || 0;
    const t = Number(total_earned) || 0;
    const e = Number(extra_expenses) || 0;

    // Rollback yalnızca BU GÜNÜ etkiler: tüm diziyi geri yazmak, araya giren
    // başka değişiklikleri (ör. aynı anda yüklenen ay verisi) silerdi.
    const previousForDate = get().metrics.find((m) => String(m.date).trim() === dStr) ?? null;

    try {
      await metricsRepository.upsert(dStr, p, t, e, is_holiday);

      const rows = await metricsRepository.findByDate(dStr);
      set((state) => ({
        error: null,
        metrics: [
          ...state.metrics.filter((m) => String(m.date).trim() !== dStr),
          ...(rows.length > 0
            ? [rows[0]]
            : [
                {
                  id: 0,
                  date: dStr,
                  production_amount: p,
                  total_earned: t,
                  extra_expenses: e,
                  is_holiday,
                } as DailyMetric,
              ]),
        ],
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set((state) => ({
        error: msg,
        metrics: [
          ...state.metrics.filter((m) => String(m.date).trim() !== dStr),
          ...(previousForDate ? [previousForDate] : []),
        ],
      }));
      reportError(error instanceof Error ? error : new Error(msg), {
        scope: "updateMetrics",
        date: dStr,
      });
      throw error;
    }
  },
}));
