import { describe, it, expect, vi, beforeEach } from "vitest";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...a: unknown[]) => executeQuery(...a),
  fetchQuery: (...a: unknown[]) => fetchQuery(...a),
  executeTransaction: vi.fn(),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

import { periodOf, periodOfDate, formatPeriod, periodsSince } from "../lib/period";
import { usePeriodStore, isDateInClosedPeriod, ClosedPeriodError } from "../stores/periodStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePaymentStore } from "../stores/paymentStore";
import { useWorkerStore } from "../stores/workerStore";

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  usePeriodStore.setState({ closed: [], earliestDataPeriod: null, isLoading: false });
});

describe("dönem yardımcıları", () => {
  it("tarihten dönem anahtarı çıkarır", () => {
    expect(periodOf("2026-05-10")).toBe("2026-05");
    expect(periodOf("2026-05")).toBe("2026-05");
  });

  it("Date nesnesinden dönem anahtarı üretir", () => {
    expect(periodOfDate(new Date(2026, 0, 15))).toBe("2026-01");
    expect(periodOfDate(new Date(2026, 11, 1))).toBe("2026-12");
  });

  it("dönemi Türkçe biçimler", () => {
    expect(formatPeriod("2026-05")).toBe("Mayıs 2026");
    expect(formatPeriod("2026-12")).toBe("Aralık 2026");
  });

  it("geçersiz dönemi olduğu gibi bırakır", () => {
    expect(formatPeriod("bozuk")).toBe("bozuk");
  });

  it("bugünden geriye doğru dönemleri sıralar", () => {
    const list = periodsSince(null, 4);
    expect(list).toHaveLength(4);
    expect(list[0]).toBe(periodOfDate(new Date()));
    expect(list[0] > list[1]).toBe(true);
  });

  it("en eski veri dönemine ulaşınca durur", () => {
    const current = periodOfDate(new Date());
    expect(periodsSince(current)).toEqual([current]);
  });
});

describe("kapalı dönem koruması", () => {
  const closeCurrent = () => {
    const period = periodOfDate(new Date());
    usePeriodStore.setState({
      closed: [{ period, closed_at: "2026-09-11 10:00:00", note: null }],
    });
    return period;
  };

  it("kapalı dönemi tanır", () => {
    const period = closeCurrent();
    expect(isDateInClosedPeriod(`${period}-15`)).toBe(true);
    expect(isDateInClosedPeriod("1999-01-01")).toBe(false);
  });

  it("puantaj yazmayı engeller", async () => {
    const period = closeCurrent();
    await expect(
      useAttendanceStore.getState().markAttendance(1, `${period}-10`, "FULL"),
    ).rejects.toThrow(ClosedPeriodError);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("gün verisi yazmayı engeller", async () => {
    const period = closeCurrent();
    await expect(
      useMetricsStore.getState().updateMetrics(`${period}-10`, 1, 100, 0, false),
    ).rejects.toThrow(ClosedPeriodError);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("ödeme eklemeyi engeller", async () => {
    const period = closeCurrent();
    await expect(
      usePaymentStore.getState().addPayment(1, 500, `${period}-10`, "avans"),
    ).rejects.toThrow(ClosedPeriodError);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("kapalı dönemdeki ödemenin silinmesini engeller", async () => {
    const period = closeCurrent();
    usePaymentStore.setState({
      payments: [{ id: 7, worker_id: 1, amount: 500, date: `${period}-10`, description: "" }],
    });
    await expect(usePaymentStore.getState().deletePayment(7, 1)).rejects.toThrow(ClosedPeriodError);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("ücret değişikliğinin kapalı döneme sarkmasını engeller", async () => {
    const period = closeCurrent();
    useWorkerStore.setState({
      workers: [
        {
          id: 1,
          name: "Test",
          daily_wage: 600,
          worker_type: "GUNLUK",
          is_active: true,
          created_at: "2026-01-01",
        },
      ],
    });
    await expect(
      useWorkerStore.getState().updateWorker(1, "Test", 900, "GUNLUK", `${period}-01`),
    ).rejects.toThrow(ClosedPeriodError);
  });

  it("açık dönemde yazmaya izin verir", async () => {
    closeCurrent();
    await expect(
      useAttendanceStore.getState().markAttendance(1, "1999-01-10", "FULL"),
    ).resolves.toBeUndefined();
    expect(executeQuery).toHaveBeenCalled();
  });

  it("hata mesajı hangi dönemin kapalı olduğunu söyler", () => {
    const error = new ClosedPeriodError("2026-05-10");
    expect(error.message).toContain("Mayıs 2026");
    expect(error.message).toContain("Dönem Kilidi");
  });
});
