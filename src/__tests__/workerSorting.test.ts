import { describe, it, expect, beforeEach, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";

/**
 * Repository testi gerçek SQLite üzerinde koşar (bkz. ADR-0007): SQL
 * doğrulanmadan "sıralama düzeldi" demek, BINARY collation'ın hâlâ devrede
 * olduğunu gizlerdi. `fetchQuery` mock'lanmaz; yalnız bağlantı kurulumu
 * `node:sqlite` adaptörüne yönlendirilir.
 */
const db = new DatabaseSync(":memory:");
const adapter = {
  select: async <T>(query: string, values: unknown[] = []) =>
    db.prepare(query).all(...(values as never[])) as T[],
  execute: async (query: string, values: unknown[] = []) => {
    const r = db.prepare(query).run(...(values as never[]));
    return { rowsAffected: Number(r.changes ?? 0) };
  },
};

vi.mock("../lib/db", () => ({
  getDb: () => Promise.resolve(adapter),
  executeQuery: (query: string, values: unknown[] = []) => adapter.execute(query, values),
  fetchQuery: <T>(query: string, values: unknown[] = []) => adapter.select<T>(query, values),
  executeTransaction: vi.fn(),
  getTriggerSetupError: () => null,
}));

import { workerRepository } from "../repositories/workerRepository";

const addWorker = (name: string, isActive = 1) =>
  db
    .prepare(
      "INSERT INTO workers (name, daily_wage, worker_type, is_active) VALUES (?, 900, 'GUNLUK', ?)",
    )
    .run(name, isActive);

beforeEach(() => {
  db.exec(`CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, daily_wage REAL NOT NULL,
    worker_type TEXT CHECK( worker_type IN ('ORTAK','GUNLUK') ) NOT NULL,
    created_at DATETIME DEFAULT (DATETIME('now','localtime')), is_active BOOLEAN DEFAULT 1,
    color TEXT, short_label TEXT)`);
  db.exec("DELETE FROM workers");
});

describe("workerRepository.findAll — Türkçe sıralama", () => {
  it("BINARY collation yerine Türkçe alfabet sırası uygular", async () => {
    for (const name of ["Zeynep", "Çetin", "Ayşe", "Berna", "Uğur", "Şahin", "Ömer", "Ali"]) {
      addWorker(name);
    }

    const workers = await workerRepository.findAll();

    // BINARY'de Ç/Ş/Ö 'Z' ve 'z' sonrasına düşerdi; burada alfabet sırası.
    expect(workers.map((w) => w.name)).toEqual([
      "Ali",
      "Ayşe",
      "Berna",
      "Çetin",
      "Ömer",
      "Şahin",
      "Uğur",
      "Zeynep",
    ]);
  });

  it("Ç, Ğ, I, Ö, Ş, Ü ve büyük harf karışımında alfabeti korur", async () => {
    for (const name of ["zeynep", "İbrahim", "Öykü", "Gökhan", "Çiğdem", "Şule", "Ayhan"]) {
      addWorker(name);
    }

    const sorted = (await workerRepository.findAll()).map((w) => w.name);

    expect(sorted).toEqual(["Ayhan", "Çiğdem", "Gökhan", "İbrahim", "Öykü", "Şule", "zeynep"]);
  });

  it("Türkçe olmayan harfler Türkçe sırayı bozmaz", async () => {
    for (const name of ["Åsa", "Çetin", "Zeynep", "Ali"]) addWorker(name);

    const sorted = (await workerRepository.findAll()).map((w) => w.name);

    expect(sorted.indexOf("Ali")).toBeLessThan(sorted.indexOf("Åsa"));
    expect(sorted.indexOf("Åsa")).toBeLessThan(sorted.indexOf("Çetin"));
    expect(sorted.indexOf("Çetin")).toBeLessThan(sorted.indexOf("Zeynep"));
  });

  it("aktif olmayanlar sona gider, aralarında da Türkçe sıralanır", async () => {
    addWorker("Zeynep", 1);
    addWorker("Çetin", 0);
    addWorker("Ali", 1);
    addWorker("Şahin", 0);

    const workers = await workerRepository.findAll();

    expect(workers.map((w) => w.name)).toEqual(["Ali", "Zeynep", "Çetin", "Şahin"]);
    expect(workers.map((w) => w.is_active)).toEqual([1, 1, 0, 0]);
  });
});
