import { fetchQuery, executeQuery } from "../lib/db";
import type { WorkerRate, WorkerType } from "../types";

export const workerRateRepository = {
  findAll: (): Promise<WorkerRate[]> =>
    fetchQuery<WorkerRate>("SELECT * FROM worker_rate_history ORDER BY worker_id, valid_from"),

  findByWorker: (worker_id: number): Promise<WorkerRate[]> =>
    fetchQuery<WorkerRate>(
      "SELECT * FROM worker_rate_history WHERE worker_id = ? ORDER BY valid_from",
      [worker_id],
    ),

  /** Aynı gün için ikinci bir değişiklik yapılırsa üzerine yazar. */
  upsert: (worker_id: number, valid_from: string, daily_wage: number, worker_type: WorkerType) =>
    executeQuery(
      `INSERT INTO worker_rate_history (worker_id, valid_from, daily_wage, worker_type)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(worker_id, valid_from) DO UPDATE SET
         daily_wage = excluded.daily_wage,
         worker_type = excluded.worker_type`,
      [worker_id, valid_from, daily_wage, worker_type],
    ),

  remove: (id: number) => executeQuery("DELETE FROM worker_rate_history WHERE id = ?", [id]),
};
