import { fetchQuery, executeQuery } from "../lib/db";
import type { Payment } from "../types";

export const paymentRepository = {
  findAll: (): Promise<Payment[]> =>
    fetchQuery<Payment>("SELECT * FROM payments ORDER BY date DESC, id DESC"),

  findByWorker: (worker_id: number): Promise<Payment[]> =>
    fetchQuery<Payment>("SELECT * FROM payments WHERE worker_id = ? ORDER BY date DESC, id DESC", [
      worker_id,
    ]),

  create: (worker_id: number, amount: number, date: string, description?: string) =>
    executeQuery(
      "INSERT INTO payments (worker_id, amount, date, description) VALUES (?, ?, ?, ?)",
      [worker_id, amount, date, description || null],
    ),

  remove: (id: number) => executeQuery("DELETE FROM payments WHERE id = ?", [id]),
};
