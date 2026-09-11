import { fetchQuery, executeQuery } from "../lib/db";

export interface ClosedPeriod {
  period: string; // YYYY-MM
  closed_at: string;
  note: string | null;
}

export const closedPeriodRepository = {
  findAll: (): Promise<ClosedPeriod[]> =>
    fetchQuery<ClosedPeriod>("SELECT * FROM closed_periods ORDER BY period DESC"),

  close: (period: string, note?: string) =>
    executeQuery(
      `INSERT INTO closed_periods (period, note) VALUES (?, ?)
       ON CONFLICT(period) DO UPDATE SET closed_at = DATETIME('now', 'localtime'), note = excluded.note`,
      [period, note || null],
    ),

  reopen: (period: string) => executeQuery("DELETE FROM closed_periods WHERE period = ?", [period]),

  /** En eski veri dönemi — dönem listesinin nereye kadar gideceğini belirler. */
  earliestDataPeriod: (): Promise<{ period: string | null }[]> =>
    fetchQuery<{ period: string | null }>(
      `SELECT MIN(period) AS period FROM (
         SELECT substr(date, 1, 7) AS period FROM attendance
         UNION ALL SELECT substr(date, 1, 7) FROM daily_metrics
         UNION ALL SELECT substr(date, 1, 7) FROM payments
       )`,
    ),
};
