import { create } from "zustand";
import { metricsRepository } from "../repositories/metricsRepository";
import type { DailyMetric } from "../types";
import { useToastStore } from "./toastStore";

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

export const useMetricsStore = create<MetricsState>((set) => ({
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

  updateMetrics: async (
    date: string,
    production_amount: number,
    total_earned: number,
    extra_expenses: number,
    is_holiday: boolean,
  ) => {
    try {
      const p = Number(production_amount) || 0;
      const t = Number(total_earned) || 0;
      const e = Number(extra_expenses) || 0;

      const existing = await metricsRepository.findIdByDate(date);

      if (existing.length > 0) {
        await metricsRepository.update(date, p, t, e, is_holiday);
      } else {
        await metricsRepository.insert(date, p, t, e, is_holiday);
      }

      // Optimistic UI
      set((state) => ({
        metrics: [
          ...state.metrics.filter((m) => String(m.date).trim() !== String(date).trim()),
          {
            id: existing.length > 0 ? existing[0].id : 0,
            date: String(date).trim(),
            production_amount: p,
            total_earned: t,
            extra_expenses: e,
            is_holiday,
          } as DailyMetric,
        ],
      }));
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg });
      useToastStore.getState().addToast("Metrik güncelleme hatası: " + msg, "error");
    }
  },
}));
