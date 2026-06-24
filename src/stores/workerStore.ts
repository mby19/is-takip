import { create } from "zustand";
import { workerRepository } from "../repositories/workerRepository";
import type { Worker } from "../types";

interface WorkerState {
  workers: Worker[];
  isLoading: boolean;
  error: string | null;
  fetchWorkers: () => Promise<void>;
  addWorker: (name: string, daily_wage: number, worker_type: "ORTAK" | "GUNLUK") => Promise<void>;
  updateWorker: (
    id: number,
    name: string,
    daily_wage: number,
    worker_type: "ORTAK" | "GUNLUK",
  ) => Promise<void>;
  updateWorkerStatus: (id: number, is_active: boolean) => Promise<void>;
  archiveWorker: (id: number) => Promise<void>;
}

export const useWorkerStore = create<WorkerState>((set, get) => ({
  workers: [],
  isLoading: false,
  error: null,

  fetchWorkers: async () => {
    set({ isLoading: true, error: null });
    try {
      const result = await workerRepository.findAll();
      const formatted = result.map((w) => ({
        ...w,
        is_active: Boolean(w.is_active),
      }));
      set({ workers: formatted, isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  addWorker: async (name: string, daily_wage: number, worker_type: "ORTAK" | "GUNLUK") => {
    set({ isLoading: true, error: null });
    try {
      await workerRepository.create(name, daily_wage, worker_type);
      await get().fetchWorkers();
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  updateWorker: async (
    id: number,
    name: string,
    daily_wage: number,
    worker_type: "ORTAK" | "GUNLUK",
  ) => {
    set({ isLoading: true, error: null });
    try {
      await workerRepository.update(id, name, daily_wage, worker_type);
      await get().fetchWorkers();
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  updateWorkerStatus: async (id: number, is_active: boolean) => {
    try {
      await workerRepository.updateStatus(id, is_active);
      await get().fetchWorkers();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },

  archiveWorker: async (id: number) => {
    try {
      await workerRepository.archive(id);
      await get().fetchWorkers();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
    }
  },
}));
