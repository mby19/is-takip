import { create } from "zustand";
import { workerRepository } from "../repositories/workerRepository";
import { workerRateRepository } from "../repositories/workerRateRepository";
import type { Worker, WorkerRate, WorkerType } from "../types";
import { reportError } from "../lib/errorMonitoring";
import { isDateInClosedPeriod, ClosedPeriodError } from "./periodStore";

/** Ücret geçmişinin açılış tarihi — bu tarihten önceki her gün için geçerli. */
export const RATE_HISTORY_EPOCH = "2000-01-01";

interface WorkerState {
  workers: Worker[];
  rateHistory: WorkerRate[];
  isLoading: boolean;
  error: string | null;
  fetchWorkers: () => Promise<void>;
  fetchRateHistory: () => Promise<void>;
  addWorker: (name: string, daily_wage: number, worker_type: WorkerType) => Promise<void>;
  /**
   * Çalışan bilgilerini günceller.
   * `effectiveFrom` verilirse ücret/tip değişikliği o tarihten itibaren geçerli
   * olur; önceki aylar eski değerlerle hesaplanmaya devam eder.
   */
  updateWorker: (
    id: number,
    name: string,
    daily_wage: number,
    worker_type: WorkerType,
    effectiveFrom?: string,
  ) => Promise<void>;
  updateWorkerStatus: (id: number, is_active: boolean) => Promise<void>;
  archiveWorker: (id: number) => Promise<void>;
}

export const useWorkerStore = create<WorkerState>((set, get) => ({
  workers: [],
  rateHistory: [],
  isLoading: false,
  error: null,

  fetchWorkers: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await workerRepository.findAll();
      set({
        workers: result.map((w) => ({ ...w, is_active: Boolean(w.is_active) })),
        isLoading: false,
      });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  fetchRateHistory: async () => {
    try {
      set({ rateHistory: await workerRateRepository.findAll() });
    } catch (error: unknown) {
      // Ücret geçmişi okunamazsa hesaplama güncel değerlere düşer (bozulmaz).
      reportError(error instanceof Error ? error : new Error(String(error)), {
        scope: "fetchRateHistory",
      });
    }
  },

  addWorker: async (name: string, daily_wage: number, worker_type: WorkerType) => {
    set({ isLoading: true, error: null });
    try {
      await workerRepository.create(name, daily_wage, worker_type);

      // Açılış ücret kaydı: geçmişe dönük hesaplarda da bu değer kullanılsın.
      const created = await workerRepository.findIdByName(name);
      if (created.length > 0) {
        await workerRateRepository.upsert(
          created[0].id,
          RATE_HISTORY_EPOCH,
          daily_wage,
          worker_type,
        );
      }

      await get().fetchWorkers();
      await get().fetchRateHistory();
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
      throw error;
    }
  },

  updateWorker: async (
    id: number,
    name: string,
    daily_wage: number,
    worker_type: WorkerType,
    effectiveFrom?: string,
  ) => {
    set({ isLoading: true, error: null });
    try {
      const current = get().workers.find((w) => w.id === id);
      const rateChanged =
        !current || current.daily_wage !== daily_wage || current.worker_type !== worker_type;

      await workerRepository.update(id, name, daily_wage, worker_type);

      if (rateChanged) {
        // Kapalı bir dönemden itibaren geçerli kılmak o ayın hakedişini
        // yeniden hesaplardı — dönem kilidinin engellediği tam olarak bu.
        const from = effectiveFrom || RATE_HISTORY_EPOCH;
        if (isDateInClosedPeriod(from)) throw new ClosedPeriodError(from);

        await workerRateRepository.upsert(id, from, daily_wage, worker_type);
      }

      await get().fetchWorkers();
      await get().fetchRateHistory();
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
      throw error;
    }
  },

  updateWorkerStatus: async (id: number, is_active: boolean) => {
    try {
      await workerRepository.updateStatus(id, is_active);
      await get().fetchWorkers();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },

  archiveWorker: async (id: number) => {
    try {
      await workerRepository.archive(id);
      await get().fetchWorkers();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  },
}));
