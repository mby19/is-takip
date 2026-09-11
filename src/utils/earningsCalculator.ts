import type { Worker, WorkerRate, WorkerType, AttendanceStatus } from "../types";

export interface DailyEarnings {
  /** Yevmiyeli personele o gün ödenecek toplam tutar. */
  totalWorkerCosts: number;
  /** Ciro − gider − yevmiyeler. Ortaklar arasında paylaşılacak tutar. */
  netProfit: number;
  /** Tam gün çalışan bir ortağın payı. */
  partnerShare: number;
  individualEarnings: Record<number, number>;
}

export interface EffectiveRate {
  daily_wage: number;
  worker_type: WorkerType;
}

export type RateResolver = (worker: Worker) => EffectiveRate;

/** Durumun kazanç ağırlığı. HOLIDAY (tatil) çalışılmayan gün sayılır. */
export function statusWeight(status: AttendanceStatus | null | undefined): number {
  if (status === "FULL") return 1;
  if (status === "HALF") return 0.5;
  return 0;
}

const ownRate: RateResolver = (w) => ({ daily_wage: w.daily_wage, worker_type: w.worker_type });

/**
 * Bir çalışanın verilen tarihte geçerli ücret/tip bilgisini bulur.
 * Geçmiş kaydı yoksa çalışanın güncel değerlerine düşer.
 */
export function resolveWorkerRate(
  worker: Worker,
  date: string,
  history: readonly WorkerRate[],
): EffectiveRate {
  let best: WorkerRate | null = null;

  for (const rate of history) {
    if (Number(rate.worker_id) !== Number(worker.id)) continue;
    if (String(rate.valid_from) > date) continue;
    if (!best || String(rate.valid_from) > String(best.valid_from)) best = rate;
  }

  if (!best) return ownRate(worker);
  return { daily_wage: Number(best.daily_wage), worker_type: best.worker_type };
}

/** Verilen tarih için ücret çözücü üretir. */
export function rateResolverFor(date: string, history: readonly WorkerRate[]): RateResolver {
  if (history.length === 0) return ownRate;
  return (worker) => resolveWorkerRate(worker, date, history);
}

/**
 * Bir günün hakediş dağılımı.
 *
 * Model: yevmiyeliler önce sabit ücretlerini alır; kalan net kâr
 * (ciro − gider − yevmiyeler) çalışan ortaklar arasında gün ağırlığına göre
 * bölüşülür. Zarar da aynı şekilde paylaşılır.
 *
 * Bu fonksiyon uygulamadaki TEK hakediş formülüdür — hem gün detayı hem aylık
 * döküm buradan geçer.
 */
export function calculateDailyEarnings(
  workers: readonly Worker[],
  attendances: Record<number, AttendanceStatus | null>,
  totalEarned: number,
  extraExpenses: number,
  resolveRate: RateResolver = ownRate,
): DailyEarnings {
  if (workers.length === 0) {
    return { totalWorkerCosts: 0, netProfit: 0, partnerShare: 0, individualEarnings: {} };
  }

  const individualEarnings: Record<number, number> = {};
  let totalWorkerCosts = 0;
  const activePartners: { id: number; factor: number }[] = [];

  for (const worker of workers) {
    const factor = statusWeight(attendances[worker.id]);
    const rate = resolveRate(worker);

    if (rate.worker_type === "GUNLUK") {
      const cost = rate.daily_wage * factor;
      individualEarnings[worker.id] = cost;
      totalWorkerCosts += cost;
    } else if (rate.worker_type === "ORTAK" && factor > 0) {
      activePartners.push({ id: worker.id, factor });
    }
  }

  const hasActiveWork = totalWorkerCosts > 0 || activePartners.length > 0;
  const netProfit = hasActiveWork ? totalEarned - extraExpenses - totalWorkerCosts : 0;

  const totalPartnerWeight = activePartners.reduce((sum, p) => sum + p.factor, 0);
  const partnerShare = totalPartnerWeight > 0 ? netProfit / totalPartnerWeight : 0;

  for (const p of activePartners) {
    individualEarnings[p.id] = partnerShare * p.factor;
  }

  return { totalWorkerCosts, netProfit, partnerShare, individualEarnings };
}
