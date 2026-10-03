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

import { format, startOfMonth, subMonths } from "date-fns";

import { RateChangeImpactError, useWorkerStore } from "../stores/workerStore";
import { usePeriodStore, ClosedPeriodError } from "../stores/periodStore";
import { periodOfDate, todayKey } from "../lib/period";
import { describeRateChangeImpact, rateChangeImpact } from "../lib/rateChangeImpact";
import type { Worker } from "../types";

/** `monthsBack` ay önceki dönem anahtarı. */
const addMonths = (monthsBack: number): string => periodOfDate(subMonths(new Date(), monthsBack));

const worker: Worker = {
  id: 1,
  name: "Ahmet",
  daily_wage: 600,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
};

/**
 * Geçmişte bir dönemi kapatır — ücret değişikliği oradan başlarsa onay ister.
 */
const closePeriodAgo = (monthsBack: number): string => {
  const period = addMonths(monthsBack);
  usePeriodStore.setState({
    closed: [{ period, closed_at: "2026-10-01 09:00:00", note: null }],
    closedLoaded: true,
    earliestDataPeriod: period,
  });
  return period;
};

/** Kilit listesi okunmamış durumu — hangi dönemin kapalı olduğu bilinmiyor. */
const lockStateUnknown = (): void => {
  // `closed` DOKUNULMAZ: liste değişirse store `closedLoaded`'ı true yapıyor
  // (el ile kurulan durum yüklenmiş sayılır). Yalnız bayrağı indirmek
  // "kilit listesi okunamadı" durumunu taklit eder.
  usePeriodStore.setState({ closedLoaded: false, earliestDataPeriod: null });
};

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  executeTransaction.mockReset().mockResolvedValue(undefined);
  usePeriodStore.setState({
    closed: [],
    closedLoaded: true,
    earliestDataPeriod: "2020-01",
    isLoading: false,
  });
  useWorkerStore.setState({
    workers: [worker],
    rateHistory: [],
    isLoading: false,
    error: null,
  });
});

describe("updateWorker — geçmişe yürüyen ücret değişikliği (K2)", () => {
  it("kilitli bir ayda bile onaysız hiçbir yazma yapmaz", async () => {
    const period = closePeriodAgo(2);

    await expect(
      useWorkerStore.getState().updateWorker(1, "Ahmet", 900, "GUNLUK", `${period}-01`),
    ).rejects.toThrow(RateChangeImpactError);

    expect(executeQuery).not.toHaveBeenCalled();
    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it("kilitli ayda ClosedPeriodError fırlatmaz — onay yolu açıktır", async () => {
    const period = closePeriodAgo(2);

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(1, "Ahmet", 900, "GUNLUK", `${period}-01`, { confirmRetroactive: true }),
    ).resolves.toBeUndefined();

    expect(executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("onay metni etkilenen dönemleri sayıyla verir, kilitlileri ayrıca işaretler", async () => {
    const period = closePeriodAgo(2);

    const err = await useWorkerStore
      .getState()
      .updateWorker(1, "Ahmet", 900, "GUNLUK", `${period}-01`)
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RateChangeImpactError);
    const impact = (err as RateChangeImpactError).impact;
    expect(impact.periods).toEqual([period, addMonths(1), periodOfDate(new Date())]);
    expect(impact.closedPeriods).toEqual([period]);
    // Store, ekranla aynı cümleyi üretir: `describeRateChangeImpact` tek kaynak.
    expect((err as Error).message).toBe(describeRateChangeImpact(impact));
    expect((err as Error).message).toContain("3 dönem etkilenecek");
    expect((err as Error).message).toContain(period);
  });

  it("kilitli olmayan geçmiş bir ay için de onay ister", async () => {
    const period = closePeriodAgo(4);
    usePeriodStore.setState({ closed: [], closedLoaded: true });

    await expect(
      useWorkerStore.getState().updateWorker(1, "Ahmet", 900, "GUNLUK", `${period}-01`),
    ).rejects.toThrow(RateChangeImpactError);

    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it("BU AYIN İÇİNDEKİ bir tarih onay istemez — ay ortası zam yolu açık kalır", async () => {
    const today = new Date();
    const day = today.getDate();

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(
          1,
          "Ahmet",
          900,
          "GUNLUK",
          `${periodOfDate(today)}-${String(day).padStart(2, "0")}`,
        ),
    ).resolves.toBeUndefined();

    expect(executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("BU AYIN BAŞI da onay istemez (güncel ay kilitli değilken)", async () => {
    const today = new Date();

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(1, "Ahmet", 900, "GUNLUK", format(startOfMonth(today), "yyyy-MM-dd")),
    ).resolves.toBeUndefined();

    expect(executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("GÜNCEL AY KAPALIYSA bu ayın içindeki bir tarih bile onay ister (L1)", async () => {
    // Güncel ay da kapatılabiliyor; kapalı döneme onaysız ücret geçmişi
    // yazılmamalı (PROBE-CC / PROBE-DD).
    const today = new Date();
    const period = periodOfDate(today);
    usePeriodStore.setState({
      closed: [{ period, closed_at: "2026-10-01 09:00:00", note: null }],
      closedLoaded: true,
      earliestDataPeriod: period,
    });

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(
          1,
          "Ahmet",
          900,
          "GUNLUK",
          `${period}-${String(today.getDate()).padStart(2, "0")}`,
        ),
    ).rejects.toThrow(RateChangeImpactError);

    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it("earliestDataPeriod bilinmiyorken iki katman aynı kararı verir (L3)", async () => {
    // Ekran da `rateChangeImpact`'i çağırıyor; store da aynı fonksiyonu
    // çağırmalı. Ayrı hesaplar kalırsa kullanıcı onay diyaloğunu hiç
    // görmeden kalıcı hata alıyordu.
    usePeriodStore.setState({ earliestDataPeriod: null });
    const past = addMonths(2);

    const err = await useWorkerStore
      .getState()
      .updateWorker(1, "Ahmet", 900, "GUNLUK", `${past}-01`)
      .catch((e: unknown) => e);

    const screen = rateChangeImpact({
      effectiveFrom: `${past}-01`,
      today: todayKey(),
      earliestDataPeriod: null,
      closedPeriods: [],
    });
    expect((err as RateChangeImpactError).impact).toEqual(screen);
  });

  it("earliestDataPeriod bilinmiyorken kilitli güncel ay da onay ister (L3+L1)", async () => {
    const today = new Date();
    const period = periodOfDate(today);
    usePeriodStore.setState({
      closed: [{ period, closed_at: "2026-10-01 09:00:00", note: null }],
      closedLoaded: true,
      earliestDataPeriod: null,
    });

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(
          1,
          "Ahmet",
          900,
          "GUNLUK",
          `${period}-${String(today.getDate()).padStart(2, "0")}`,
        ),
    ).rejects.toThrow(RateChangeImpactError);
  });

  it("earliestDataPeriod bilinmiyorken kilitli dönem listesi de iki katmanı eşitler (L3)", async () => {
    // Ekran `closedPeriods`'i store'dan okur; ikisi farklı karar verirse
    // onay diyaloğu hiç açılmadan yazma olur ya da ekran hata görür.
    const past = addMonths(2);
    usePeriodStore.setState({
      closed: [{ period: past, closed_at: "2026-01-01 09:00:00", note: null }],
      closedLoaded: true,
      earliestDataPeriod: null,
    });

    const err = await useWorkerStore
      .getState()
      .updateWorker(1, "Ahmet", 900, "GUNLUK", `${past}-01`)
      .catch((e: unknown) => e);

    const screen = rateChangeImpact({
      effectiveFrom: `${past}-01`,
      today: todayKey(),
      earliestDataPeriod: null,
      closedPeriods: [past],
    });
    expect((err as RateChangeImpactError).impact).toEqual(screen);
    expect((err as RateChangeImpactError).impact.closedPeriods).toEqual([past]);
  });

  it("gelecek bir tarih onay istemez", async () => {
    const future = format(subMonths(new Date(), -1), "yyyy-MM");

    await expect(
      useWorkerStore.getState().updateWorker(1, "Ahmet", 900, "GUNLUK", `${future}-01`),
    ).resolves.toBeUndefined();

    expect(executeTransaction).toHaveBeenCalledTimes(1);
  });

  it("veri en eski dönemden başlıyorsa yalnız o dönemden bugüne kadar onay ister", async () => {
    const from = addMonths(5);
    usePeriodStore.setState({ earliestDataPeriod: from });

    const err = await useWorkerStore
      .getState()
      .updateWorker(1, "Ahmet", 900, "GUNLUK", `${addMonths(9)}-01`)
      .catch((e: unknown) => e);

    // `effectiveFrom` veriden eski olduğu için uyarı aralığı `from`'da başlar:
    // o dönemden öncesi zaten eski yevmiyeyle hesaplanıyordu.
    const periods = (err as RateChangeImpactError).impact.periods;
    expect(periods[0]).toBe(from);
    expect(periods[periods.length - 1]).toBe(periodOfDate(new Date()));
    expect(periods).toHaveLength(6);
  });

  it("earliestDataPeriod bilinmiyorsa fail-closed: geçmişte onay ister", async () => {
    const past = addMonths(2);
    usePeriodStore.setState({ earliestDataPeriod: null });

    await expect(
      useWorkerStore.getState().updateWorker(1, "Ahmet", 900, "GUNLUK", `${past}-01`),
    ).rejects.toThrow(RateChangeImpactError);
  });

  it("earliestDataPeriod bilinmiyorsa bile güncel ay onaysız geçer", async () => {
    usePeriodStore.setState({ earliestDataPeriod: null });

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(1, "Ahmet", 900, "GUNLUK", `${periodOfDate(new Date())}-12`),
    ).resolves.toBeUndefined();
  });

  it("kilit listesi okunmamışsa hiçbir yazma yapmaz (fail-closed)", async () => {
    lockStateUnknown();

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(1, "Ahmet", 900, "GUNLUK", `${periodOfDate(new Date())}-12`),
    ).rejects.toThrow(ClosedPeriodError);

    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it("yalnızca ad değiştiğinde geçmiş kapısı devreye girmez", async () => {
    const past = addMonths(3);

    await expect(
      useWorkerStore.getState().updateWorker(1, "Ahmet Yılmaz", 600, "GUNLUK", `${past}-01`),
    ).resolves.toBeUndefined();

    expect(executeQuery).toHaveBeenCalledTimes(1);
  });

  it("onaysız reddedildiğinde çalışan listesini değiştirmez", async () => {
    const period = closePeriodAgo(2);

    await expect(
      useWorkerStore.getState().updateWorker(1, "Ahmet", 900, "GUNLUK", `${period}-01`),
    ).rejects.toThrow(RateChangeImpactError);

    expect(useWorkerStore.getState().workers[0].daily_wage).toBe(600);
    expect(useWorkerStore.getState().error).toBeTruthy();
  });

  it("store'da kayıtlı olmayan çalışan için de geçmiş kapısı denetler", async () => {
    const period = closePeriodAgo(2);
    useWorkerStore.setState({ workers: [] });

    await expect(
      useWorkerStore.getState().updateWorker(99, "Yeni", 900, "GUNLUK", `${period}-01`),
    ).rejects.toThrow(RateChangeImpactError);

    expect(executeTransaction).not.toHaveBeenCalled();
  });
});

describe("updateWorker — yazma atomikliği", () => {
  it("onaylı ücret değişikliğini tek transaction'da iki tabloya yazar", async () => {
    await expect(
      useWorkerStore
        .getState()
        .updateWorker(1, "Ahmet Yılmaz", 900, "GUNLUK", "2026-05-01", { confirmRetroactive: true }),
    ).resolves.toBeUndefined();

    expect(executeTransaction).toHaveBeenCalledTimes(1);
    const statements = executeTransaction.mock.calls[0][0] as string[];
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("workers");
    expect(statements[1]).toContain("worker_rate_history");
    // Yazma tek transaction dışında kalmamalı.
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("transaction reddedilirse store hata fırlatır ve refetch yapmaz", async () => {
    executeTransaction.mockRejectedValueOnce(new Error("CHECK constraint failed"));

    await expect(
      useWorkerStore
        .getState()
        .updateWorker(1, "Ahmet", 900, "GUNLUK", "2026-05-01", { confirmRetroactive: true }),
    ).rejects.toThrow("CHECK constraint failed");

    expect(useWorkerStore.getState().error).toBe("CHECK constraint failed");
    expect(useWorkerStore.getState().workers).toEqual([worker]);
  });

  it("yalnızca ad değiştiğinde tek ifade yazar, transaction açmaz", async () => {
    await expect(
      useWorkerStore.getState().updateWorker(1, "Ahmet Yılmaz", 600, "GUNLUK"),
    ).resolves.toBeUndefined();

    expect(executeTransaction).not.toHaveBeenCalled();
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0][0]).toContain("UPDATE workers");
  });
});

describe("addWorker — yazma atomikliği", () => {
  it("çalışan kaydı ve açılış ücret kaydını tek transaction'da yazar", async () => {
    await expect(
      useWorkerStore.getState().addWorker("Veli", 700, "GUNLUK"),
    ).resolves.toBeUndefined();

    expect(executeTransaction).toHaveBeenCalledTimes(1);
    const statements = executeTransaction.mock.calls[0][0] as string[];
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain("INSERT OR ROLLBACK INTO workers");
    expect(statements[1]).toContain("INSERT OR ROLLBACK INTO worker_rate_history");
    // Yeni çalışanın id'si transaction içinde okunmalı; ayrı bir SELECT turu olmamalı.
    expect(statements[1]).toContain("last_insert_rowid()");
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("transaction reddedilirse yarım kayıt bırakmaz", async () => {
    executeTransaction.mockRejectedValueOnce(new Error("FOREIGN KEY constraint failed"));

    await expect(useWorkerStore.getState().addWorker("Veli", 700, "GUNLUK")).rejects.toThrow(
      "FOREIGN KEY constraint failed",
    );

    expect(useWorkerStore.getState().workers).toEqual([worker]);
    expect(useWorkerStore.getState().error).toBe("FOREIGN KEY constraint failed");
  });
});
