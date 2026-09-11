import { fetchQuery, executeQuery } from "../lib/db";
import type { DailyMetric } from "../types";

export const metricsRepository = {
  findAll: (): Promise<DailyMetric[]> =>
    fetchQuery<DailyMetric>("SELECT * FROM daily_metrics ORDER BY date"),

  findByDate: (date: string): Promise<DailyMetric[]> =>
    fetchQuery<DailyMetric>("SELECT * FROM daily_metrics WHERE date = ?", [date]),

  findByDateRange: (start: string, end: string): Promise<DailyMetric[]> =>
    fetchQuery<DailyMetric>("SELECT * FROM daily_metrics WHERE date >= ? AND date <= ?", [
      start,
      end,
    ]),

  findIdByDate: (date: string): Promise<{ id: number }[]> =>
    fetchQuery<{ id: number }>("SELECT id FROM daily_metrics WHERE date = ?", [date]),

  /** Tek atomik ifade — oku-sonra-yaz yarışını önler. */
  upsert: (
    date: string,
    production_amount: number,
    total_earned: number,
    extra_expenses: number,
    is_holiday: boolean,
  ) =>
    executeQuery(
      `INSERT INTO daily_metrics (date, production_amount, total_earned, extra_expenses, is_holiday)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         production_amount = excluded.production_amount,
         total_earned = excluded.total_earned,
         extra_expenses = excluded.extra_expenses,
         is_holiday = excluded.is_holiday`,
      [date, production_amount, total_earned, extra_expenses, is_holiday ? 1 : 0],
    ),
};
