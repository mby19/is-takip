import type { Worker } from "../types";

export interface DailyEarnings {
  totalWorkerCosts: number;
  netProfit: number;
  partnerShare: number;
  individualEarnings: Record<number, number>;
}

export function calculateDailyEarnings(
  workers: Worker[],
  attendances: Record<number, "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null>,
  totalEarned: number,
  extraExpenses: number,
): DailyEarnings {
  if (workers.length === 0) {
    return { totalWorkerCosts: 0, netProfit: 0, partnerShare: 0, individualEarnings: {} };
  }

  const individualEarnings: Record<number, number> = {};
  let totalWorkerCosts = 0;
  const activePartners: { id: number; factor: number }[] = [];

  for (const worker of workers) {
    const status = attendances[worker.id] || null;
    let factor = 0;
    if (status === "FULL") factor = 1;
    else if (status === "HALF") factor = 0.5;

    if (worker.worker_type === "GUNLUK") {
      const cost = worker.daily_wage * factor;
      individualEarnings[worker.id] = cost;
      totalWorkerCosts += cost;
    } else if (worker.worker_type === "ORTAK" && factor > 0) {
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
