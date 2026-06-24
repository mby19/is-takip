import { fetchQuery, executeQuery } from "../lib/db";
import type { Attendance } from "../types";

export const attendanceRepository = {
  findByDate: (date: string): Promise<Attendance[]> =>
    fetchQuery<Attendance>("SELECT * FROM attendance WHERE date = ?", [date]),

  findByDateRange: (start: string, end: string): Promise<Attendance[]> =>
    fetchQuery<Attendance>("SELECT * FROM attendance WHERE date >= ? AND date <= ?", [start, end]),

  upsert: (worker_id: number, date: string, status: "FULL" | "HALF" | "ABSENT" | "HOLIDAY") =>
    executeQuery("INSERT OR REPLACE INTO attendance (worker_id, date, status) VALUES (?, ?, ?)", [
      worker_id,
      date,
      status,
    ]),

  remove: (worker_id: number, date: string) =>
    executeQuery("DELETE FROM attendance WHERE worker_id = ? AND date = ?", [worker_id, date]),
};
