import { fetchQuery, executeQuery } from "../lib/db";
import type { DailyMetric } from "../types";

interface IdResult {
  id: number;
}

export const metricsRepository = {
  findByDate: (date: string): Promise<DailyMetric[]> =>
    fetchQuery<DailyMetric>("SELECT * FROM daily_metrics WHERE date = ?", [date]),

  findByDateRange: (start: string, end: string): Promise<DailyMetric[]> =>
    fetchQuery<DailyMetric>("SELECT * FROM daily_metrics WHERE date >= ? AND date <= ?", [
      start,
      end,
    ]),

  findIdByDate: (date: string): Promise<IdResult[]> =>
    fetchQuery<IdResult>("SELECT id FROM daily_metrics WHERE date = ?", [date]),

  upsert: (
    date: string,
    production_amount: number,
    total_earned: number,
    extra_expenses: number,
    is_holiday: boolean,
  ) => {
    const holidayInt = is_holiday ? 1 : 0;
    return executeQuery(
      `INSERT INTO daily_metrics (date, production_amount, total_earned, extra_expenses, is_holiday)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(date) DO UPDATE SET
         production_amount = excluded.production_amount,
         total_earned = excluded.total_earned,
         extra_expenses = excluded.extra_expenses,
         is_holiday = excluded.is_holiday`,
      [date, production_amount, total_earned, extra_expenses, holidayInt],
    );
  },

  update: (
    date: string,
    production_amount: number,
    total_earned: number,
    extra_expenses: number,
    is_holiday: boolean,
  ) => {
    const holidayInt = is_holiday ? 1 : 0;
    return executeQuery(
      "UPDATE daily_metrics SET production_amount = ?, total_earned = ?, extra_expenses = ?, is_holiday = ? WHERE date = ?",
      [production_amount, total_earned, extra_expenses, holidayInt, date],
    );
  },

  insert: (
    date: string,
    production_amount: number,
    total_earned: number,
    extra_expenses: number,
    is_holiday: boolean,
  ) => {
    const holidayInt = is_holiday ? 1 : 0;
    return executeQuery(
      "INSERT INTO daily_metrics (date, production_amount, total_earned, extra_expenses, is_holiday) VALUES (?, ?, ?, ?, ?)",
      [date, production_amount, total_earned, extra_expenses, holidayInt],
    );
  },
};
