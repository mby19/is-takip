import { create } from "zustand";
import { metricsRepository } from "../repositories/metricsRepository";
import type { DailyMetric } from "../types";
import { reportError } from "../lib/errorMonitoring";

interface MetricsState {
  metrics: DailyMetric[];
  isLoading: boolean;
  error: string | null;
  fetchMetricsByDate: (date: string) => Promise<void>;
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

  fetchMetricsByDate: async (date: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await metricsRepository.findByDate(date);
      set((state) => ({
        metrics: [
          ...state.metrics.filter((m) => String(m.date).trim() !== String(date).trim()),
          ...(result.length > 0 ? [result[0]] : []),
        ],
        isLoading: false,
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
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
    const p = Number(production_amount) || 0;
    const t = Number(total_earned) || 0;
    const e = Number(extra_expenses) || 0;

    const previous = get().metrics;

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
      set({ metrics: previous, error: msg });
      reportError(error instanceof Error ? error : new Error(msg), {
        scope: "updateMetrics",
        date: dStr,
      });
      throw error;
    }
  },
}));
