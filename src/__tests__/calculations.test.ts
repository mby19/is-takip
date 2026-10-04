import { describe, it, expect } from "vitest";
import { calculateWorkerStats } from "../utils/calculations";
import type { Worker, Payment, DailyMetric, Attendance } from "../types";

const worker: Worker = {
  id: 1,
  name: "Test Worker",
  daily_wage: 1000,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
};

const baseDate = new Date(2026, 4, 1);

function makeMetrics(date: string, overrides?: Partial<DailyMetric>): DailyMetric {
  return {
    id: 1,
    date,
    production_amount: 100,
    total_earned: 5000,
    extra_expenses: 500,
    is_holiday: false,
    ...overrides,
  };
}

function makeAttendance(
  worker_id: number,
  date: string,
  status: "FULL" | "HALF" | "ABSENT",
): Attendance {
  return { id: 0, worker_id, date, status };
}

function makePayment(overrides?: Partial<Payment>): Payment {
  return {
    id: 1,
    worker_id: 1,
    amount: 1000,
    date: "2026-05-15",
    description: "Test payment",
    ...overrides,
  };
}

describe("calculateWorkerStats", () => {
  it("returns zero stats for a month with no data", () => {
    const result = calculateWorkerStats(worker, baseDate, [], [], [], []);
    expect(result.totalEarnedInMonth).toBe(0);
    expect(result.totalPaid).toBe(0);
    expect(result.balance).toBe(0);
    expect(result.fullDays).toBe(0);
    expect(result.halfDays).toBe(0);
    expect(result.absentDays).toBe(0);
    expect(result.dailyBreakdown.length).toBe(31);
  });

  it("calculates daily wage for GUNLUK worker with FULL attendance", () => {
    const date = "2026-05-05";
    const attendances = [makeAttendance(1, date, "FULL")];
    const result = calculateWorkerStats(worker, baseDate, [], attendances, [], []);
    const day = result.dailyBreakdown.find((d) => d.date === date)!;
    expect(day.earned).toBe(1000);
    expect(result.totalEarnedInMonth).toBe(1000);
    expect(result.fullDays).toBe(1);
  });

  it("calculates half daily wage for GUNLUK worker with HALF attendance", () => {
    const date = "2026-05-05";
    const attendances = [makeAttendance(1, date, "HALF")];
    const result = calculateWorkerStats(worker, baseDate, [], attendances, [], []);
    const day = result.dailyBreakdown.find((d) => d.date === date)!;
    expect(day.earned).toBe(500);
    expect(result.totalEarnedInMonth).toBe(500);
    expect(result.halfDays).toBe(1);
  });

  it("counts absent days correctly", () => {
    const date = "2026-05-10";
    const attendances = [makeAttendance(1, date, "ABSENT")];
    const result = calculateWorkerStats(worker, baseDate, [], attendances, [], []);
    const day = result.dailyBreakdown.find((d) => d.date === date)!;
    expect(day.earned).toBe(0);
    expect(result.absentDays).toBe(1);
    expect(result.totalEarnedInMonth).toBe(0);
  });

  it("calculates totalPaid from payments", () => {
    const payments = [
      makePayment({ amount: 500, date: "2026-05-01" }),
      makePayment({ amount: 1500, date: "2026-05-15" }),
    ];
    const result = calculateWorkerStats(worker, baseDate, [], [], [], payments);
    expect(result.totalPaid).toBe(2000);
  });

  it("calculates balance as earned minus paid", () => {
    const date = "2026-05-05";
    const attendances = [makeAttendance(1, date, "FULL")];
    const payments = [makePayment({ amount: 400, date: "2026-05-10" })];
    const result = calculateWorkerStats(
      { ...worker, daily_wage: 1000 },
      baseDate,
      [],
      attendances,
      [],
      payments,
    );
    expect(result.totalEarnedInMonth).toBe(1000);
    expect(result.totalPaid).toBe(400);
    expect(result.balance).toBe(600);
  });

  it("handles ORTAK worker revenue sharing", () => {
    const date = "2026-05-05";
    const metrics = [makeMetrics(date)];
    const attendances = [makeAttendance(1, date, "FULL")];
    const workers: Worker[] = [{ ...worker, id: 1, worker_type: "ORTAK" }];
    const result = calculateWorkerStats(
      { ...worker, id: 1, worker_type: "ORTAK" },
      baseDate,
      metrics,
      attendances,
      workers,
      [],
    );
    const day = result.dailyBreakdown.find((d) => d.date === date)!;
    expect(day.earned).toBe(4500);
  });
});
