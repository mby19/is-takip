import { create } from "zustand";
import { attendanceRepository } from "../repositories/attendanceRepository";
import type { Attendance } from "../types";
import { useToastStore } from "./toastStore";

interface AttendanceState {
  attendances: Attendance[];
  isLoading: boolean;
  error: string | null;
  fetchAttendanceByDate: (date: string) => Promise<void>;
  fetchAttendanceByDateRange: (start: string, end: string) => Promise<void>;
  markAttendance: (
    worker_id: number,
    date: string,
    status: "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null,
    workerName?: string,
  ) => Promise<void>;
}

export const useAttendanceStore = create<AttendanceState>((set) => ({
  attendances: [],
  isLoading: false,
  error: null,

  fetchAttendanceByDate: async (date: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await attendanceRepository.findByDate(date);
      set((state) => ({
        attendances: [
          ...state.attendances.filter((a) => String(a.date).trim() !== String(date).trim()),
          ...result,
        ],
        isLoading: false,
      }));
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  fetchAttendanceByDateRange: async (start: string, end: string) => {
    set({ isLoading: true, error: null });
    try {
      const result = await attendanceRepository.findByDateRange(start, end);
      set({ attendances: result, isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  markAttendance: async (
    worker_id: number,
    date: string,
    status: "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null,
    _workerName?: string,
  ) => {
    const wId = Number(worker_id);
    const dStr = String(date).trim();

    // OPTIMISTIC UI: Önce state'i güncelle (Anında tepki)
    set((state) => {
      const filtered = state.attendances.filter(
        (a) => !(Number(a.worker_id) === wId && String(a.date).trim() === dStr),
      );

      if (status) {
        return {
          attendances: [...filtered, { worker_id: wId, date: dStr, status } as Attendance],
        };
      }
      return { attendances: filtered };
    });

    try {
      if (status === null) {
        await attendanceRepository.remove(wId, dStr);
      } else {
        await attendanceRepository.upsert(wId, dStr, status);
      }
    } catch (error: unknown) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      useToastStore.getState().addToast("Kayıt hatası: " + errorMsg, "error");
    }
  },
}));
