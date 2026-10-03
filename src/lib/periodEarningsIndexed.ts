import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import { tr } from "date-fns/locale";
import type { AttendanceStatus, Worker } from "../types";
import type { DailyBreakdown } from "../utils/calculations";
import {
  allocateCents,
  calculateDailyEarnings,
  rateResolverFromIndex,
  roundMoney,
  type RateIndex,
} from "../utils/earningsCalculator";
import {
  buildPeriodIndex,
  type DateRange,
  type PeriodEarnings,
  type PeriodIndex,
  type PeriodLoader,
} from "./periodStats";

/**
 * Dönem hakedişinin **indeksli** yolu (ADR-0009).
 *
 * ## Neden ayrı bir katman?
 *
 * `periodStats.calculatePeriodEarnings` gün döngüsünde `rateResolverFor`
 * çağırarak her gün × her çalışan için ücret geçmişini baştan doğrusal
 * tarıyor. Ölçülen maliyet — 5 yıl, 60 çalışan, 6400 ücret kaydı —
 * **3961 ms**; aynı hesap indeksle **24 ms** (162×). `periodStats` bu işin
 * sahipliği dışında olduğu için düzeltilemiyor; bu katman aynı hesabı
 * indeksli çözümleyiciyle yapar ve `useDomainMonthData` bunu kullanır.
 *
 * ## Para doğruluğu
 *
 * Burada **hiçbir para formülü kopyalanmaz**: günlük dağıtım
 * `calculateDailyEarnings`, kuruş tahsisi `allocateCents`, yuvarlama
 * `roundMoney` — hepsi tek kaynaktan gelir. Ayrılan tek şey, tarihe göre
 * ücret çözümlemesinin *nasıl* yapıldığı: taramak yerine ikili arama.
 *
 * Bu yüzden `src/__tests__/periodEarningsIndexed.test.ts` her iki yolu
 * (rastgele ücret geçmişi, karışık durumlar, kuruş kalanlı günler) hücre
 * hücre karşılaştırır: hızlandırma bir kuruş değiştiremez.
 */
/**
 * `periodStats.calculatePeriodEarnings` ile **aynı** sonucu üreten indeksli
 * karşılığı. Parametre farkı: `rateHistory` yerine bir kez kurulmuş
 * `rateIndex` alır.
 *
 * Gün döngüsü ve tek-yuvarlama kuralı `periodStats`'in birebir aynısıdır:
 * gün satırları ham tutarlarla toplanır, `allocateCents` ile kuruş cinsine
 * tahsis edilir, toplam satırların toplamından türetilir (ADR-0009 §1).
 */
export function calculatePeriodEarningsIndexed(
  pool: readonly Worker[],
  month: Date,
  index: PeriodIndex,
  rateIndex: RateIndex,
  withBreakdown = false,
): PeriodEarnings {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  const earned = new Map<number, number>();
  const breakdown = new Map<number, DailyBreakdown[]>();
  const rawsByWorker: number[][] = pool.map(() => new Array<number>(days.length).fill(0));
  for (const w of pool) {
    earned.set(w.id, 0);
    if (withBreakdown) breakdown.set(w.id, []);
  }

  let netProfit = 0;
  let undistributed = 0;
  let wageCost = 0;

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const day = days[dayIndex];
    const dateStr = format(day, "yyyy-MM-dd");
    const rows = index.attendanceByDate.get(dateStr) ?? [];
    const metric = index.metricByDate.get(dateStr);

    const statusMap: Record<number, AttendanceStatus | null> = {};
    for (const row of rows) statusMap[Number(row.worker_id)] = row.status;

    // Tek fark: `rateResolverFor` yerine önceden kurulmuş indeksten
    // O(log kayıt) çözümleyici.
    const dayResult = calculateDailyEarnings(
      pool,
      statusMap,
      metric?.total_earned ?? 0,
      metric?.extra_expenses ?? 0,
      rateResolverFromIndex(rateIndex, dateStr),
    );

    netProfit += dayResult.netProfit;
    undistributed += dayResult.undistributed;
    wageCost += dayResult.totalWorkerCosts;

    for (let i = 0; i < pool.length; i++) {
      const w = pool[i];
      const status = statusMap[w.id] ?? null;
      const amount = dayResult.individualEarnings[w.id] ?? 0;
      rawsByWorker[i][dayIndex] = amount;

      if (withBreakdown) {
        breakdown.get(w.id)?.push({
          date: dateStr,
          dayName: format(day, "EEE", { locale: tr }),
          dayNum: format(day, "dd"),
          status,
          earned: 0,
        });
      }
    }
  }

  for (let i = 0; i < pool.length; i++) {
    const id = pool[i].id;
    const allocated = allocateCents(rawsByWorker[i]);
    const rows = withBreakdown ? breakdown.get(id) : undefined;
    let total = 0;
    for (let d = 0; d < allocated.length; d++) {
      total += allocated[d];
      if (rows) rows[d].earned = allocated[d];
    }
    earned.set(id, roundMoney(total));
  }

  return {
    earned,
    breakdown,
    netProfit: roundMoney(netProfit),
    undistributed: roundMoney(undistributed),
    wageCost: roundMoney(wageCost),
  };
}

/**
 * `periodStats.accumulateAllTimeEarned` ile aynı sonucu üreten indeksli
 * karşılığı.
 *
 * İki kazanç: ücret indeksi **yıllar boyunca bir kez** kurulur (`rateIndex`
 * parametre olarak gelir) ve her yılın tarih dizini bir kez kurulup o yılın
 * on iki ayına paylaşılır — taranan satır sayısı aynı, maliyet değil.
 */
export async function accumulateAllTimeEarnedIndexed(
  pool: readonly Worker[],
  rateIndex: RateIndex,
  ranges: readonly DateRange[],
  load: PeriodLoader,
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  for (const w of pool) totals.set(w.id, 0);

  for (const range of ranges) {
    const { attendance, metrics } = await load(range);
    if (attendance.length === 0) continue;

    const index = buildPeriodIndex(attendance, metrics);
    const [year, month] = range.start.slice(0, 7).split("-").map(Number);
    const yearStart = new Date(year, (month || 1) - 1, 1);
    for (let i = 0; i < 12; i++) {
      const month = new Date(yearStart.getFullYear(), yearStart.getMonth() + i, 1);
      const { earned } = calculatePeriodEarningsIndexed(pool, month, index, rateIndex);
      for (const [id, value] of earned) {
        totals.set(id, (totals.get(id) ?? 0) + value);
      }
    }
  }

  return totals;
}
