import { describe, it, expect } from "vitest";
import { calculateWorkerStats } from "../utils/calculations";
import { resolveWorkerRate, calculateDailyEarnings } from "../utils/earningsCalculator";
import { parseAttendanceSnapshot } from "../utils/parseLogData";
import type { Worker, WorkerRate, Attendance, Payment, DailyMetric } from "../types";

const worker: Worker = {
  id: 1,
  name: "Test",
  daily_wage: 1000,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
};

const att = (date: string, status: Attendance["status"] = "FULL", worker_id = 1): Attendance => ({
  id: 0,
  worker_id,
  date,
  status,
});

describe("resolveWorkerRate", () => {
  const history: WorkerRate[] = [
    { id: 1, worker_id: 1, valid_from: "2000-01-01", daily_wage: 600, worker_type: "GUNLUK" },
    { id: 2, worker_id: 1, valid_from: "2026-05-01", daily_wage: 900, worker_type: "GUNLUK" },
  ];

  it("tarihte geçerli olan kaydı seçer", () => {
    expect(resolveWorkerRate(worker, "2026-04-30", history).daily_wage).toBe(600);
    expect(resolveWorkerRate(worker, "2026-05-01", history).daily_wage).toBe(900);
    expect(resolveWorkerRate(worker, "2026-09-10", history).daily_wage).toBe(900);
  });

  it("geçmiş kaydı yoksa çalışanın güncel değerine düşer", () => {
    expect(resolveWorkerRate(worker, "2026-05-01", []).daily_wage).toBe(1000);
  });

  it("başka çalışanın kaydını kullanmaz", () => {
    const other: WorkerRate[] = [
      { id: 9, worker_id: 2, valid_from: "2000-01-01", daily_wage: 5, worker_type: "GUNLUK" },
    ];
    expect(resolveWorkerRate(worker, "2026-05-01", other).daily_wage).toBe(1000);
  });
});

describe("geçmişe dönük yevmiye", () => {
  it("zam sonrası eski aylar eski yevmiyeyle hesaplanır", () => {
    const history: WorkerRate[] = [
      { id: 1, worker_id: 1, valid_from: "2000-01-01", daily_wage: 600, worker_type: "GUNLUK" },
      { id: 2, worker_id: 1, valid_from: "2026-05-01", daily_wage: 900, worker_type: "GUNLUK" },
    ];
    const attendances = [att("2026-04-10"), att("2026-05-10")];

    const april = calculateWorkerStats(
      worker,
      new Date(2026, 3, 1),
      [],
      attendances,
      [worker],
      [],
      history,
    );
    const may = calculateWorkerStats(
      worker,
      new Date(2026, 4, 1),
      [],
      attendances,
      [worker],
      [],
      history,
    );

    expect(april.totalEarnedInMonth).toBe(600);
    expect(may.totalEarnedInMonth).toBe(900);
    // Tüm dönemler toplamı iki ayın toplamıdır.
    expect(may.totalEarnedAllTime).toBe(1500);
  });
});

describe("dönem bakiyesi ile kümülatif bakiye", () => {
  const attendances = [att("2026-04-10"), att("2026-05-10")];
  const payments: Payment[] = [
    { id: 1, worker_id: 1, amount: 1000, date: "2026-04-15", description: "" },
    { id: 2, worker_id: 1, amount: 400, date: "2026-05-15", description: "" },
  ];

  it("dönem bakiyesi yalnızca o ayın ödemesini düşer", () => {
    const may = calculateWorkerStats(
      worker,
      new Date(2026, 4, 1),
      [],
      attendances,
      [worker],
      payments,
    );
    expect(may.totalEarnedInMonth).toBe(1000);
    expect(may.paidInMonth).toBe(400);
    expect(may.periodBalance).toBe(600);
  });

  it("kalan borç tüm dönemler üzerinden hesaplanır", () => {
    const may = calculateWorkerStats(
      worker,
      new Date(2026, 4, 1),
      [],
      attendances,
      [worker],
      payments,
    );
    expect(may.totalEarnedAllTime).toBe(2000);
    expect(may.totalPaid).toBe(1400);
    expect(may.balance).toBe(600);
  });

  it("başka çalışanın ödemesini saymaz", () => {
    const stats = calculateWorkerStats(
      worker,
      new Date(2026, 4, 1),
      [],
      attendances,
      [worker],
      [{ id: 3, worker_id: 99, amount: 5000, date: "2026-05-01", description: "" }],
    );
    expect(stats.totalPaid).toBe(0);
  });
});

describe("tatil (HOLIDAY)", () => {
  it("kazanç üretmez ve ayrı sayılır", () => {
    const stats = calculateWorkerStats(
      worker,
      new Date(2026, 4, 1),
      [],
      [att("2026-05-10", "HOLIDAY")],
      [worker],
      [],
    );
    expect(stats.totalEarnedInMonth).toBe(0);
    expect(stats.holidayDays).toBe(1);
    expect(stats.absentDays).toBe(0);
  });

  it("günlük hesapta ağırlığı sıfırdır", () => {
    const result = calculateDailyEarnings([worker], { 1: "HOLIDAY" }, 5000, 0);
    expect(result.individualEarnings[1]).toBe(0);
    expect(result.totalWorkerCosts).toBe(0);
  });
});

describe("ortak payı", () => {
  const partner: Worker = { ...worker, id: 2, worker_type: "ORTAK", daily_wage: 0 };
  const metrics: DailyMetric[] = [
    {
      id: 1,
      date: "2026-05-10",
      production_amount: 0,
      total_earned: 5000,
      extra_expenses: 500,
      is_holiday: false,
    },
  ];

  it("yevmiyeler düşüldükten sonra kalanı ortaklara böler", () => {
    const result = calculateDailyEarnings([worker, partner], { 1: "FULL", 2: "FULL" }, 5000, 500);
    expect(result.totalWorkerCosts).toBe(1000);
    expect(result.netProfit).toBe(3500);
    expect(result.individualEarnings[2]).toBe(3500);
  });

  it("zarar da ortaklara paylaştırılır", () => {
    const result = calculateDailyEarnings([worker, partner], { 1: "FULL", 2: "FULL" }, 100, 0);
    expect(result.netProfit).toBe(-900);
    expect(result.individualEarnings[2]).toBe(-900);
  });

  it("aylık dökümde de aynı sonucu verir", () => {
    const stats = calculateWorkerStats(
      partner,
      new Date(2026, 4, 1),
      metrics,
      [att("2026-05-10", "FULL", 1), att("2026-05-10", "FULL", 2)],
      [worker, partner],
      [],
    );
    expect(stats.totalEarnedInMonth).toBe(3500);
  });
});

describe("parseAttendanceSnapshot", () => {
  it("JSON biçimini okur", () => {
    const raw = JSON.stringify([
      { id: 1, name: "Ahmet", status: "FULL" },
      { id: 2, name: "Ayşe", status: "YOK" },
    ]);
    expect(parseAttendanceSnapshot(raw)).toEqual([
      { id: 1, name: "Ahmet", status: "FULL" },
      { id: 2, name: "Ayşe", status: "YOK" },
    ]);
  });

  it("eski iki nokta biçimini okur", () => {
    expect(parseAttendanceSnapshot("1:Ahmet:FULL, 2:Ayşe:YOK")).toEqual([
      { id: 1, name: "Ahmet", status: "FULL" },
      { id: 2, name: "Ayşe", status: "YOK" },
    ]);
  });

  it("virgül içeren isimleri JSON biçiminde korur", () => {
    const raw = JSON.stringify([{ id: 3, name: "Yılmaz, Ali", status: "HALF" }]);
    expect(parseAttendanceSnapshot(raw)[0].name).toBe("Yılmaz, Ali");
  });

  it("boş girdi için boş dizi döner", () => {
    expect(parseAttendanceSnapshot(null)).toEqual([]);
    expect(parseAttendanceSnapshot("")).toEqual([]);
  });
});
