import { describe, it, expect, vi, beforeEach } from "vitest";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();
const executeTransaction = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...a: unknown[]) => executeQuery(...a),
  fetchQuery: (...a: unknown[]) => fetchQuery(...a),
  executeTransaction: (...a: unknown[]) => executeTransaction(...a),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

import { useAttendanceStore } from "../stores/attendanceStore";
import { usePeriodStore } from "../stores/periodStore";
import { ClosedPeriodError } from "../stores/periodStore";
import { markTodayFull } from "../lib/quickAttendance";
import { useWorkerStore } from "../stores/workerStore";
import { todayKey } from "../lib/period";
import type { Attendance, Worker } from "../types";

const DATE = "2026-05-10";

const row = (
  id: number,
  workerId: number,
  date: string,
  status: Attendance["status"],
): Attendance => ({ id, worker_id: workerId, date, status }) as Attendance;

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  executeTransaction.mockReset().mockResolvedValue(undefined);
  usePeriodStore.setState({ closed: [], earliestDataPeriod: null, isLoading: false });
  useAttendanceStore.setState({ attendances: [], isLoading: false, error: null });
  useWorkerStore.setState({ workers: [], rateHistory: [], isLoading: false, error: null });
});

describe("markAttendanceMany", () => {
  it("50 kişilik kaydı TEK transaction'a indirger", async () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      workerId: i + 1,
      date: DATE,
      status: "FULL" as const,
    }));

    const result = await useAttendanceStore.getState().markAttendanceMany(entries);

    expect(result).toEqual({ written: 50, removed: 0 });
    expect(executeTransaction).toHaveBeenCalledTimes(1);
    expect(executeTransaction.mock.calls[0][0]).toHaveLength(50);
    // Hiçbir ifade doğrudan executeQuery'ye gitmez: transaction dışına çıkamaz.
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("geçersiz girdi fail-closed: repository'ye HİÇ yazılmaz ve state eski haline döner", async () => {
    useAttendanceStore.setState({ attendances: [row(1, 1, DATE, "ABSENT")] });
    const before = useAttendanceStore.getState().attendances;

    await expect(
      useAttendanceStore.getState().markAttendanceMany([
        { workerId: 2, date: DATE, status: "FULL" },
        { workerId: 3, date: DATE, status: "YOK_BÖYLE_BİR_DURUM_YOK" as never },
      ]),
    ).rejects.toThrow(/Geçersiz durum/);

    // Repository kendi doğrulamasında ifade bile üretmedi → tek transaction yok.
    expect(executeTransaction).not.toHaveBeenCalled();
    expect(executeQuery).not.toHaveBeenCalled();
    // İyimser güncelleme geri alındı: 2. ve 3. çalışan hayalet kayıt olarak kalmadı.
    expect(useAttendanceStore.getState().attendances).toEqual(before);
  });

  it("transaction hatasında yalnız etkilenen kayıtlar geri yüklenir", async () => {
    executeTransaction.mockRejectedValue(new Error("disk dolu"));
    useAttendanceStore.setState({
      attendances: [row(1, 1, DATE, "ABSENT"), row(2, 9, "2026-05-09", "FULL")],
    });

    await expect(
      useAttendanceStore.getState().markAttendanceMany([
        { workerId: 1, date: DATE, status: "FULL" },
        { workerId: 3, date: DATE, status: null },
      ]),
    ).rejects.toThrow("disk dolu");

    // Etkilenen anahtarlar (1|DATE) eski hâline döndü, diğer gün korundu.
    expect(useAttendanceStore.getState().attendances).toEqual([
      row(1, 1, DATE, "ABSENT"),
      row(2, 9, "2026-05-09", "FULL"),
    ]);
  });

  it("kapalı dönemde listedeki TEK bir tarih bile yazmaya izin vermez", async () => {
    usePeriodStore.setState({
      closed: [{ period: "2026-05", closed_at: "", note: null }],
      earliestDataPeriod: null,
      isLoading: false,
    });

    await expect(
      useAttendanceStore.getState().markAttendanceMany([
        { workerId: 1, date: "2026-04-30", status: "FULL" },
        { workerId: 2, date: DATE, status: "FULL" },
      ]),
    ).rejects.toThrow(ClosedPeriodError);

    expect(executeTransaction).not.toHaveBeenCalled();
    expect(useAttendanceStore.getState().attendances).toEqual([]);
  });

  it("markAttendance tekil çağrı da aynı atomik yoldan geçer", async () => {
    await useAttendanceStore.getState().markAttendance(4, DATE, "HALF");

    expect(executeTransaction).toHaveBeenCalledTimes(1);
    expect(useAttendanceStore.getState().attendances).toEqual([
      { worker_id: 4, date: DATE, status: "HALF" },
    ]);
  });
});

describe("markTodayFull", () => {
  const worker = (id: number, is_active = true): Worker => ({
    id,
    name: `Kişi ${id}`,
    daily_wage: 1000,
    worker_type: "GUNLUK",
    is_active,
    created_at: "2026-01-01",
  });

  it("tüm çalışanları TEK transaction'da tam güne çeker", async () => {
    const workers = Array.from({ length: 40 }, (_, i) => worker(i + 1));
    useWorkerStore.setState({ workers });
    fetchQuery.mockResolvedValue([]);

    const result = await markTodayFull();

    expect(result).toEqual({ marked: 40, skipped: 0 });
    expect(executeTransaction).toHaveBeenCalledTimes(1);
    expect(executeTransaction.mock.calls[0][0]).toHaveLength(40);
  });

  it("kaydı olan çalışana dokunmaz ve hepsini tek çağrıda yazar", async () => {
    useWorkerStore.setState({ workers: [worker(1), worker(2), worker(3)] });
    fetchQuery.mockResolvedValue([
      { id: 1, worker_id: 1, date: todayKey(), status: "ABSENT" as const },
    ]);

    const result = await markTodayFull();

    expect(result).toEqual({ marked: 2, skipped: 1 });
    expect(executeTransaction).toHaveBeenCalledTimes(1);
    const statements = executeTransaction.mock.calls[0][0] as string[];
    expect(statements.some((s) => s.includes("'1'") && s.includes("DELETE"))).toBe(false);
  });

  it("transaction patlarsa hiçbir puantaj yazılmaz", async () => {
    useWorkerStore.setState({ workers: [worker(1), worker(2)] });
    executeTransaction.mockRejectedValue(new Error("disk dolu"));

    await expect(markTodayFull()).rejects.toThrow("disk dolu");

    expect(useAttendanceStore.getState().attendances).toEqual([]);
  });
});
