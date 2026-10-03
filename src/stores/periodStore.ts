import { create } from "zustand";
import { closedPeriodRepository, type ClosedPeriod } from "../repositories/closedPeriodRepository";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { periodOf, formatPeriod, type PeriodKey } from "../lib/period";
import { reportError } from "../lib/errorMonitoring";

interface PeriodState {
  closed: ClosedPeriod[];
  /**
   * Kilit listesi veritabanından okundu mu?
   *
   * `false` iken hiçbir yazma yolu çalışmaz. Liste bilinmiyorken "kapalı
   * dönem yok" saymak, ödenmiş bir ayın puantajını/cirosunu/ödemesini
   * değiştirmeye izin vermek anlamına gelir — para hatası.
   */
  closedLoaded: boolean;
  /** Kilit listesi okunamadıysa son hatanın metni; arayüz bunu göstermelidir. */
  error: string | null;
  earliestDataPeriod: PeriodKey | null;
  isLoading: boolean;
  fetchClosedPeriods: () => Promise<void>;
  closePeriod: (period: PeriodKey, note?: string) => Promise<void>;
  reopenPeriod: (period: PeriodKey) => Promise<void>;
}

export const usePeriodStore = create<PeriodState>((set, get) => ({
  closed: [],
  closedLoaded: false,
  earliestDataPeriod: null,
  error: null,
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
        closedLoaded: true,
        error: null,
        isLoading: false,
      });
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      // Liste boş da olsa "kapalı dönem yok" denemez: yazma yolları kilitli
      // kalır (fail-closed) ve hata arayüze taşınır.
      set({ isLoading: false, closedLoaded: false, error: err.message });
      reportError(err, {
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
 * `closed` listesi doğrudan verildiğinde onu yetkili kabul eder.
 *
 * Kural: liste değiştirildiğinde `closedLoaded` de doğrudur. Böylece elle
 * kurulan durumlar (yeniden yükleme, testler) yüklenmiş sayılır. Hata
 * durumunda liste hiç değişmediği için `closedLoaded: false` kalır ve tüm
 * yazma yolları kapalı tutulur.
 */
usePeriodStore.subscribe((state, prev) => {
  if (state.closed !== prev.closed && !state.closedLoaded) {
    usePeriodStore.setState({ closedLoaded: true });
  }
});

/**
 * Verilen tarihin dönemi kapalı mı?
 * Store dışından (hesaplama, doğrulama) senkron çağrılabilsin diye ayrı tutuldu.
 *
 * Kilit listesi yüklenemediyse **her tarih kapalı sayılır**: yazma yollarının
 * altı da (workerStore, attendanceStore, metricsStore, paymentStore,
 * auditLogStore, quickAttendance) bu fonksiyonu kullandığı için tek yerden
 * korunurlar.
 */
export const isDateInClosedPeriod = (dateStr: string): boolean => {
  const { closed, closedLoaded } = usePeriodStore.getState();
  if (!closedLoaded) return true;
  return closed.some((c) => c.period === periodOf(dateStr));
};

/** Kapalı ya da kilidi bilinmeyen döneme yazma denemesinde kullanılacak standart hata. */
export class ClosedPeriodError extends Error {
  constructor(dateStr: string) {
    const period = formatPeriod(periodOf(dateStr));
    super(
      usePeriodStore.getState().closedLoaded
        ? `${period} dönemi kapatılmış. ` +
            `Değişiklik yapmak için Ayarlar → Dönem Kilidi bölümünden bu dönemi açın.`
        : `Dönem kilidi verileri yüklenemediği için (${period} dahil) hiçbir döneme ` +
            `yazma yapılamaz. Uygulamayı yeniden başlatın; kilit listesi yüklenene ` +
            `kadar veri güvenli sayılmaz.`,
    );
    this.name = "ClosedPeriodError";
  }
}
