import { describe, it, expect } from "vitest";
import { calculateDailyEarnings, roundMoney } from "../utils/earningsCalculator";
import {
  calculateBusinessTotals,
  calculateWorkerStats,
  createWorkerStatsContext,
} from "../utils/calculations";
import { buildPeriodIndex, calculatePeriodEarnings } from "../lib/periodStats";
import type { Attendance, DailyMetric, Worker, WorkerType } from "../types";

/**
 * Ortaklara **dağıtılmayan** tutarın değişmezi (ADR-0009).
 *
 * Tek doğruluk kaynağı `undistributed` alanıdır. İki durumu kapsar:
 *  1. **Zarar** (K3 kararı): `netProfit < 0` iken ortak payı 0'dır, zarar
 *     işletmede kalır → `undistributed = netProfit` (`≤ 0`).
 *  2. **Aktif ortak yokken kâr**: dağıtılacak ortak bulunmadığından kâr
 *     havuzda kalır → `undistributed = netProfit` (`> 0`). Bu para ne
 *     dağıtılır ne raporlanırsa **kaybolur**.
 *
 * Değişmezler:
 *  - `Σ ortak payları + undistributed = netProfit`
 *  - `Σ (tüm çalışan hakedişleri) = totalWorkerCosts + netProfit − undistributed`
 *  - Yevmiyeli (GUNLUK) ücretler ne kârda ne zararda etkilenmez.
 */

const MAY = new Date(2026, 4, 1);

const worker = (id: number, type: WorkerType, daily_wage: number): Worker => ({
  id,
  name: `W${id}`,
  daily_wage,
  worker_type: type,
  is_active: true,
  created_at: "2026-01-01",
});

const metric = (date: string, total: number, expenses = 0): DailyMetric => ({
  id: 0,
  date,
  production_amount: total,
  total_earned: total,
  extra_expenses: expenses,
  is_holiday: false,
});

const att = (
  workerId: number,
  date: string,
  status: Attendance["status"] = "FULL",
): Attendance => ({ id: 0, worker_id: workerId, date, status });

const sumAll = (result: { individualEarnings: Record<number, number> }): number =>
  Object.values(result.individualEarnings).reduce((a, b) => a + b, 0);

/** Ortakların (GUNLUK olmayanların) toplam hakedişi. */
const partnerSum = (
  result: { individualEarnings: Record<number, number> },
  partnerIds: readonly number[],
): number => partnerIds.reduce((a, id) => a + (result.individualEarnings[id] ?? 0), 0);

describe("K3 — zarar gününde ortak payı sıfırlanır", () => {
  it("zararda ortak 0 alır, günlükçü yevmiyesini alır, zarar ayrı alanda durur", () => {
    // 2 günlükçü (1000 + 1000) + 2 ortak; ciro 100, gider 0.
    const pool = [
      worker(1, "GUNLUK", 1000),
      worker(2, "GUNLUK", 1000),
      worker(3, "ORTAK", 0),
      worker(4, "ORTAK", 0),
    ];
    const result = calculateDailyEarnings(
      pool,
      { 1: "FULL", 2: "FULL", 3: "FULL", 4: "FULL" },
      100,
      0,
    );

    expect(result.netProfit).toBe(-1900);
    expect(result.undistributed).toBe(-1900);
    expect(result.partnerShare).toBe(0);
    expect(result.individualEarnings[3]).toBe(0);
    expect(result.individualEarnings[4]).toBe(0);
    expect(result.individualEarnings[1]).toBe(1000);
    expect(result.individualEarnings[2]).toBe(1000);
  });

  it("kâr gününde davranış hiç değişmemiştir: undistributed 0, paylar netProfit'i bölüyor", () => {
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0), worker(3, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL", 3: "FULL" }, 5000, 500);

    expect(result.netProfit).toBe(3500);
    expect(result.undistributed).toBe(0);
    expect(result.individualEarnings[2]).toBe(1750);
    expect(result.individualEarnings[3]).toBe(1750);
    expect(result.individualEarnings[1]).toBe(1000);
  });

  it("sıfır gününde ortak 0 alır, undistributed 0'dır (negatif sıfır üretmez)", () => {
    const pool = [worker(1, "ORTAK", 0), worker(2, "ORTAK", 0)];
    // Ciro tam yevmiyeye eşit → net kâr 0.
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL" }, 0, 0);

    expect(result.netProfit).toBe(0);
    expect(result.undistributed).toBe(0);
    expect(Object.is(result.undistributed, -0)).toBe(false);
  });

  it("tek kişilik ortak havuzunda da aynı kural", () => {
    const solo = [worker(1, "ORTAK", 0)];
    const profit = calculateDailyEarnings(solo, { 1: "FULL" }, 500, 200);
    expect(profit.netProfit).toBe(300);
    expect(profit.undistributed).toBe(0);
    expect(profit.individualEarnings[1]).toBe(300);

    const lossDay = calculateDailyEarnings(solo, { 1: "FULL" }, 0, 900);
    expect(lossDay.netProfit).toBe(-900);
    expect(lossDay.undistributed).toBe(-900);
    expect(lossDay.individualEarnings[1]).toBe(0);
  });

  it("yarım gün ağırlığı zararı dağıtmaz", () => {
    const pool = [worker(1, "ORTAK", 0), worker(2, "ORTAK", 0)];
    const profit = calculateDailyEarnings(pool, { 1: "HALF", 2: "FULL" }, 100, 0);
    expect(profit.netProfit).toBe(100);
    expect(profit.undistributed).toBe(0);

    const loss = calculateDailyEarnings(pool, { 1: "HALF", 2: "FULL" }, 0, 100);
    expect(loss.netProfit).toBe(-100);
    expect(loss.undistributed).toBe(-100);
    expect(loss.individualEarnings[1]).toBe(0);
    expect(loss.individualEarnings[2]).toBe(0);
  });
});

/**
 * BUG #1: ortak yokken (ya da hepsi gelmemişken) kâr havuzu hesaplanıyor,
 * dağıtılmıyor ve HİÇBİR YERE yazılmıyordu — para sessizce yok oluyordu.
 */
describe("Aktif ortak yokken kâr kaybolmaz", () => {
  it("karışık ekipte ortak ABSENT: 4000 TL kâr raporlanır, dağıtılmaz", () => {
    // Denetim ajanının ölçtüğü ihlal: netProfit 4000, businessLoss 0, Σ çalışan 1000.
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "ABSENT" }, 5000, 0);

    expect(result.totalWorkerCosts).toBe(1000);
    expect(result.netProfit).toBe(4000);
    expect(result.individualEarnings[1]).toBe(1000);
    expect(result.individualEarnings[2] ?? 0).toBe(0);

    // Kayıp noktası: 4000 TL ne dağıtıldı ne raporlandı.
    expect(result.undistributed).toBe(4000);
    expect(roundMoney(partnerSum(result, [2]) + result.undistributed)).toBe(result.netProfit);
    expect(roundMoney(sumAll(result) - result.totalWorkerCosts + result.undistributed)).toBe(
      result.netProfit,
    );
  });

  it("ekipte hiç ORTAK yok: net 6800'nin tamamı dağıtılmadan raporlanır", () => {
    // Denetim ajanının ölçtüğü ikinci ihlal: net 6800, dağıtım yok. 4600 TL
    // kâr (net − yevmiye) hiçbir yere yazılmıyordu.
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "GUNLUK", 1200)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL" }, 10000, 1000);

    expect(result.totalWorkerCosts).toBe(2200);
    expect(result.netProfit).toBe(6800);
    expect(sumAll(result)).toBe(2200);
    expect(result.undistributed).toBe(6800);
    // Yevmiye ayrı hesaplandığı için: Σ çalışan + undistributed = yevmiye + net kâr.
    expect(roundMoney(sumAll(result) + result.undistributed)).toBe(
      roundMoney(result.totalWorkerCosts + result.netProfit),
    );
  });

  it("ortak var ama hepsi ABSENT: kârın tamamı dağıtılmayan olarak çıkar", () => {
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0), worker(3, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "ABSENT", 3: "ABSENT" }, 7000, 500);

    expect(result.netProfit).toBe(5500);
    expect(result.undistributed).toBe(5500);
    expect(roundMoney(partnerSum(result, [2, 3]) + result.undistributed)).toBe(result.netProfit);
  });

  it("ortak var ama hepsi HOLIDAY: aynı kural", () => {
    const pool = [worker(1, "GUNLUK", 800), worker(2, "ORTAK", 0), worker(3, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "HOLIDAY", 3: "HOLIDAY" }, 3000, 0);

    expect(result.netProfit).toBe(2200);
    expect(result.undistributed).toBe(2200);
  });

  it("ortak var ama hepsi HALF: kâr dağıtılır, undistributed 0 kalır", () => {
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0), worker(3, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "HALF", 3: "HALF" }, 5000, 500);

    expect(result.netProfit).toBe(3500);
    expect(result.undistributed).toBe(0);
    expect(result.individualEarnings[2]).toBe(1750);
    expect(result.individualEarnings[3]).toBe(1750);
  });

  it("ortak YOK ama gün eşiği de sağlanmıyorsa ortak bulunmaz (netProfit 0)", () => {
    // Puantaj var, ciro/gider yok → gün eşiği: ne kâr ne zarar.
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL" }, 0, 0);

    expect(result.netProfit).toBe(0);
    expect(result.undistributed).toBe(0);
  });
});

describe("Değişmez — Σ ortak payları + undistributed = netProfit", () => {
  /** Ekstra ücretler para dağıtımında kuruş kaybı yaratmasın diye tam sayı. */
  const pool = [worker(1, "GUNLUK", 1234.56), worker(2, "ORTAK", 0), worker(3, "ORTAK", 0)];

  const scenarios: { label: string; earned: number; expenses: number }[] = [
    { label: "büyük kâr", earned: 10000, expenses: 2500.75 },
    { label: "küçük kâr", earned: 3000, expenses: 0 },
    { label: "tam sıfır", earned: 2469.12, expenses: 0 },
    { label: "kuruş eşiği zarar", earned: 2469.11, expenses: 0 },
    { label: "derin zarar", earned: 0, expenses: 9999.99 },
    { label: "yarım gün + zarar", earned: 100, expenses: 5000 },
  ];

  for (const s of scenarios) {
    it(`${s.label} → toplam korunur`, () => {
      const result = calculateDailyEarnings(
        pool,
        { 1: "FULL", 2: "FULL", 3: "HALF" },
        s.earned,
        s.expenses,
      );

      expect(roundMoney(partnerSum(result, [2, 3]) + result.undistributed)).toBe(result.netProfit);
      expect(roundMoney(sumAll(result) - result.totalWorkerCosts + result.undistributed)).toBe(
        result.netProfit,
      );
      expect(Object.is(result.undistributed, -0)).toBe(false);
    });
  }
});

describe("Değişmez — dağıtılmayan tutarın işareti netProfit ile aynı yönde", () => {
  it("zarar günü negatif, ortaksız kâr günü pozitif, dağıtılan gün sıfır", () => {
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0), worker(3, "ORTAK", 0)];

    const loss = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL", 3: "FULL" }, 0, 5000);
    expect(loss.netProfit).toBe(-6000);
    expect(loss.undistributed).toBe(-6000);

    const idleProfit = calculateDailyEarnings(
      pool,
      { 1: "FULL", 2: "ABSENT", 3: "ABSENT" },
      9000,
      0,
    );
    expect(idleProfit.netProfit).toBe(8000);
    expect(idleProfit.undistributed).toBe(8000);

    const shared = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL", 3: "FULL" }, 9000, 0);
    expect(shared.netProfit).toBe(8000);
    expect(shared.undistributed).toBe(0);
  });
});

describe("Üç hesap yolu aynı değişmezi uygular", () => {
  /** Karışık ekip: 1 günlükçü + 2 ortak. 5 Mayıs kâr, 6 Mayıs zarar. */
  const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0), worker(3, "ORTAK", 0)];
  const metrics = [metric("2026-05-05", 6000, 1000), metric("2026-05-06", 500, 3000)];
  const attendances = [
    att(1, "2026-05-05"),
    att(2, "2026-05-05"),
    att(3, "2026-05-05"),
    att(1, "2026-05-06"),
    att(2, "2026-05-06"),
    att(3, "2026-05-06"),
  ];

  it("calculateWorkerStats: zarar günü ortak hakedişine yazılmaz", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, pool, []);
    const totals = pool.map((w) =>
      calculateWorkerStats(w, MAY, metrics, attendances, pool, [], [], ctx),
    );

    const partnerMay5 = ctx.dayEarnings(pool, "2026-05-05");
    const partnerMay6 = ctx.dayEarnings(pool, "2026-05-06");
    // 5 Mayıs: 6000 − 1000 − 1000 = 4000 kâr → 2×2000.
    expect(partnerMay5.netProfit).toBe(4000);
    expect(partnerMay5.undistributed).toBe(0);
    // 6 Mayıs: 500 − 3000 − 1000 = −3500 zarar → dağıtılmaz.
    expect(partnerMay6.netProfit).toBe(-3500);
    expect(partnerMay6.undistributed).toBe(-3500);

    for (const partner of pool.slice(1)) {
      const stats = totals[pool.findIndex((w) => w.id === partner.id)];
      // Yalnızca 5 Mayıs'ın 2000'i.
      expect(stats.totalEarnedInMonth).toBe(2000);
      const day6 = stats.dailyBreakdown.find((d) => d.date === "2026-05-06");
      expect(day6?.earned).toBe(0);
    }

    // GÜNLÜKÇÜ: iki gün yevmiye, 5 Mayıs'ta kâr dağıtılmadığı için yalnız 2×1000.
    expect(totals[0].totalEarnedInMonth).toBe(2000);
  });

  it("calculateBusinessTotals: dönem zararı ayrı alanda, toplam tutuyor", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, pool, []);
    const biz = calculateBusinessTotals(ctx, "2026-05", pool);

    expect(biz.wageCost).toBe(2000);
    expect(biz.netProfit).toBe(500); // 4000 − 3500
    expect(biz.undistributed).toBe(-3500);
    expect(biz.days).toBe(2);

    const workerSum = pool.reduce(
      (total, w) =>
        total +
        calculateWorkerStats(w, MAY, metrics, attendances, pool, [], [], ctx).totalEarnedInMonth,
      0,
    );
    // 1 günlükçü 2000 + 2 ortak 2000 = 6000
    expect(workerSum).toBe(6000);
    expect(roundMoney(biz.wageCost + biz.netProfit - biz.undistributed)).toBe(workerSum);
  });

  it("calculatePeriodEarnings: aylık yol da aynı sayıları verir", () => {
    const index = buildPeriodIndex(attendances, metrics);
    const period = calculatePeriodEarnings(pool, MAY, index, [], true);

    const ctx = createWorkerStatsContext(attendances, metrics, pool, []);
    const biz = calculateBusinessTotals(ctx, "2026-05", pool);

    expect(period.netProfit).toBe(biz.netProfit);
    expect(period.undistributed).toBe(biz.undistributed);
    expect(period.wageCost).toBe(biz.wageCost);
    expect(period.earned.get(1)).toBe(2000);
    expect(period.earned.get(2)).toBe(2000);
    expect(period.earned.get(3)).toBe(2000);

    const earnedSum = pool.reduce((t, w) => t + (period.earned.get(w.id) ?? 0), 0);
    expect(roundMoney(period.wageCost + period.netProfit - period.undistributed)).toBe(earnedSum);
  });

  it("kârlı dönemde undistributed 0'dır ve eski toplam kuralı aynen geçerli", () => {
    const profitMetrics = [metric("2026-05-05", 6000, 1000)];
    const profitAtt = [att(1, "2026-05-05"), att(2, "2026-05-05"), att(3, "2026-05-05")];
    const ctx = createWorkerStatsContext(profitAtt, profitMetrics, pool, []);
    const biz = calculateBusinessTotals(ctx, "2026-05", pool);

    expect(biz.undistributed).toBe(0);
    expect(biz.netProfit).toBe(4000);
    const workerSum = pool.reduce(
      (t, w) =>
        t +
        calculateWorkerStats(w, MAY, profitMetrics, profitAtt, pool, [], [], ctx)
          .totalEarnedInMonth,
      0,
    );
    expect(workerSum).toBe(roundMoney(biz.wageCost + biz.netProfit));
  });
});

/** Dönem düzeyinde ortak yokken kâr kaybolmaz — `Σ earned + undistributed = netProfit + wageCost`. */
describe("Dönem düzeyi — ortak yokken kâr kaybolmaz", () => {
  it("tek günlükçi, ortak hiç yok: dönemin kârının tamamı undistributed'dır", () => {
    const pool = [worker(1, "GUNLUK", 1000)];
    const metrics = [metric("2026-05-04", 10000, 1000), metric("2026-05-05", 8000, 500)];
    const attendances = [att(1, "2026-05-04"), att(1, "2026-05-05")];

    const index = buildPeriodIndex(attendances, metrics);
    const period = calculatePeriodEarnings(pool, MAY, index, [], true);

    // 4 Mayıs: 9000 − 1000 = 8000 · 5 Mayıs: 7500 − 1000 = 6500
    expect(period.wageCost).toBe(2000);
    expect(period.netProfit).toBe(14500);
    expect(period.undistributed).toBe(14500);
    expect(period.earned.get(1)).toBe(2000);

    const earnedSum = pool.reduce((t, w) => t + (period.earned.get(w.id) ?? 0), 0);
    expect(roundMoney(period.wageCost + period.netProfit - period.undistributed)).toBe(earnedSum);
  });

  it("karışık dönem: kârlı gün dağıtılır, ortaksız gün birikir, zarar günü eklenir", () => {
    const pool = [worker(1, "GUNLUK", 1000), worker(2, "ORTAK", 0)];
    // 4 Mayıs ortak aktif → kâr dağıtılır. 5 Mayıs ortak ABSENT → kâr birikir.
    // 6 Mayıs ciro düşük → zarar.
    const metrics = [
      metric("2026-05-04", 6000, 1000),
      metric("2026-05-05", 6000, 1000),
      metric("2026-05-06", 500, 3000),
    ];
    const attendances = [
      att(1, "2026-05-04"),
      att(2, "2026-05-04"),
      att(1, "2026-05-05"),
      att(2, "2026-05-05", "ABSENT"),
      att(1, "2026-05-06"),
      att(2, "2026-05-06"),
    ];

    const index = buildPeriodIndex(attendances, metrics);
    const period = calculatePeriodEarnings(pool, MAY, index, [], true);

    expect(period.wageCost).toBe(3000);
    // 4 Mayıs 4000 kâr (dağıtıldı) · 5 Mayıs 4000 kâr (biriktir) · 6 Mayıs −3500 zarar
    expect(period.netProfit).toBe(4500);
    expect(period.undistributed).toBe(500); // +4000 − 3500
    expect(period.earned.get(1)).toBe(3000);
    expect(period.earned.get(2)).toBe(4000);

    const earnedSum = pool.reduce((t, w) => t + (period.earned.get(w.id) ?? 0), 0);
    expect(roundMoney(period.wageCost + period.netProfit - period.undistributed)).toBe(earnedSum);
  });
});

describe("Günlükçü yevmiyesi dağıtılan kârdan etkilenmez", () => {
  it("ciro sıfır, gider yevmiyeye eşit: yevmiye yine de ödenir", () => {
    const pool = [worker(1, "GUNLUK", 1500), worker(2, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL" }, 0, 1500);
    expect(result.totalWorkerCosts).toBe(1500);
    // ciro 0 − gider 1500 − yevmiye 1500 = −3000
    expect(result.netProfit).toBe(-3000);
    expect(result.undistributed).toBe(-3000);
    expect(result.individualEarnings[1]).toBe(1500);
    expect(result.individualEarnings[2]).toBe(0);
  });

  it("derin zararda yevmiye eksilmez", () => {
    const pool = [worker(1, "GUNLUK", 2000), worker(2, "ORTAK", 0)];
    const result = calculateDailyEarnings(pool, { 1: "FULL", 2: "FULL" }, 0, 50000);
    expect(result.individualEarnings[1]).toBe(2000);
    // 0 − 50000 − 2000 = −52000
    expect(result.netProfit).toBe(-52000);
    expect(result.undistributed).toBe(-52000);
  });

  it("yevmiyeli olmayan ortak gününde zarar yoktur (gün eşiği korunur)", () => {
    const pool = [worker(1, "ORTAK", 0)];
    // Puantaj var, ciro/gider yok → sahte zarar yazılmaz.
    const result = calculateDailyEarnings(pool, { 1: "FULL" }, 0, 0);
    expect(result.netProfit).toBe(0);
    expect(result.undistributed).toBe(0);
  });
});
