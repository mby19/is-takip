import { describe, it, expect } from "vitest";
import {
  accumulateAllTimeEarned,
  buildPeriodIndex,
  calculatePeriodEarnings,
  type DateRange,
  type PeriodIndex,
} from "../lib/periodStats";
import {
  accumulateAllTimeEarnedIndexed,
  calculatePeriodEarningsIndexed,
} from "../lib/periodEarningsIndexed";
import { buildRateIndex } from "../utils/earningsCalculator";
import type { Attendance, DailyMetric, Worker, WorkerRate, WorkerType } from "../types";

/**
 * `periodEarningsIndexed`, `periodStats` içindeki doğrusal tarama yolunun
 * hızlandırılmış karşılığıdır. Bu dosyanın tek işi şu invariantı korumak:
 * **hızlandırma bir kuruş değiştiremez.** Veri üretimi tohumlu (LCG) —
 * rastgele görünür ama her koşuda aynı sayıları üretir, böylece bir kırılma
 * tekrar tekrar yakalanabilir.
 */
function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const WORKER_TYPES: readonly WorkerType[] = ["GUNLUK", "ORTAK"];
const STATUSES = ["FULL", "HALF", "ABSENT", "HOLIDAY"] as const;

const pad = (n: number) => String(n).padStart(2, "0");

const iso = (year: number, month: number, day: number) => `${year}-${pad(month)}-${pad(day)}`;

const daysInMonth = (year: number, month: number) => new Date(year, month, 0).getDate();

interface MonthData {
  attendance: Attendance[];
  metrics: DailyMetric[];
}

function makeWorkers(count: number, rng: () => number): Worker[] {
  return Array.from({ length: count }, (_, i) => ({
    id: i + 1,
    name: `Çalışan ${i + 1}`,
    daily_wage: Math.round(rng() * 4000 * 100) / 100,
    worker_type: WORKER_TYPES[i % 2],
    is_active: true,
    created_at: "2025-01-01",
  }));
}

/** Aynı gün için iki kayıt: geçmiş tablosunda bu mümkündür; ikili arama id
 * büyüklüğüne, tarama ilk eşleşene bakar — ikisi de aynı değerleri
 * taşıdığı için sonuç değişmez. */
function makeRateHistory(
  workers: readonly Worker[],
  fromYear: number,
  toYear: number,
  rng: () => number,
  recordsPerWorker = 2 + Math.floor(rng() * 3),
): WorkerRate[] {
  const rows: WorkerRate[] = [];
  let id = 1;
  for (const worker of workers) {
    for (let c = 0; c < recordsPerWorker; c++) {
      const year = fromYear + Math.floor(rng() * (toYear - fromYear + 1));
      const validFrom = iso(year, 1 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 28));
      const wage = Math.round(rng() * 5000 * 100) / 100;
      const type = WORKER_TYPES[Math.floor(rng() * 2)];
      rows.push({
        id: id++,
        worker_id: worker.id,
        valid_from: validFrom,
        daily_wage: wage,
        worker_type: type,
      });
      rows.push({
        id: id++,
        worker_id: worker.id,
        valid_from: validFrom,
        daily_wage: wage,
        worker_type: type,
      });
    }
  }
  return rows;
}

function makeMonthData(
  workers: readonly Worker[],
  year: number,
  month: number,
  rng: () => number,
): MonthData {
  const attendance: Attendance[] = [];
  const metrics: DailyMetric[] = [];
  let attendanceId = 1;
  let metricId = 1;

  for (let day = 1; day <= daysInMonth(year, month); day++) {
    const date = iso(year, month, day);
    // Ciro/gider girilmemiş günler de var: hakedişe esas gün kuralı
    // (ADR-0009) yalnız ciro girilmiş günlerde sınanmasın.
    if (rng() < 0.7) {
      metrics.push({
        id: metricId++,
        date,
        production_amount: Math.round(rng() * 100),
        // Paydası 7 ve 11 olan tutarlar, gün satırlarının toplamında kuruş
        // kalanı bırakır — yuvarlama farkının görünmesi için.
        total_earned: Math.round(rng() * 90000) / 7,
        extra_expenses: Math.round(rng() * 12000) / 11,
      });
    }
    for (const worker of workers) {
      if (rng() < 0.75) {
        attendance.push({
          id: attendanceId++,
          worker_id: worker.id,
          date,
          status: STATUSES[Math.floor(rng() * STATUSES.length)],
        });
      }
    }
  }
  return { attendance, metrics };
}

function expectSameEarnings(
  pool: readonly Worker[],
  month: Date,
  index: PeriodIndex,
  rateHistory: readonly WorkerRate[],
  withBreakdown: boolean,
): void {
  const linear = calculatePeriodEarnings(pool, month, index, rateHistory, withBreakdown);
  const indexed = calculatePeriodEarningsIndexed(
    pool,
    month,
    index,
    buildRateIndex(rateHistory),
    withBreakdown,
  );

  const byId = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]);
  expect(byId(indexed.earned)).toEqual(byId(linear.earned));
  expect(indexed.netProfit).toBe(linear.netProfit);
  expect(indexed.undistributed).toBe(linear.undistributed);
  expect(indexed.wageCost).toBe(linear.wageCost);

  for (const id of byId(linear.earned).map(([workerId]) => workerId)) {
    expect(indexed.breakdown.get(id)).toEqual(linear.breakdown.get(id));
  }
}

describe("periodEarningsIndexed — taranan yolla birebir aynı", () => {
  it("karışık ücret geçmişi ve puantajla aylık dökümü eşit üretir", () => {
    const rng = makeRng(20260915);
    const workers = makeWorkers(12, rng);
    const rateHistory = makeRateHistory(workers, 2025, 2026, rng);

    for (const monthIndex of [0, 5, 8]) {
      const { attendance, metrics } = makeMonthData(workers, 2026, monthIndex + 1, rng);
      expectSameEarnings(
        workers,
        new Date(2026, monthIndex, 1),
        buildPeriodIndex(attendance, metrics),
        rateHistory,
        true,
      );
    }
  });

  it("ücret geçmişi boşken aynı sonucu verir", () => {
    const rng = makeRng(77);
    const workers = makeWorkers(6, rng);
    const { attendance, metrics } = makeMonthData(workers, 2026, 3, rng);
    expectSameEarnings(
      workers,
      new Date(2026, 2, 1),
      buildPeriodIndex(attendance, metrics),
      [],
      false,
    );
  });

  it("havuzda olmayan çalışanın ücret kaydı sonucu bozmaz", () => {
    const rng = makeRng(4242);
    const workers = makeWorkers(5, rng);
    const stranger: Worker = {
      id: 999,
      name: "Kayıtta var, havuzda yok",
      daily_wage: 750,
      worker_type: "GUNLUK",
      is_active: true,
      created_at: "2025-01-01",
    };
    const rateHistory = [
      ...makeRateHistory(workers, 2026, 2026, rng),
      ...makeRateHistory([stranger], 2026, 2026, rng),
    ];
    const { attendance, metrics } = makeMonthData(workers, 2026, 7, rng);
    expectSameEarnings(
      workers,
      new Date(2026, 6, 1),
      buildPeriodIndex(attendance, metrics),
      rateHistory,
      true,
    );
  });

  it("tüm dönemler akıtmasında yıllar boyunca aynı toplamı verir", async () => {
    const rng = makeRng(9001);
    const workers = makeWorkers(9, rng);
    const rateHistory = makeRateHistory(workers, 2024, 2026, rng);

    const byYear = new Map<string, MonthData>();
    for (const year of [2024, 2025, 2026]) {
      const attendance: Attendance[] = [];
      const metrics: DailyMetric[] = [];
      for (let month = 1; month <= 12; month++) {
        const part = makeMonthData(workers, year, month, rng);
        attendance.push(...part.attendance);
        metrics.push(...part.metrics);
      }
      byYear.set(String(year), { attendance, metrics });
    }

    const ranges: DateRange[] = [2024, 2025, 2026].map((year) => ({
      start: `${year}-01-01`,
      end: `${year}-12-31`,
    }));
    const load = async (range: DateRange) => byYear.get(range.start.slice(0, 4)) as MonthData;

    const linear = await accumulateAllTimeEarned(workers, rateHistory, ranges, load);
    const indexed = await accumulateAllTimeEarnedIndexed(
      workers,
      buildRateIndex(rateHistory),
      ranges,
      load,
    );

    const byId = (m: Map<number, number>) => [...m.entries()].sort((a, b) => a[0] - b[0]);
    expect(byId(indexed)).toEqual(byId(linear));
    // Karşılaştırılan iki tablo da sıfır olmasın: test sessizce boş veriyle
    // "yeşil" olmamalı.
    expect([...linear.values()].some((v) => v !== 0)).toBe(true);
  });
});

describe("periodEarningsIndexed — darboğaz kalktı mı", () => {
  it("büyük ücret geçmişinde doğrusal taramadan en az 10× hızlı", () => {
    const rng = makeRng(31337);
    const workers = makeWorkers(60, rng);
    // 60 çalışan × ~107 kayıt ≈ 6400 satırlık geçmiş (ölçüm senaryosu).
    const rateHistory = makeRateHistory(workers, 2021, 2026, rng, 53);
    const { attendance, metrics } = makeMonthData(workers, 2026, 4, rng);
    const index = buildPeriodIndex(attendance, metrics);
    const rateIndex = buildRateIndex(rateHistory);
    const month = new Date(2026, 3, 1);

    // İlk koşu JIT derleme maliyetini de içerir; ısıtma olmadan ölçüm
    // hangi yolun kaç kez çalıştığına bağlı gürültü olur.
    calculatePeriodEarnings(workers, month, index, rateHistory, false);
    calculatePeriodEarningsIndexed(workers, month, index, rateIndex, false);

    const timeOf = (run: () => void): number => {
      const started = performance.now();
      run();
      return performance.now() - started;
    };

    const linearMs = timeOf(() =>
      calculatePeriodEarnings(workers, month, index, rateHistory, false),
    );
    const indexedMs = timeOf(() =>
      calculatePeriodEarningsIndexed(workers, month, index, rateIndex, false),
    );

    // Ölçülen fark ~162×; eşik bunun çok altında ama yavaş ya da gürültülü
    // bir makinede sıfırlanacak kadar dar değil.
    expect(indexedMs).toBeLessThan(linearMs / 10);
  });
});
