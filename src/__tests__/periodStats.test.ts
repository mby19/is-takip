import { describe, it, expect } from "vitest";
import {
  calculateWorkerStats,
  createWorkerStatsContext,
  type WorkerStats,
} from "../utils/calculations";
import { roundMoney } from "../utils/earningsCalculator";
import {
  accumulateAllTimeEarned,
  allTimeRanges,
  buildPeriodIndex,
  buildWorkerStats,
  canSelectNextMonth,
  calculatePeriodEarnings,
  indexByDate,
  paymentsInPeriod,
  paymentsOfWorker,
  periodWindowOf,
  rateValidFrom,
  workerRateHistory,
  type DateRange,
} from "../lib/periodStats";
import type { Attendance, DailyMetric, Payment, Worker, WorkerRate } from "../types";

const workerA: Worker = {
  id: 1,
  name: "Ahmet Yılmaz",
  daily_wage: 1000,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
};

const workerB: Worker = {
  id: 2,
  name: "Meşe Kaya",
  daily_wage: 0,
  worker_type: "ORTAK",
  is_active: true,
  created_at: "2026-01-01",
};

const month = new Date(2026, 4, 1); // Mayıs 2026

const attendance: Attendance[] = [
  { id: 1, worker_id: 1, date: "2026-05-04", status: "FULL" },
  { id: 2, worker_id: 2, date: "2026-05-04", status: "FULL" },
  { id: 3, worker_id: 1, date: "2026-05-05", status: "HALF" },
  { id: 4, worker_id: 1, date: "2026-05-06", status: "ABSENT" },
  { id: 5, worker_id: 1, date: "2026-05-07", status: "ABSENT" },
  { id: 6, worker_id: 2, date: "2026-05-07", status: "HALF" },
  // Farklı ay — ekran kapsamı dışında, sonucu bozmamalı
  { id: 7, worker_id: 1, date: "2026-04-10", status: "FULL" },
];

const metrics: DailyMetric[] = [
  { id: 1, date: "2026-05-04", production_amount: 10, total_earned: 4000, extra_expenses: 500 },
  { id: 2, date: "2026-05-07", production_amount: 0, total_earned: 2000, extra_expenses: 200 },
];

const payment = (over: Partial<Payment>): Payment => ({
  id: 1,
  worker_id: 1,
  amount: 100,
  date: "2026-05-10",
  description: "",
  ...over,
});

describe("paymentsOfWorker / paymentsInPeriod", () => {
  it("başka çalışanın ödemesini hiçbir koşulda döndürmez", () => {
    const payments: Payment[] = [
      payment({ id: 1, worker_id: 1, date: "2026-05-02" }),
      payment({ id: 2, worker_id: 2, date: "2026-05-02", amount: 9999 }),
      payment({ id: 3, worker_id: 3, date: "2026-05-02", amount: 7777 }),
    ];

    expect(paymentsOfWorker(payments, 1).map((p) => p.id)).toEqual([1]);
    expect(paymentsInPeriod(payments, 1, "2026-05").map((p) => p.id)).toEqual([1]);
  });

  it("worker_id string/number farkını tolere eder", () => {
    const payments = [payment({ id: 7, worker_id: 2 })];
    expect(paymentsOfWorker(payments, 2)).toHaveLength(1);
  });

  it("dönem filtresi çalışanın kendi kayıtlarıyla sınırlı", () => {
    const payments: Payment[] = [
      payment({ id: 1, worker_id: 1, date: "2026-04-30" }),
      payment({ id: 2, worker_id: 1, date: "2026-05-01" }),
      payment({ id: 3, worker_id: 1, date: "2026-05-31" }),
      payment({ id: 4, worker_id: 1, date: "2026-06-01" }),
    ];
    expect(paymentsInPeriod(payments, 1, "2026-05").map((p) => p.id)).toEqual([2, 3]);
  });
});

describe("calculatePeriodEarnings / buildWorkerStats", () => {
  const pool = [workerA, workerB];
  const index = buildPeriodIndex(attendance, metrics);

  it("calculateWorkerStats ile birebir aynı sayıları üretir", () => {
    const payments = [payment({ id: 1, amount: 500 }), payment({ id: 2, amount: 250 })];

    for (const worker of pool) {
      const legacy = calculateWorkerStats(worker, month, metrics, attendance, pool, payments, []);
      const earnings = calculatePeriodEarnings(pool, month, index, [], true);
      const next = buildWorkerStats(
        worker,
        "2026-05",
        earnings,
        legacy.totalEarnedAllTime,
        payments,
      );

      expect(next.totalEarnedInMonth).toBe(legacy.totalEarnedInMonth);
      expect(next.paidInMonth).toBe(legacy.paidInMonth);
      expect(next.periodBalance).toBe(legacy.periodBalance);
      expect(next.balance).toBe(legacy.balance);
      expect(next.dailyBreakdown).toEqual(legacy.dailyBreakdown);
      expect(next.fullDays).toBe(legacy.fullDays);
      expect(next.halfDays).toBe(legacy.halfDays);
      expect(next.absentDays).toBe(legacy.absentDays);
    }
  });

  it("başka çalışanın ödemesi bakiyeye sızmaz", () => {
    const payments = [payment({ id: 1, worker_id: 2, amount: 5000 })];
    const earnings = calculatePeriodEarnings(pool, month, index, [], true);
    const stats = buildWorkerStats(workerA, "2026-05", earnings, 0, payments);

    expect(stats.totalPaid).toBe(0);
    expect(stats.paidInMonth).toBe(0);
  });

  it("dönem dışı günler hakedişe girmez", () => {
    const onlyApril = buildPeriodIndex([attendance[6]], []);
    const earnings = calculatePeriodEarnings(pool, month, onlyApril, [], true);
    expect(earnings.earned.get(workerA.id)).toBe(0);
  });
});

/**
 * BUG #2: `periodStats` gün satırlarını `Math.round` ile tam liraya
 * yuvarlıyordu; ay toplamı ise ham toplamdan türetiliyordu. 33,34 TL
 * kazançta gün satırları 17+17=34 derken ekran toplamı 33 gösteriyordu —
 * ADR-0009 §1'in "Σ gün satırı = gösterilen toplam, her zaman" değişmezi
 * ihlal ediliyordu.
 */
describe("Kuruş yolu — gün satırları toplamla birebir tutar", () => {
  const partner = (id: number): Worker => ({
    id,
    name: `Ortak ${id}`,
    daily_wage: 0,
    worker_type: "ORTAK",
    is_active: true,
    created_at: "2026-01-01",
  });

  const rowSum = (stats: WorkerStats): number =>
    stats.dailyBreakdown.reduce((a, d) => a + d.earned, 0);

  it("3 ortak / 100,00 kâr → 33,34 / 33,33 / 33,33 ve gün satırı toplamı tutar", () => {
    const partners = [partner(1), partner(2), partner(3)];
    const metrics: DailyMetric[] = [
      {
        id: 1,
        date: "2026-05-05",
        production_amount: 0,
        total_earned: 100,
        extra_expenses: 0,
        is_holiday: false,
      },
    ];
    const attendance: Attendance[] = partners.map((p) => ({
      id: p.id,
      worker_id: p.id,
      date: "2026-05-05",
      status: "FULL",
    }));

    const earnings = calculatePeriodEarnings(
      partners,
      month,
      buildPeriodIndex(attendance, metrics),
      [],
      true,
    );
    const stats = partners.map((p) => buildWorkerStats(p, "2026-05", earnings, 0, []));

    // En büyük kalan payı ilk gün alır: 33,34 / 33,33 / 33,33.
    const dayValues = stats.map(
      (s) => s.dailyBreakdown.find((d) => d.date === "2026-05-05")?.earned ?? 0,
    );
    expect(dayValues).toEqual([33.34, 33.33, 33.33]);

    // Toplamlar da aynı kuruşlu değerleri taşır ve gün satırıyla birebir tutar.
    expect(stats.map((s) => s.totalEarnedInMonth)).toEqual([33.34, 33.33, 33.33]);
    for (const s of stats) {
      expect(roundMoney(rowSum(s))).toBe(s.totalEarnedInMonth);
    }
    expect(roundMoney(stats.reduce((a, s) => a + s.totalEarnedInMonth, 0))).toBe(100);
  });

  it("33,34 TL kazançta gün satırlarının toplamı toplamla birebir aynı", () => {
    // Klasik hata: gün satırları Math.round ile 17 + 17 = 34 derken ekran
    // toplamı 33,34 gösteriyordu. Ham tutarlar kuruş tahsis edildiğinde
    // 16,67 + 16,67 = 33,34 olur ve satırlar toplamla birebir tutar.
    const workers: Worker[] = [
      {
        id: 1,
        name: "A",
        daily_wage: 16.67,
        worker_type: "GUNLUK",
        is_active: true,
        created_at: "2026-01-01",
      },
    ];
    const dates = ["2026-05-04", "2026-05-05"];
    const attendance: Attendance[] = dates.map((date, i) => ({
      id: i + 1,
      worker_id: 1,
      date,
      status: "FULL",
    }));

    const index = buildPeriodIndex(attendance, []);
    const earnings = calculatePeriodEarnings(workers, month, index, [], true);
    const stats = buildWorkerStats(workers[0]!, "2026-05", earnings, 0, []);

    const rows = stats.dailyBreakdown.filter((d) => d.earned !== 0).map((d) => d.earned);
    expect(rows).toEqual([16.67, 16.67]);
    expect(stats.totalEarnedInMonth).toBe(33.34);
    expect(rowSum(stats)).toBe(33.34);
  });

  it("periodStats ve calculations aynı girdide birebir aynı gün satırlarını üretir", () => {
    const workers: Worker[] = [
      {
        id: 1,
        name: "A",
        daily_wage: 1234.56,
        worker_type: "GUNLUK",
        is_active: true,
        created_at: "2026-01-01",
      },
      {
        id: 2,
        name: "B",
        daily_wage: 0,
        worker_type: "ORTAK",
        is_active: true,
        created_at: "2026-01-01",
      },
      {
        id: 3,
        name: "C",
        daily_wage: 0,
        worker_type: "ORTAK",
        is_active: true,
        created_at: "2026-01-01",
      },
      {
        id: 4,
        name: "D",
        daily_wage: 0,
        worker_type: "ORTAK",
        is_active: true,
        created_at: "2026-01-01",
      },
    ];
    const dates = ["2026-05-04", "2026-05-05", "2026-05-06", "2026-05-07"];
    const metrics: DailyMetric[] = dates.map((date, i) => ({
      id: i + 1,
      date,
      production_amount: 0,
      total_earned: [1234.57, 0, 700.01, 3333.33][i]!,
      extra_expenses: [0, 45.55, 11.11, 0][i]!,
      is_holiday: false,
    }));
    const attendance: Attendance[] = [];
    dates.forEach((date, dayIndex) => {
      workers.forEach((w, wi) => {
        attendance.push({
          id: dayIndex * 10 + wi,
          worker_id: w.id,
          date,
          status: wi === 1 && dayIndex === 2 ? "HALF" : "FULL",
        });
      });
    });

    const index = buildPeriodIndex(attendance, metrics);
    const earnings = calculatePeriodEarnings(workers, month, index, [], true);
    const ctx = createWorkerStatsContext(attendance, metrics, workers, []);

    for (const w of workers) {
      const fromStats = buildWorkerStats(w, "2026-05", earnings, 0, []);
      const fromCalc = calculateWorkerStats(w, month, metrics, attendance, workers, [], [], ctx);

      expect(fromStats.dailyBreakdown).toEqual(fromCalc.dailyBreakdown);
      expect(fromStats.totalEarnedInMonth).toBe(fromCalc.totalEarnedInMonth);
      expect(roundMoney(rowSum(fromStats))).toBe(fromCalc.totalEarnedInMonth);
    }
  });

  it("kuruşlu ödemeler tam liriye yuvarlanmaz", () => {
    // Math.round 1.234,56 TL ödemeyi 1.235 TL gösterirdi.
    const earnings = calculatePeriodEarnings(
      [workerA],
      month,
      buildPeriodIndex(attendance, metrics),
      [],
      true,
    );
    const payments: Payment[] = [
      payment({ id: 1, amount: 1234.56, date: "2026-05-10" }),
      payment({ id: 2, amount: 0.44, date: "2026-05-11" }),
    ];
    const stats = buildWorkerStats(workerA, "2026-05", earnings, 1234.56, payments);

    expect(stats.paidInMonth).toBe(1235);
    expect(stats.totalPaid).toBe(1235);
    expect(stats.totalEarnedAllTime).toBe(1234.56);
    expect(stats.balance).toBe(-0.44);
    expect(stats.periodBalance).toBe(roundMoney(stats.totalEarnedInMonth - stats.paidInMonth));
  });

  it("negatif gün (zarar) senaryosunda gün satırları toplamı yine tutar", () => {
    const workers: Worker[] = [
      {
        id: 1,
        name: "A",
        daily_wage: 1000.55,
        worker_type: "GUNLUK",
        is_active: true,
        created_at: "2026-01-01",
      },
      {
        id: 2,
        name: "B",
        daily_wage: 0,
        worker_type: "ORTAK",
        is_active: true,
        created_at: "2026-01-01",
      },
    ];
    const metrics: DailyMetric[] = [
      {
        id: 1,
        date: "2026-05-04",
        production_amount: 0,
        total_earned: 900.11,
        extra_expenses: 2500.77,
        is_holiday: false,
      },
    ];
    const attendance: Attendance[] = workers.map((w, i) => ({
      id: i,
      worker_id: w.id,
      date: "2026-05-04",
      status: "FULL",
    }));

    const index = buildPeriodIndex(attendance, metrics);
    const earnings = calculatePeriodEarnings(workers, month, index, [], true);

    expect(earnings.netProfit).toBe(-2601.21);
    expect(earnings.undistributed).toBe(-2601.21);

    const daily = buildWorkerStats(workers[0]!, "2026-05", earnings, 0, []);
    const shared = buildWorkerStats(workers[1]!, "2026-05", earnings, 0, []);

    // Zarar günü ortak payı 0; günlükçü yevmiyesi eksilmez.
    expect(shared.totalEarnedInMonth).toBe(0);
    expect(daily.totalEarnedInMonth).toBe(1000.55);
    expect(rowSum(daily)).toBe(1000.55);
  });
});

describe("accumulateAllTimeEarned", () => {
  it("yıl aralıklarıyla akıtılan toplam, tüm veriye göre hesaplananla aynı", () => {
    const pool = [workerA, workerB];
    const full: Attendance[] = [
      ...attendance,
      { id: 20, worker_id: 1, date: "2024-02-01", status: "FULL" },
      { id: 21, worker_id: 2, date: "2024-02-01", status: "FULL" },
    ];
    const fullMetrics: DailyMetric[] = [
      ...metrics,
      { id: 20, date: "2024-02-01", production_amount: 1, total_earned: 1000, extra_expenses: 0 },
    ];

    const expected = calculateWorkerStats(workerA, month, fullMetrics, full, pool, [], []);

    const seen: DateRange[] = [];
    const load = async (range: DateRange) => {
      seen.push(range);
      return {
        attendance: full.filter((a) => a.date >= range.start && a.date <= range.end),
        metrics: fullMetrics.filter((m) => m.date >= range.start && m.date <= range.end),
      };
    };

    const ranges = allTimeRanges(new Date(2026, 4, 1));
    expect(ranges[0].start).toBe("2000-01-01");
    expect(ranges[ranges.length - 1].start).toBe("2026-01-01");

    return accumulateAllTimeEarned(pool, [], ranges, load).then((totals) => {
      expect(totals.get(workerA.id)).toBeCloseTo(expected.totalEarnedAllTime, 6);
      // Her aralık gerçekten sorgulanır — bellekte tüm tablo tutulmaz
      expect(seen.length).toBe(ranges.length);
    });
  });

  it("tabanı verinin başladığı yıla çekmek toplamı değiştirmez", () => {
    // 2024'te başlayan bir şantiye: 2000–2023 boş. Boş yıl zaten atlandığı
    // için daraltılmış tarama geniş olanla birebir aynı hakedişi vermeli.
    const pool = [workerA, workerB];
    const full: Attendance[] = [
      ...attendance,
      { id: 20, worker_id: 1, date: "2024-02-01", status: "FULL" },
      { id: 21, worker_id: 2, date: "2024-02-01", status: "FULL" },
    ];
    const fullMetrics: DailyMetric[] = [
      ...metrics,
      { id: 20, date: "2024-02-01", production_amount: 1, total_earned: 1000, extra_expenses: 0 },
    ];
    const load = async (range: DateRange) => ({
      attendance: full.filter((a) => a.date >= range.start && a.date <= range.end),
      metrics: fullMetrics.filter((m) => m.date >= range.start && m.date <= range.end),
    });

    const wide = allTimeRanges(new Date(2026, 4, 1));
    const narrow = allTimeRanges(new Date(2026, 4, 1), 2024);

    expect(wide.length - narrow.length).toBe(24);

    return Promise.all([
      accumulateAllTimeEarned(pool, [], wide, load),
      accumulateAllTimeEarned(pool, [], narrow, load),
    ]).then(([wideTotals, narrowTotals]) => {
      expect(narrowTotals.get(workerA.id)).toBe(wideTotals.get(workerA.id));
      expect(narrowTotals.get(workerB.id)).toBe(wideTotals.get(workerB.id));
    });
  });

  it("puantajı olmayan çalışanın hakedişi taramadan bağımsız olarak 0 kalır", () => {
    // Tarama tabanını veriden türetmek, puantajı hiç olmayan çalışanı
    // listeden düşürmemeli: toplam haritası her zaman tüm havuzu kapsar.
    const pool = [workerA, workerB];
    const load = async (): Promise<{ attendance: Attendance[]; metrics: DailyMetric[] }> => ({
      attendance: [],
      metrics: [],
    });

    return accumulateAllTimeEarned(pool, [], allTimeRanges(new Date(2026, 4, 1), 2024), load).then(
      (totals) => {
        expect(totals.get(workerA.id)).toBe(0);
        expect(totals.get(workerB.id)).toBe(0);
      },
    );
  });
});

describe("indexByDate", () => {
  it("aynı güne düşen satırları tek kovada toplar", () => {
    const idx = indexByDate([
      { date: "2026-05-01" },
      { date: " 2026-05-01 " },
      { date: "2026-05-02" },
    ]);
    expect(idx.get("2026-05-01")).toHaveLength(2);
    expect(idx.get("2026-05-02")).toHaveLength(1);
  });
});

describe("periodWindowOf", () => {
  it("ayın ilk ve son gününü verir", () => {
    expect(periodWindowOf(month)).toEqual({
      period: "2026-05",
      start: "2026-05-01",
      end: "2026-05-31",
    });
  });
});

describe("canSelectNextMonth", () => {
  const now = new Date(2026, 4, 15);

  it("gelecek aya geçilmez", () => {
    expect(canSelectNextMonth(new Date(2026, 4, 1), now)).toBe(false);
    expect(canSelectNextMonth(new Date(2026, 5, 1), now)).toBe(false);
  });

  it("geçmiş aydan içinde bulunulan aya geçilir", () => {
    expect(canSelectNextMonth(new Date(2026, 3, 1), now)).toBe(true);
  });
});

describe("workerRateHistory / rateValidFrom", () => {
  const history: WorkerRate[] = [
    { id: 1, worker_id: 1, valid_from: "2020-01-01", daily_wage: 600, worker_type: "GUNLUK" },
    { id: 2, worker_id: 1, valid_from: "2026-05-01", daily_wage: 900, worker_type: "GUNLUK" },
    { id: 3, worker_id: 2, valid_from: "2026-01-01", daily_wage: 5, worker_type: "GUNLUK" },
  ];

  it("yalnız çalışanın kayıtlarını, en yeni önce döndürür", () => {
    expect(workerRateHistory(history, 1).map((r) => r.daily_wage)).toEqual([900, 600]);
  });

  it("kaydın olmadığı tarihte önceki kaydın başlangıcını verir", () => {
    expect(rateValidFrom(history, 1, "2026-04-30")).toBe("2020-01-01");
    expect(rateValidFrom(history, 1, "2026-05-01")).toBe("2026-05-01");
  });

  it("hiç kayıt yoksa null döner", () => {
    expect(rateValidFrom(history, 1, "2019-12-31")).toBeNull();
    expect(rateValidFrom(history, 99, "2026-05-01")).toBeNull();
  });
});
