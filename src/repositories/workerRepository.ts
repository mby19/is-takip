import { fetchQuery, executeQuery } from "../lib/db";
import type { Worker } from "../types";

export const workerRepository = {
  findAll: (): Promise<Worker[]> =>
    fetchQuery<Worker>("SELECT * FROM workers ORDER BY is_active DESC, name ASC"),

  findById: (id: number): Promise<Worker[]> =>
    fetchQuery<Worker>("SELECT * FROM workers WHERE id = ?", [id]),

  create: (name: string, daily_wage: number, worker_type: "ORTAK" | "GUNLUK") =>
    executeQuery(
      "INSERT INTO workers (name, daily_wage, worker_type, is_active) VALUES (?, ?, ?, 1)",
      [name, daily_wage, worker_type],
    ),

  update: (id: number, name: string, daily_wage: number, worker_type: "ORTAK" | "GUNLUK") =>
    executeQuery("UPDATE workers SET name = ?, daily_wage = ?, worker_type = ? WHERE id = ?", [
      name,
      daily_wage,
      worker_type,
      id,
    ]),

  updateStatus: (id: number, is_active: boolean) =>
    executeQuery("UPDATE workers SET is_active = ? WHERE id = ?", [is_active ? 1 : 0, id]),

  archive: (id: number) => executeQuery("UPDATE workers SET is_active = 0 WHERE id = ?", [id]),
};
