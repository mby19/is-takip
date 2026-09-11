import { create } from "zustand";
import { closedPeriodRepository, type ClosedPeriod } from "../repositories/closedPeriodRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { periodOf, formatPeriod, type PeriodKey } from "../lib/period";
import { reportError } from "../lib/errorMonitoring";

interface PeriodState {
  closed: ClosedPeriod[];
  earliestDataPeriod: PeriodKey | null;
  isLoading: boolean;
  fetchClosedPeriods: () => Promise<void>;
  closePeriod: (period: PeriodKey, note?: string) => Promise<void>;
  reopenPeriod: (period: PeriodKey) => Promise<void>;
}

export const usePeriodStore = create<PeriodState>((set, get) => ({
  closed: [],
  earliestDataPeriod: null,
  isLoading: false,

  fetchClosedPeriods: async () => {
    set({ isLoading: true });
    try {
      const [closed, earliest] = await Promise.all([
        closedPeriodRepository.findAll(),
        closedPeriodRepository.earliestDataPeriod(),
      ]);
      set({
        closed,
        earliestDataPeriod: earliest[0]?.period ?? null,
        isLoading: false,
      });
    } catch (error: unknown) {
      set({ isLoading: false });
      reportError(error instanceof Error ? error : new Error(String(error)), {
        scope: "fetchClosedPeriods",
      });
    }
  },

  closePeriod: async (period: PeriodKey, note?: string) => {
    await closedPeriodRepository.close(period, note);
    await auditLogRepository.write(
      "CLOSE_PERIOD",
      "closed_periods",
      0,
      JSON.stringify({ period, label: formatPeriod(period), note: note ?? "" }),
    );
    await get().fetchClosedPeriods();
  },

  reopenPeriod: async (period: PeriodKey) => {
    await closedPeriodRepository.reopen(period);
    await auditLogRepository.write(
      "REOPEN_PERIOD",
      "closed_periods",
      0,
      JSON.stringify({ period, label: formatPeriod(period) }),
    );
    await get().fetchClosedPeriods();
  },
}));

/**
 * Verilen tarihin dönemi kapalı mı?
 * Store dışından (hesaplama, doğrulama) senkron çağrılabilsin diye ayrı tutuldu.
 */
export const isDateInClosedPeriod = (dateStr: string): boolean => {
  const period = periodOf(dateStr);
  return usePeriodStore.getState().closed.some((c) => c.period === period);
};

/** Kapalı döneme yazma denemesinde kullanılacak standart hata. */
export class ClosedPeriodError extends Error {
  constructor(dateStr: string) {
    super(
      `${formatPeriod(periodOf(dateStr))} dönemi kapatılmış. ` +
        `Değişiklik yapmak için Ayarlar → Dönem Kilidi bölümünden bu dönemi açın.`,
    );
    this.name = "ClosedPeriodError";
  }
}
