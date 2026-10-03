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

import { usePeriodStore, isDateInClosedPeriod, ClosedPeriodError } from "../stores/periodStore";
import { useAttendanceStore } from "../stores/attendanceStore";

/**
 * Kilit durumunu kurar. `closedLoaded` yalnızca `closed` değiştikten sonra
 * verilir: store kuralı gereği liste doğrudan verildiğinde "yüklü" sayılır,
 * yüklenememiş durum yalnızca liste değişmeden ayrılabilir.
 */
const setLockState = (state: {
  closed: { period: string; closed_at: string; note: null }[];
  loaded: boolean;
}) => {
  usePeriodStore.setState({ closed: state.closed });
  usePeriodStore.setState({ closedLoaded: state.loaded, error: null, isLoading: false });
};

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  useAttendanceStore.setState({ attendances: [], isLoading: false, error: null });
  usePeriodStore.setState({ closed: [] });
  usePeriodStore.setState({ closedLoaded: true, error: null, isLoading: false });
});

describe("kilit verisi yüklenmeden yazma koruması", () => {
  it("kilit listesi yüklenmemişken HER tarihi kapalı sayar", () => {
    setLockState({ closed: [], loaded: false });

    expect(isDateInClosedPeriod("2026-05-10")).toBe(true);
    expect(isDateInClosedPeriod("1999-01-01")).toBe(true);
    expect(isDateInClosedPeriod("2030-12-31")).toBe(true);
  });

  it("liste yüklendiyse boş liste hiçbir tarihi kilitlemez", () => {
    setLockState({ closed: [], loaded: true });

    expect(isDateInClosedPeriod("2026-05-10")).toBe(false);
  });

  it("liste yüklendiyse yalnız listedeki dönemi kilitler", () => {
    setLockState({
      closed: [{ period: "2026-05", closed_at: "2026-06-01 09:00:00", note: null }],
      loaded: true,
    });

    expect(isDateInClosedPeriod("2026-05-10")).toBe(true);
    expect(isDateInClosedPeriod("2026-06-10")).toBe(false);
  });

  it("liste okunamazsa yazma yolları kilitli kalır", async () => {
    fetchQuery.mockRejectedValue(new Error("veritabanı kilitli"));
    usePeriodStore.setState({ closedLoaded: false, error: null, isLoading: false });

    await usePeriodStore.getState().fetchClosedPeriods();

    expect(usePeriodStore.getState().closedLoaded).toBe(false);
    expect(usePeriodStore.getState().error).toContain("veritabanı kilitli");
    expect(isDateInClosedPeriod("2026-05-10")).toBe(true);
  });

  it("liste başarıyla okununca yazma yolu açılır", async () => {
    fetchQuery.mockResolvedValue([]);
    usePeriodStore.setState({ closedLoaded: false, error: "önceki hata", isLoading: false });

    await usePeriodStore.getState().fetchClosedPeriods();

    expect(usePeriodStore.getState().closedLoaded).toBe(true);
    expect(usePeriodStore.getState().error).toBeNull();
    expect(isDateInClosedPeriod("2026-05-10")).toBe(false);
  });

  it("okunan liste kapalı dönemi yazma yolunda da durdurur", async () => {
    fetchQuery.mockResolvedValue([{ period: "2026-05", closed_at: "", note: null }]);

    await usePeriodStore.getState().fetchClosedPeriods();

    expect(isDateInClosedPeriod("2026-05-10")).toBe(true);
    await expect(
      useAttendanceStore.getState().markAttendance(1, "2026-05-10", "FULL"),
    ).rejects.toThrow(ClosedPeriodError);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("kilit verisi yokken puantaj yazma yolu da reddeder (fail-closed)", async () => {
    setLockState({ closed: [], loaded: false });

    await expect(
      useAttendanceStore.getState().markAttendance(1, "2026-05-10", "FULL"),
    ).rejects.toThrow(ClosedPeriodError);
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("hata mesajı yükleme hatası ile kilit hatasını ayırt eder", () => {
    setLockState({ closed: [], loaded: false });
    const notLoaded = new ClosedPeriodError("2026-05-10").message;
    expect(notLoaded).toContain("Dönem kilidi verileri yüklenemedi");
    expect(notLoaded).toContain("Mayıs 2026");

    setLockState({
      closed: [{ period: "2026-05", closed_at: "", note: null }],
      loaded: true,
    });
    const closed = new ClosedPeriodError("2026-05-10").message;
    expect(closed).toContain("Mayıs 2026");
    expect(closed).toContain("Dönem Kilidi");
    expect(closed).not.toContain("yüklenemedi");
  });
});
