import { describe, it, expect } from "vitest";
import { calculateDailyEarnings } from "../utils/earningsCalculator";
import type { Worker } from "../types";

const gunlukWorker: Worker = {
  id: 1,
  name: "Ali",
  daily_wage: 1000,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
};

const ortakWorker: Worker = {
  id: 2,
  name: "Veli",
  daily_wage: 0,
  worker_type: "ORTAK",
  is_active: true,
  created_at: "2026-01-01",
};

describe("calculateDailyEarnings", () => {
  it("returns zero when no workers", () => {
    const result = calculateDailyEarnings([], {}, 5000, 500);
    expect(result.totalWorkerCosts).toBe(0);
    expect(result.netProfit).toBe(0);
    expect(result.partnerShare).toBe(0);
    expect(result.individualEarnings).toEqual({});
  });

  it("GUNLUK worker with FULL attendance earns daily_wage", () => {
    const result = calculateDailyEarnings([gunlukWorker], { 1: "FULL" }, 5000, 500);
    expect(result.totalWorkerCosts).toBe(1000);
    expect(result.individualEarnings[1]).toBe(1000);
  });

  it("GUNLUK worker with HALF attendance earns half daily_wage", () => {
    const result = calculateDailyEarnings([gunlukWorker], { 1: "HALF" }, 5000, 500);
    expect(result.totalWorkerCosts).toBe(500);
    expect(result.individualEarnings[1]).toBe(500);
  });

  it("ORTAK worker with FULL attendance gets share from net profit", () => {
    const result = calculateDailyEarnings([ortakWorker], { 2: "FULL" }, 10000, 1000);
    expect(result.totalWorkerCosts).toBe(0);
    expect(result.netProfit).toBe(9000);
    expect(result.partnerShare).toBe(9000);
    expect(result.individualEarnings[2]).toBe(9000);
  });

  it("mixed GUNLUK and ORTAK workers split correctly", () => {
    const gunluk2: Worker = { ...gunlukWorker, id: 3, name: "Ayse", daily_wage: 800 };
    const ortak2: Worker = { ...ortakWorker, id: 4, name: "Mehmet" };
    const workers = [gunlukWorker, gunluk2, ortakWorker, ortak2];

    const result = calculateDailyEarnings(
      workers,
      { 1: "FULL", 3: "FULL", 2: "FULL", 4: "FULL" },
      20000,
      2000,
    );
    expect(result.totalWorkerCosts).toBe(1800);
    expect(result.netProfit).toBe(16200);
    expect(result.partnerShare).toBe(8100);
    expect(result.individualEarnings[2]).toBe(8100);
    expect(result.individualEarnings[4]).toBe(8100);
    expect(result.individualEarnings[1]).toBe(1000);
    expect(result.individualEarnings[3]).toBe(800);
  });

  it("ORTAK worker with HALF attendance gets half share", () => {
    const result = calculateDailyEarnings([ortakWorker], { 2: "HALF" }, 10000, 1000);
    expect(result.netProfit).toBe(9000);
    expect(result.partnerShare).toBe(18000);
    expect(result.individualEarnings[2]).toBe(9000);
  });

  it("ABSENT or HOLIDAY or null status means no earnings", () => {
    const workers = [gunlukWorker, ortakWorker];
    const result = calculateDailyEarnings(workers, { 1: "ABSENT", 2: null }, 5000, 500);
    expect(result.totalWorkerCosts).toBe(0);
    expect(result.netProfit).toBe(0);
    expect(result.individualEarnings[1]).toBe(0);
    expect(result.individualEarnings[2]).toBeUndefined();
  });

  it("multiple GUNLUK with mixed FULL/HALF status", () => {
    const gunluk2: Worker = { ...gunlukWorker, id: 3, name: "Ayse", daily_wage: 800 };
    const result = calculateDailyEarnings(
      [gunlukWorker, gunluk2],
      { 1: "FULL", 3: "HALF" },
      5000,
      500,
    );
    expect(result.totalWorkerCosts).toBe(1400);
    expect(result.individualEarnings[1]).toBe(1000);
    expect(result.individualEarnings[3]).toBe(400);
  });
});
