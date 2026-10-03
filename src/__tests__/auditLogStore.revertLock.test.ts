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

import { useAuditLogStore } from "../stores/auditLogStore";
import { usePeriodStore, ClosedPeriodError } from "../stores/periodStore";
import type { AuditLog } from "../types";

/**
 * Kapalı 2026-01 döneminde yapılan ücret değişikliğinin `workers` denetim kaydı.
 * Ücret geçmişi satırı `valid_from = 2026-01-15` idi ve geri alma onu SİLİYOR
 * (PROBE-W: kapalı dönemin ücret geçmişi sessizce siliniyordu).
 */
const wageChangeLog = (): AuditLog => ({
  id: 10,
  action_type: "UPDATE",
  entity_table: "workers",
  record_id: 7,
  old_data: "name=Ahmet|type=GUNLUK|wage=1000|is_active=1",
  new_data: "name=Ahmet|type=GUNLUK|wage=900|is_active=1",
  created_at: "2026-01-20 10:00:00",
  reverted_at: null,
});

/** Ücret geçmişi denetim kaydını arayan sorguların çağrıları. */
const rateRowQueries = (): string[] =>
  fetchQuery.mock.calls
    .map((call) => String((call as unknown as [string])[0]))
    .filter((sql) => sql.includes("entity_table = 'worker_rate_history'"));

/** Arama sorgusunu `valid_from` değeriyle besler; diğer sorgular boş döner. */
const withRateRow = (validFrom: string) => {
  fetchQuery.mockImplementation((sql: unknown) =>
    Promise.resolve(
      String(sql).includes("entity_table = 'worker_rate_history'")
        ? [{ action_type: "INSERT", record_id: 42, valid_from: validFrom }]
        : [],
    ),
  );
};

const closePeriod = (period: string) => {
  usePeriodStore.setState({
    closed: [{ period, closed_at: "2026-02-01 09:00:00", note: null }],
    closedLoaded: true,
  });
};

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  executeTransaction.mockReset().mockResolvedValue(undefined);
  fetchQuery.mockReset().mockResolvedValue([]);
  usePeriodStore.setState({ closed: [], closedLoaded: true, earliestDataPeriod: null });
  useAuditLogStore.setState({ logs: [], isLoading: false, error: null });
});

describe("revertLog — worker_rate_history kilit kontrolü (L2)", () => {
  it("kapalı dönemin ücret geçmişi workers üzerinden geri alınamaz", async () => {
    closePeriod("2026-01");
    withRateRow("2026-01-15");

    await expect(useAuditLogStore.getState().revertLog(wageChangeLog())).rejects.toThrow(
      ClosedPeriodError,
    );

    // Kontrol SQL üretilmeden ÖNCE durur: hiçbir yazma yapılmaz.
    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it("kapalı olmayan dönemin geri alınmasına izin verir (pozitif kontrol)", async () => {
    closePeriod("2026-03");
    withRateRow("2026-01-15");

    await expect(useAuditLogStore.getState().revertLog(wageChangeLog())).resolves.toBe(true);

    expect(executeTransaction).toHaveBeenCalledTimes(1);
    const statements = executeTransaction.mock.calls[0]![0] as string[];
    expect(statements.some((s) => s.includes("DELETE FROM worker_rate_history"))).toBe(true);
  });

  it("ücret geçmişi tarihi okunamıyorsa fail-closed: geri alma durur", async () => {
    closePeriod("2026-03");
    withRateRow("");

    await expect(useAuditLogStore.getState().revertLog(wageChangeLog())).rejects.toThrow(
      /kapalı dönem kontrolü yapılamadığı/,
    );

    expect(executeTransaction).not.toHaveBeenCalled();
  });

  it("yalnız ad değişikliğinde ücret geçmişi sorgulanmaz", async () => {
    closePeriod("2026-01");

    await expect(
      useAuditLogStore.getState().revertLog({
        ...wageChangeLog(),
        new_data: "name=Ahmet Yılmaz|type=GUNLUK|wage=1000|is_active=1",
      }),
    ).resolves.toBe(true);

    expect(rateRowQueries()).toHaveLength(0);
  });
});
