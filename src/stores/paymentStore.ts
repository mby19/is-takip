import { create } from "zustand";
import { paymentRepository } from "../repositories/paymentRepository";
import type { Payment } from "../types";
import { reportError } from "../lib/errorMonitoring";
import { isDateInClosedPeriod, ClosedPeriodError } from "./periodStore";
import { overpayExcess } from "../lib/paymentOverpay";

interface PaymentState {
  /** Yüklenmiş çalışanın ödemeleri. `loadedWorkerId` ile birlikte okunmalıdır. */
  payments: Payment[];
  /** Hangi çalışanın ödemelerinin `payments` içinde olduğu. */
  loadedWorkerId: number | null;
  /** Çalışan bazlı ödeme önbelleği: worker_id -> Payment[] */
  paymentsByWorker: Record<number, Payment[]>;
  /** Aynı worker+date için uçuşta olan ekleme istekleri (çift ödeme koruması). */
  inFlightAdds: Record<string, true>;
  isLoading: boolean;
  error: string | null;
  fetchWorkerPayments: (worker_id: number) => Promise<void>;
  addPayment: (
    worker_id: number,
    amount: number,
    date: string,
    description?: string,
    /**
     * Bakiye aşımı onayı. `balance` verilmezse kontrol yapılmaz —
     * çağıran bakiyeyi bilmiyordur ve engellemek onun yerine geçmez.
     * `balance` verilip `confirmed` yoksa aşım onay diyaloğu bekler.
     */
    overpay?: PaymentOverpayContext,
  ) => Promise<void>;
  deletePayment: (id: number, worker_id: number) => Promise<void>;
}

/**
 * Aşım onayı — bakiye aşımı kontrolünün bileşene bırakılmaması için
 * `addPayment`'a açıkça geçirilir. Kural `paymentOverpay.ts`'te saf olarak
 * tanımlıdır; burada yalnız UYGULANIR.
 */
export interface PaymentOverpayContext {
  /** Tüm dönemler dahil kalan bakiye (₺) — negatifse zaten fazla ödeme vardır. */
  balance: number;
  /**
   * `balance`nin HANGİ ödeme toplamından türetildiği.
   *
   * Çağıranın bakiyesi kendi ödeme listesinden hesaplandığı için iki ödeme
   * arasında bayatlayabilir; store yalnız o değere bakınca 70.000 ₺'luk
   * aşım onaysız kaydedilebiliyordu (PROBE-Q). Bu snapshot verilirse store
   * toplam ödemeyi veritabanından yeniden okuyup bakiyeyi DÜZELTİR.
   * Verilmezse `balance` doğrudan kullanılır (fail-closed değil; çağıran
   * bakiyeyi türetemiyordur).
   */
  paidTotal?: number;
  /** Kullanıcı onay diyaloğunu geçti mi? */
  confirmed?: boolean;
}

/** Aşım onayı alınmadan yazılan ödeme. `excess` kadar TL fazla ödeme görünecek. */
export class PaymentOverpayError extends Error {
  readonly excess: number;

  constructor(excess: number) {
    super(
      `Bu ödeme bakiyeyi ${Math.round(excess).toLocaleString("tr-TR")} TL aşıyor. ` +
        `Onaylanmadan kaydedilemez.`,
    );
    this.name = "PaymentOverpayError";
    this.excess = excess;
  }
}

/**
 * Uçuş koruması anahtarı.
 *
 * Aşım kontrolü bakiyeye bakar; aynı çalışana İKİ ödeme aynı anda
 * girmişse ikisi de aynı (bayat olabilen) bakiyeye bakar ve ikisi de
 * onaysız geçebilir. Bu yüzden koruma çalışan+tarif değil, ÇALIŞAN
 * düzeyindedir: farklı tarihlerdeki iki ödeme de sıraya girer.
 */
const flightKey = (worker_id: number) => `worker:${worker_id}`;

export const usePaymentStore = create<PaymentState>((set, get) => ({
  payments: [],
  loadedWorkerId: null,
  paymentsByWorker: {},
  inFlightAdds: {},
  isLoading: false,
  error: null,

  fetchWorkerPayments: async (worker_id: number) => {
    // Hemen temizle: yeni çalışana geçilirken eski çalışanın ödemeleri
    // onun başlığı altında bir an bile görünmemeli (yanlış kişiye ödeme riski).
    set((state) => ({
      payments: state.loadedWorkerId === worker_id ? state.payments : [],
      loadedWorkerId: worker_id,
      isLoading: true,
      error: null,
    }));
    try {
      const result = await paymentRepository.findByWorker(worker_id);
      // Arada başka çalışanın verisi istenmişse bu yanıt artık geçersizdir.
      if (get().loadedWorkerId !== worker_id) return;
      set((state) => ({
        payments: result,
        paymentsByWorker: { ...state.paymentsByWorker, [worker_id]: result },
        isLoading: false,
      }));
    } catch (error: unknown) {
      if (get().loadedWorkerId !== worker_id) return;
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
    }
  },

  addPayment: async (
    worker_id: number,
    amount: number,
    date: string,
    description?: string,
    overpay?: PaymentOverpayContext,
  ) => {
    if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) {
      const msg = "Geçerli bir tutar giriniz (0'dan büyük bir sayı olmalı).";
      set({ error: msg });
      throw new Error(msg);
    }
    const dStr = String(date).trim();
    if (isDateInClosedPeriod(dStr)) throw new ClosedPeriodError(dStr);

    // Aynı çalışan için uçuşta istek varsa ikinci kayıt reddedilir — çalışan
    // düzeyinde, çünkü aşım kontrolü bakiyeye bakar ve iki ödeme aynı bayat
    // bakiyeye bakıp ikisi de onaysız geçebilirdi.
    const key = flightKey(worker_id);
    if (get().inFlightAdds[key]) throw new Error("Bu ödeme kaydediliyor, lütfen bekleyin.");
    set((state) => ({ inFlightAdds: { ...state.inFlightAdds, [key]: true } }));

    try {
      // Bakiye aşımı: engelleyen değil, ONAY ZORUNLULUĞU koyan kural. Ekran onay
      // diyaloğunu atlayıp doğrudan buraya gelirse yazma yine de gerçekleşmez —
      // koruma bileşende değil, katmanın bu satırında.
      //
      // Bakiye çağırandan gelir ve bayat olabilir (bileşenin listesi tazelenmeden
      // ikinci ödeme). Bu yüzden toplam ödeme veritabanından yeniden okunur ve
      // `paidTotal` farkı bakiyeye yansıtılır: 50.000 → 20.000 ödeme → 40.000
      // ödeme artık bayat 50.000'e değil, 30.000'e bakar.
      if (overpay) {
        const balance =
          overpay.paidTotal === undefined
            ? overpay.balance
            : overpay.balance -
              ((await paymentRepository.sumByWorker(worker_id)) - overpay.paidTotal);
        const excess = overpayExcess(balance, amount);
        if (excess > 0 && !overpay.confirmed) {
          const err = new PaymentOverpayError(excess);
          set({ error: err.message });
          throw err;
        }
      }

      await paymentRepository.create(worker_id, amount, dStr, description);
      await get().fetchWorkerPayments(worker_id);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg });
      reportError(error instanceof Error ? error : new Error(msg), { scope: "addPayment" });
      throw error;
    } finally {
      set((state) => {
        const next = { ...state.inFlightAdds };
        delete next[key];
        return { inFlightAdds: next };
      });
    }
  },

  deletePayment: async (id: number, worker_id: number) => {
    // Kilit kontrolü yalnızca kayıt gerçekten store'da varsa çalışabilir.
    // Yoksa sessizce silme yerine hata fırlat.
    const bucket = get().paymentsByWorker[worker_id];
    const list = bucket ?? get().payments;
    const target = list.find((p) => p.id === id);
    if (!target) {
      const msg = "Ödeme kaydı bulunamadı";
      set({ error: msg });
      throw new Error(msg);
    }
    if (isDateInClosedPeriod(target.date)) throw new ClosedPeriodError(target.date);

    try {
      // worker_id ile sınırlı: yanlış çalışanın ödemesi silinemez.
      const result = await paymentRepository.remove(id, worker_id);
      if (result.rowsAffected === 0) {
        const msg = "Ödeme kaydı bulunamadı";
        set({ error: msg });
        throw new Error(msg);
      }
      await get().fetchWorkerPayments(worker_id);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      set({ error: msg });
      reportError(error instanceof Error ? error : new Error(msg), { scope: "deletePayment" });
      throw error;
    }
  },
}));
