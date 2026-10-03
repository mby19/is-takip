import { create } from "zustand";
import {
  attendanceRepository,
  type AttendanceUpsertEntry,
} from "../repositories/attendanceRepository";
import type { Attendance, AttendanceStatus } from "../types";
import { reportError } from "../lib/errorMonitoring";
import { isDateInClosedPeriod, ClosedPeriodError } from "./periodStore";

interface AttendanceState {
  attendances: Attendance[];
  isLoading: boolean;
  error: string | null;
  fetchAttendanceByDate: (date: string, options?: { silent?: boolean }) => Promise<void>;
  fetchAttendanceByDateRange: (start: string, end: string) => Promise<void>;
  markAttendance: (
    worker_id: number,
    date: string,
    status: AttendanceStatus | null,
  ) => Promise<void>;
  /**
   * Bir günün puantajlarını TEK atomik işlemde yazar.
   *
   * Sıralı tekil `markAttendance` çağrılarından farklı olarak ya hepsi yazılır
   * ya hiçbiri: 12. çalışanda hata oluştuğunda ilk 11 kişinin puantajı
   * yazılmış, kalanı yazılmamış bir gün bırakmaz — o günün hakedişi eksik
   * hesaplanırdı.
   */
  markAttendanceMany: (
    entries: AttendanceUpsertEntry[],
  ) => Promise<{ written: number; removed: number }>;
}

/** Kaydı benzersiz tanımlayan anahtar: (çalışan, gün). */
const recordKey = (workerId: number, date: string): string => `${workerId}|${String(date).trim()}`;

const rowKey = (row: Attendance): string =>
  recordKey(Number(row.worker_id), String(row.date).trim());

const normalizeEntries = (entries: AttendanceUpsertEntry[]): AttendanceUpsertEntry[] => {
  if (!Array.isArray(entries)) throw new Error("Puantaj listesi geçersiz.");
  return entries.map((entry) => ({
    workerId: Number(entry?.workerId),
    date: String(entry?.date ?? "").trim(),
    status: entry?.status ?? null,
  }));
};

/**
 * Yalnızca verilen anahtarları listeden çıkarır; listenin geri kalanına dokunmaz.
 */
const withoutKeys = (rows: Attendance[], keys: Set<string>): Attendance[] =>
  rows.filter((row) => !keys.has(rowKey(row)));

export const useAttendanceStore = create<AttendanceState>((set, get) => ({
  attendances: [],
  isLoading: false,
  error: null,

  /**
   * `silent: true` ise yükleme göstergesi kaldırılmaz — ekran açıkken sessiz
   * tazeleme yapılabilsin diye (bkz. `DayDetailSheet` odak tazelemesi).
   */
  fetchAttendanceByDate: async (date: string, options?: { silent?: boolean }) => {
    const silent = options?.silent === true;
    if (!silent) set({ isLoading: true, error: null });
    try {
      const result = await attendanceRepository.findByDate(date);
      set((state) => ({
        attendances: [
          ...state.attendances.filter((a) => String(a.date).trim() !== String(date).trim()),
          ...result,
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
    await get().markAttendanceMany([{ workerId: Number(worker_id), date, status }]);
  },

  markAttendanceMany: async (entries: AttendanceUpsertEntry[]) => {
    const list = normalizeEntries(entries);
    if (list.length === 0) return { written: 0, removed: 0 };

    // Fail-closed: dönem kilidi listedeki HERHANGİ bir tarih için geçerliyse
    // hiçbir kayıt yazılmaz, iyimser güncelleme de yapılmaz.
    for (const entry of list) {
      if (isDateInClosedPeriod(entry.date)) throw new ClosedPeriodError(entry.date);
    }

    const keys = new Set(list.map((entry) => recordKey(entry.workerId, entry.date)));

    // Yalnızca etkilenen kayıtların eski hâli: rollback tüm listeyi geri
    // yazmaz, araya giren başka değişiklikleri silmez. Sıra bilgisi de saklanır
    // ki geri yükleme listeyi yeniden sıralamasın.
    const previous = get()
      .attendances.map((row, index) => ({ row, index }))
      .filter(({ row }) => keys.has(rowKey(row)));

    set((state) => ({
      attendances: [
        ...withoutKeys(state.attendances, keys),
        ...list
          .filter(
            (entry): entry is AttendanceUpsertEntry & { status: AttendanceStatus } =>
              entry.status !== null,
          )
          .map(
            (entry) =>
              ({
                worker_id: entry.workerId,
                date: entry.date,
                status: entry.status,
              }) as Attendance,
          ),
      ],
    }));

    try {
      return await attendanceRepository.upsertMany(list);
    } catch (error: unknown) {
      set((state) => {
        const restored = withoutKeys(state.attendances, keys);
        for (const { row, index } of previous) {
          restored.splice(Math.min(index, restored.length), 0, row);
        }
        return { attendances: restored };
      });
      reportError(error instanceof Error ? error : new Error(String(error)), {
        scope: "markAttendanceMany",
        date: list[0].date,
        count: list.length,
      });
      throw error;
    }
  },
}));
