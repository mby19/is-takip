import { fetchQuery, executeQuery } from "../lib/db";
import type { Worker, WorkerType } from "../types";

export const workerRepository = {
  findAll: (): Promise<Worker[]> =>
    fetchQuery<Worker>("SELECT * FROM workers ORDER BY is_active DESC, name ASC"),

  create: (name: string, daily_wage: number, worker_type: WorkerType) =>
    executeQuery(
      "INSERT INTO workers (name, daily_wage, worker_type, is_active) VALUES (?, ?, ?, 1)",
      [name, daily_wage, worker_type],
    ),

  /** Eklenen çalışanın id'sini döndürür (ücret geçmişi açılış kaydı için). */
  findIdByName: (name: string): Promise<{ id: number }[]> =>
    fetchQuery<{ id: number }>("SELECT id FROM workers WHERE name = ? ORDER BY id DESC LIMIT 1", [
      name,
    ]),

  update: (id: number, name: string, daily_wage: number, worker_type: WorkerType) =>
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
