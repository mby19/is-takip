import { create } from "zustand";
import { paymentRepository } from "../repositories/paymentRepository";
import type { Payment } from "../types";
import { reportError } from "../lib/errorMonitoring";
import { isDateInClosedPeriod, ClosedPeriodError } from "./periodStore";

interface PaymentState {
  payments: Payment[];
  isLoading: boolean;
  error: string | null;
  fetchWorkerPayments: (worker_id: number) => Promise<void>;
  addPayment: (
    worker_id: number,
    amount: number,
    date: string,
    description?: string,
  ) => Promise<void>;
  deletePayment: (id: number, worker_id: number) => Promise<void>;
}

export const usePaymentStore = create<PaymentState>((set, get) => ({
  payments: [],
  isLoading: false,
  error: null,

  fetchWorkerPayments: async (worker_id: number) => {
    set({ isLoading: true, error: null });
    try {
      const result = await paymentRepository.findByWorker(worker_id);
      set({ payments: result, isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  addPayment: async (worker_id: number, amount: number, date: string, description?: string) => {
    if (isDateInClosedPeriod(date)) throw new ClosedPeriodError(date);
    try {
      await paymentRepository.create(worker_id, amount, date, description);
      await get().fetchWorkerPayments(worker_id);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg });
      reportError(error instanceof Error ? error : new Error(msg), { scope: "addPayment" });
      throw error;
    }
  },

  deletePayment: async (id: number, worker_id: number) => {
    const target = get().payments.find((p) => p.id === id);
    if (target && isDateInClosedPeriod(target.date)) throw new ClosedPeriodError(target.date);
    try {
      await paymentRepository.remove(id);
      await get().fetchWorkerPayments(worker_id);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg });
      reportError(error instanceof Error ? error : new Error(msg), { scope: "deletePayment" });
      throw error;
    }
  },
}));
