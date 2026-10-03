import { describe, it, expect, vi, beforeEach } from "vitest";

const executeQuery = vi.fn();
const executeTransaction = vi.fn();
const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...a: unknown[]) => executeQuery(...a),
  executeTransaction: (...a: unknown[]) => executeTransaction(...a),
  fetchQuery: (...a: unknown[]) => fetchQuery(...a),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

import { planReminders } from "../lib/reminder";
import {
  useReminderStore,
  normalizeReminderTime,
  DEFAULT_REMINDER_TIME,
} from "../stores/reminderStore";
import { markTodayFull } from "../lib/quickAttendance";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useWorkerStore } from "../stores/workerStore";
import { usePeriodStore } from "../stores/periodStore";
import { todayKey } from "../lib/period";
import { sqlLiteral } from "../lib/sql";
import type { Worker } from "../types";

const at = (iso: string) => new Date(iso);

/** jsdom bu sürümde localStorage sağlamıyor; ayar testleri için basit bir taklit. */
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
};

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  executeTransaction.mockReset().mockResolvedValue(undefined);
  usePeriodStore.setState({ closed: [], earliestDataPeriod: null, isLoading: false });
  useAttendanceStore.setState({ attendances: [], isLoading: false, error: null });
  useWorkerStore.setState({ workers: [], rateHistory: [], isLoading: false, error: null });
  vi.stubGlobal("localStorage", memoryStorage());
});

describe("hatırlatma planı", () => {
  it("bugünün saati geçmemişse bugünü de kurar", () => {
    const plan = planReminders({
      time: "18:00",
      filledToday: false,
      now: at("2026-05-10T09:00:00"),
      daysAhead: 3,
    });

    expect(plan).toHaveLength(3);
    expect(plan[0].isToday).toBe(true);
    expect(plan[0].fireAt.getHours()).toBe(18);
    expect(plan[0].fireAt.getDate()).toBe(10);
    expect(plan[2].fireAt.getDate()).toBe(12);
  });

  it("hatırlatma saati geçtiyse bugünü atlar", () => {
    const plan = planReminders({
      time: "18:00",
      filledToday: false,
      now: at("2026-05-10T19:30:00"),
      daysAhead: 3,
    });

    expect(plan).toHaveLength(2);
    expect(plan.every((p) => !p.isToday)).toBe(true);
    expect(plan[0].fireAt.getDate()).toBe(11);
  });

  it("bugünün puantajı girilmişse bugün için bildirim kurmaz", () => {
    const plan = planReminders({
      time: "18:00",
      filledToday: true,
      now: at("2026-05-10T09:00:00"),
      daysAhead: 3,
    });

    expect(plan).toHaveLength(2);
    expect(plan.every((p) => !p.isToday)).toBe(true);
  });

  it("her güne ayrı ve kararlı bir kimlik verir", () => {
    const first = planReminders({
      time: "08:30",
      filledToday: false,
      now: at("2026-05-10T07:00:00"),
      daysAhead: 4,
    });
    const second = planReminders({
      time: "08:30",
      filledToday: false,
      now: at("2026-05-10T07:15:00"),
      daysAhead: 4,
    });

    expect(new Set(first.map((p) => p.id)).size).toBe(first.length);
    expect(first.map((p) => p.id)).toEqual(second.map((p) => p.id));
  });
});

describe("hatırlatma ayarı", () => {
  it("geçersiz saatleri varsayılana çevirir", () => {
    expect(normalizeReminderTime("07:45")).toBe("07:45");
    expect(normalizeReminderTime("23:59")).toBe("23:59");
    expect(normalizeReminderTime("24:00")).toBe(DEFAULT_REMINDER_TIME);
    expect(normalizeReminderTime("7:45")).toBe(DEFAULT_REMINDER_TIME);
    expect(normalizeReminderTime(null)).toBe(DEFAULT_REMINDER_TIME);
    expect(normalizeReminderTime("")).toBe(DEFAULT_REMINDER_TIME);
  });

  it("ayarı localStorage'a yazar", () => {
    useReminderStore.getState().setEnabled(true);
    useReminderStore.getState().setTime("06:15");

    expect(localStorage.getItem("reminder-enabled")).toBe("true");
    expect(localStorage.getItem("reminder-time")).toBe("06:15");
    expect(useReminderStore.getState().time).toBe("06:15");
  });
});

describe("hızlı gün doldurma", () => {
  const worker = (id: number, is_active = true): Worker => ({
    id,
    name: `Kişi ${id}`,
    daily_wage: 1000,
    worker_type: "GUNLUK",
    created_at: "2026-01-01",
    is_active,
  });

  it("yalnızca kaydı olmayan aktif çalışanları tam güne çeker", async () => {
    useWorkerStore.setState({ workers: [worker(1), worker(2), worker(3, false)] });
    // fetchAttendanceByDate bugünü okur: 1 numaranın zaten kaydı var.
    fetchQuery.mockResolvedValue([
      { id: 5, worker_id: 1, date: todayKey(), status: "ABSENT" as const },
    ]);

    const result = await markTodayFull();

    expect(result).toEqual({ marked: 1, skipped: 1 });
    // Yazma artık TEK transaction içinde, hazırlanmış SQL metni olarak gider.
    const statements = (executeTransaction.mock.calls[0][0] as string[]) ?? [];
    expect(executeTransaction).toHaveBeenCalledTimes(1);
    expect(executeQuery).not.toHaveBeenCalled();
    expect(statements).toHaveLength(1);
    expect(statements[0]).toContain(sqlLiteral(2));
    expect(statements[0]).toContain(sqlLiteral(todayKey()));
    expect(statements[0]).toContain(sqlLiteral("FULL"));
  });

  it("kapalı döneme yazmaz", async () => {
    usePeriodStore.setState({
      closed: [{ period: todayKey().slice(0, 7), closed_at: "", note: null }],
      earliestDataPeriod: null,
      isLoading: false,
    });
    useWorkerStore.setState({ workers: [worker(1)] });

    await expect(markTodayFull()).rejects.toThrow(/kapatılmış/);
    expect(executeQuery).not.toHaveBeenCalled();
  });
});
