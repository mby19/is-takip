import { create } from "zustand";
import { attendanceRepository } from "../repositories/attendanceRepository";
import type { Attendance, AttendanceStatus } from "../types";
import { reportError } from "../lib/errorMonitoring";

interface AttendanceState {
  attendances: Attendance[];
  isLoading: boolean;
  error: string | null;
  fetchAttendanceByDate: (date: string) => Promise<void>;
  fetchAttendanceByDateRange: (start: string, end: string) => Promise<void>;
  markAttendance: (
    worker_id: number,
    date: string,
    status: AttendanceStatus | null,
  ) => Promise<void>;
}

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
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

  /**
   * Puantaj kaydeder.
   *
   * Önce iyimser (optimistic) güncelleme yapılır; yazma başarısız olursa
   * ekrandaki değer eski haline döndürülür VE hata yukarı fırlatılır.
   * Hatanın yutulması, kullanıcının kaydedilmemiş bir veriyi kaydedilmiş
   * sanmasına yol açıyordu.
   */
  markAttendance: async (worker_id: number, date: string, status: AttendanceStatus | null) => {
    const wId = Number(worker_id);
    const dStr = String(date).trim();

    const previous = get().attendances;

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
      set({ attendances: previous });
      reportError(error instanceof Error ? error : new Error(String(error)), {
        scope: "markAttendance",
        worker_id: wId,
        date: dStr,
      });
      throw error;
    }
  },
}));
