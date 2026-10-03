import { create } from "zustand";
import { workerRepository } from "../repositories/workerRepository";
import { workerRateRepository } from "../repositories/workerRateRepository";
import type { Worker, WorkerRate, WorkerType } from "../types";
import { reportError } from "../lib/errorMonitoring";
import { ClosedPeriodError, usePeriodStore } from "./periodStore";
import { executeTransaction } from "../lib/db";
import { sqlLiteral } from "../lib/sql";
import { todayKey } from "../lib/period";
import {
  describeRateChangeImpact,
  rateChangeImpact,
  type RateChangeImpact,
} from "../lib/rateChangeImpact";

/**
 * `worker_rate_history` satırını transaction betiği olarak üretir.
 * Aynı gün için ikinci bir değişiklik yapılırsa üzerine yazar
 * (`workerRateRepository.upsert` ile aynı davranış).
 *
 * `worker_id` bir SQL ifadesi olarak verilir: ya bağlı değer (`sqlLiteral(id)`)
 * ya da transaction içinde yeni satırın id'sini okuyan bir alt sorgu.
 */
const rateHistoryUpsert = (
  workerIdExpr: string,
  validFrom: string,
  dailyWage: number,
  workerType: WorkerType,
): string =>
  `INSERT OR ROLLBACK INTO worker_rate_history (worker_id, valid_from, daily_wage, worker_type)
   VALUES (${workerIdExpr}, ${sqlLiteral(validFrom)}, ${sqlLiteral(dailyWage)}, ${sqlLiteral(workerType)})
   ON CONFLICT(worker_id, valid_from) DO UPDATE SET
     daily_wage = excluded.daily_wage,
     worker_type = excluded.worker_type`;

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
   *
   * Geçmişe yürüyen bir ücret değişikliği (K2) `options.confirmRetroactive`
   * olmadan yazılamaz; onay alınmamışsa `RateChangeImpactError` fırlatılır.
   */
  updateWorker: (
    id: number,
    name: string,
    daily_wage: number,
    worker_type: WorkerType,
    effectiveFrom?: string,
    options?: UpdateWorkerOptions,
  ) => Promise<void>;
  updateWorkerStatus: (id: number, is_active: boolean) => Promise<void>;
  /** Tablodaki görünüm: renk ve kısa etiket. Hesaplamayı etkilemez. */
  updateAppearance: (id: number, color: string | null, shortLabel: string | null) => Promise<void>;
  archiveWorker: (id: number) => Promise<void>;
}

/**
 * `updateWorker`'ın geçmişe yürüme kapısını geçmek için gereken bilgi.
 *
 * Bu bayrak KULLANICI ONAYINI temsil eder; ekran onay diyaloğunu açtıktan
 * sonra `true` geçirir. Verilmemiş bir çağrı, geçmişte veri varsa hiçbir
 * yazma yapmadan reddedilir.
 */
export interface UpdateWorkerOptions {
  confirmRetroactive?: boolean;
}

/**
 * Onaysız geçmişe yürüyen ücret/tip değişikliği (K2).
 *
 * Bu bir ARAYÜZ durumu değil, bir KURAL ihlalidir: ekran onay diyaloğunu
 * atlayıp doğrudan store'a geldiğinde de koruma durur. Mesaj
 * `describeRateChangeImpact`'in ürettiği metnin kendisidir; ekran aynı
 * fonksiyonu kullanarak onay diyaloğunda aynı cümleyi gösterir.
 */
export class RateChangeImpactError extends Error {
  /** Kuralın neyi etkilediği — çağıran açıklamayı kendisi üretmek isterse. */
  readonly impact: RateChangeImpact;

  constructor(impact: RateChangeImpact) {
    super(describeRateChangeImpact(impact) ?? "Geçmiş dönemlerin hakedişi değişecek.");
    this.name = "RateChangeImpactError";
    this.impact = impact;
  }
}

// `earliestDataPeriod === null` durumu da `rateChangeImpact` içinde ele
// alınır (fail-closed). Burada AYRI bir fallback hesabı tutmak iki katmanın
// farklı karar vermesine yol açıyordu: ekran `rateChangeImpact` çağırıp onay
// diyaloğunu açarken store "onay gerekmez" deyip yazıyordu.

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
      // Tek transaction: çalışan kaydı ile açılış ücret kaydı ayrışamaz.
      // İkincisi başarısız olursa yarım kalmış bir çalışan oluşmaz.
      await executeTransaction([
        `INSERT OR ROLLBACK INTO workers (name, daily_wage, worker_type, is_active)
         VALUES (${sqlLiteral(name)}, ${sqlLiteral(daily_wage)}, ${sqlLiteral(worker_type)}, 1)`,
        // Açılış ücret kaydı: geçmişe dönük hesaplarda da bu değer kullanılsın.
        // Yeni çalışanın id'si aynı transaction içinde `last_insert_rowid()` ile okunur.
        rateHistoryUpsert(
          "(SELECT id FROM workers WHERE id = last_insert_rowid())",
          RATE_HISTORY_EPOCH,
          daily_wage,
          worker_type,
        ),
      ]);

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
    options?: UpdateWorkerOptions,
  ) => {
    set({ isLoading: true, error: null });
    try {
      const current = get().workers.find((w) => w.id === id);
      const rateChanged =
        !current || current.daily_wage !== daily_wage || current.worker_type !== worker_type;
      const from = effectiveFrom || RATE_HISTORY_EPOCH;

      if (rateChanged) {
        /**
         * Geçmişe yürüyen ücret/tip değişikliği (K2) — uyar, engelleme.
         *
         * Kilitli ay eskiden burada `ClosedPeriodError` ile engelleniyordu;
         * kullanıcıya çıkış yolu gösterilmediği için yol bulamıyordu. Artık
         * kilitli ay onayla düzeltilebilir. Kapı üç katmanlı:
         *
         *  1. Kilit listesi okunmamışsa hangi dönemin kapalı olduğu BİLİNMEZ;
         *     etki hesaplanamayacağı için hiçbir yazma yapılmaz
         *     (fail-closed).
         *  2. `earliestDataPeriod` bilinmiyorsa da etki hesaplanamaz; yine
         *     fail-closed, en kötü durum varsayılır ve onay istenir.
         *  3. Etki hesaplanabiliyorsa `rateChangeImpact` saf olarak döner.
         *     Onay gerekiyorsa ve `confirmRetroactive` verilmemişse hiçbir
         *     yazma yapılmadan hata fırlatılır.
         *
         * Ekran onayı `confirmRetroactive: true` ile taşır; onaysız gelen her
         * çağrı — ekran atlanırsa da — reddedilir.
         */
        const { closed, closedLoaded, earliestDataPeriod } = usePeriodStore.getState();
        if (!closedLoaded) throw new ClosedPeriodError(from);

        // TEK kaynak: `earliestDataPeriod` bilinmiyorsa da aynı saf fonksiyon
        // çağrılır (fail-closed, en kötü durum varsayılır). Bileşen de aynı
        // fonksiyonu çağırdığı için iki katman aynı kararı verir.
        const impact = rateChangeImpact({
          effectiveFrom: from,
          today: todayKey(),
          earliestDataPeriod,
          closedPeriods: closed.map((c) => c.period),
        });

        if (impact.requiresConfirmation && !options?.confirmRetroactive) {
          const err = new RateChangeImpactError(impact);
          set({ error: err.message });
          throw err;
        }

        // Tek transaction: `workers` satırı ile `worker_rate_history` satırı
        // ya birlikte uygulanır ya hiçbiri. Geçmişe yürüyen değişiklik
        // onaylı olduğu için buradan sonrası normal yazma yoludur.
        await executeTransaction([
          `UPDATE OR ROLLBACK workers SET name = ${sqlLiteral(name)}, daily_wage = ${sqlLiteral(
            daily_wage,
          )}, worker_type = ${sqlLiteral(worker_type)} WHERE id = ${sqlLiteral(id)}`,
          rateHistoryUpsert(sqlLiteral(id), from, daily_wage, worker_type),
        ]);
      } else {
        // Yalnızca ad değişiyor: hakediş etkilenmediği için geçmiş kapısı da
        // devreye girmez; tek ifade yeterli, transaction'a gerek yok.
        await workerRepository.update(id, name, daily_wage, worker_type);
      }

      await get().fetchWorkers();
      await get().fetchRateHistory();
      set({ isLoading: false });
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error), isLoading: false });
      throw error;
    }
  },

  updateAppearance: async (id: number, color: string | null, shortLabel: string | null) => {
    try {
      await workerRepository.updateAppearance(id, color, shortLabel);
      await get().fetchWorkers();
    } catch (error: unknown) {
      set({ error: error instanceof Error ? error.message : String(error) });
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
