import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "../types";

/**
 * `revertStrategies` ve `attendanceRepository` için GERÇEK koruma testi.
 *
 * Bu test production `execute()` fonksiyonunu çağırır ve ürettiği SQL'i
 * gerçek bir SQLite veritabanında (`node:sqlite`) çalıştırır; iddialar
 * veritabanında gözlenen sonuçla doğrulanır. Önceki `revertStrategies.test.ts`
 * strateji gövdesinin KOPYASINI test ediyordu — üretim kodu değişse test
 * yine geçiyordu.
 *
 * Her iki modül de `../lib/db` üzerinden veritabanına erişir; Tauri SQL
 * eklentisi test ortamında yok, bu yüzden modül gerçek SQLite'a bağlayan bir
 * adaptörle mock'lanır.
 */

const state = vi.hoisted(() => ({ db: null as DatabaseSync | null }));

vi.mock("../lib/db", async () => {
  const { DatabaseSync: Database } = await import("node:sqlite");
  const db = new Database(":memory:");
  state.db = db;

  const runTransaction = (statements: string[]) => {
    const body = statements
      .map((s) => (s.trim().endsWith(";") ? s.trim() : `${s.trim()};`))
      .join("\n");
    try {
      db.exec(`BEGIN IMMEDIATE;\n${body}\nCOMMIT;`);
    } catch (error: unknown) {
      // Üretimdeki `executeTransaction` ile aynı davranış: yarıda kalan
      // transaction'ı kapat, yoksa sonraki testler de bozulur.
      try {
        db.exec("ROLLBACK;");
      } catch {
        /* aktif transaction yok */
      }
      throw error;
    }
  };

  return {
    fetchQuery: async (query: string, values: unknown[] = []) =>
      db.prepare(query).all(...(values as never[])),
    executeQuery: async (query: string, values: unknown[] = []) => ({
      rowsAffected: Number(db.prepare(query).run(...(values as never[])).changes ?? 0),
    }),
    executeTransaction: async (statements: string[]) => runTransaction(statements),
  };
});

const { getRevertStrategy, createRevertContext, resolveAffectedDate } =
  await import("../stores/revertStrategies");
const { attendanceRepository } = await import("../repositories/attendanceRepository");
const { CREATE_TRIGGERS } = await import("../schema/triggers");

const db = state.db as DatabaseSync;

const SCHEMA = `
  CREATE TABLE workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    daily_wage REAL NOT NULL,
    worker_type TEXT NOT NULL,
    created_at DATETIME DEFAULT (DATETIME('now','localtime')),
    is_active INTEGER DEFAULT 1,
    color TEXT,
    short_label TEXT
  );
  CREATE TABLE attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT CHECK( status IN ('FULL','HALF','ABSENT','HOLIDAY') ) NOT NULL,
    UNIQUE(worker_id, date)
  );
  CREATE TABLE daily_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    production_amount INTEGER DEFAULT 0,
    total_earned REAL DEFAULT 0,
    extra_expenses REAL DEFAULT 0,
    is_holiday INTEGER DEFAULT 0
  );
  CREATE TABLE payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    description TEXT
  );
  CREATE TABLE worker_rate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    valid_from TEXT NOT NULL,
    daily_wage REAL NOT NULL,
    worker_type TEXT NOT NULL,
    UNIQUE(worker_id, valid_from)
  );
  CREATE TABLE audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,
    entity_table TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    old_data TEXT,
    new_data TEXT,
    created_at DATETIME DEFAULT (DATETIME('now','localtime')),
    reverted_at DATETIME
  );
`;

const TABLES = [
  "audit_logs",
  "worker_rate_history",
  "payments",
  "attendance",
  "daily_metrics",
  "workers",
];

beforeEach(() => {
  db.exec(`PRAGMA foreign_keys = OFF;`);
  for (const trigger of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'")
    .all() as { name: string }[]) {
    db.exec(`DROP TRIGGER IF EXISTS ${trigger.name}`);
  }
  for (const table of TABLES) db.exec(`DROP TABLE IF EXISTS ${table}`);
  db.exec(SCHEMA);
});

/** Üretimdeki strateji SQL'ini tek transaction'da çalıştırır. */
const runRevert = async (log: AuditLog): Promise<string[]> => {
  const strategy = getRevertStrategy(log.action_type, log.entity_table);
  if (!strategy) throw new Error(`Strateji yok: ${log.action_type}:${log.entity_table}`);
  const statements = await strategy.execute(createRevertContext(log));
  const body = statements
    .map((s) => (s.trim().endsWith(";") ? s.trim() : `${s.trim()};`))
    .join("\n");
  try {
    db.exec(`BEGIN IMMEDIATE;\n${body}\nCOMMIT;`);
  } catch (error: unknown) {
    try {
      db.exec("ROLLBACK;");
    } catch {
      /* aktif transaction yok */
    }
    throw error;
  }
  return statements;
};

const makeLog = (partial: Partial<AuditLog>): AuditLog => ({
  id: 900,
  action_type: "UPDATE",
  entity_table: "attendance",
  record_id: 1,
  old_data: null,
  new_data: null,
  created_at: "2026-06-21 10:00:00",
  ...partial,
});

const attendanceRows = () =>
  db.prepare("SELECT worker_id, date, status FROM attendance ORDER BY worker_id").all() as {
    worker_id: number;
    date: string;
    status: string;
  }[];

const insertWorkers = (rows: { id: number; name: string; wage?: number }[]) => {
  for (const w of rows) {
    db.prepare(
      "INSERT INTO workers (id, name, daily_wage, worker_type) VALUES (?,?,?,'GUNLUK')",
    ).run(w.id, w.name, w.wage ?? 900);
  }
};

describe("attendanceRepository.upsert (B1)", () => {
  beforeEach(() => {
    insertWorkers([{ id: 1, name: "Ali" }]);
  });

  it("puantaj değişikliğini UPDATE olarak denetler", async () => {
    for (const sql of CREATE_TRIGGERS) db.exec(sql);
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (1,'2026-06-20','FULL')",
    ).run();

    await attendanceRepository.upsert(1, "2026-06-20", "HALF");

    const logs = db
      .prepare("SELECT action_type FROM audit_logs WHERE entity_table = 'attendance' ORDER BY id")
      .all() as { action_type: string }[];
    expect(logs.map((l) => l.action_type)).toEqual(["INSERT", "UPDATE"]);

    const updated = db
      .prepare("SELECT old_data, new_data FROM audit_logs WHERE action_type = 'UPDATE'")
      .get() as { old_data: string; new_data: string };
    expect(JSON.parse(updated.old_data).status).toBe("FULL");
    expect(JSON.parse(updated.new_data).status).toBe("HALF");
  });

  it("değişiklik aynı satırın id'sini korur (DELETE+INSERT değil)", async () => {
    await attendanceRepository.upsert(1, "2026-06-20", "FULL");
    const before = db.prepare("SELECT id FROM attendance").get() as { id: number };

    await attendanceRepository.upsert(1, "2026-06-20", "ABSENT");

    const after = db.prepare("SELECT id, status FROM attendance").get() as {
      id: number;
      status: string;
    };
    expect(after.id).toBe(before.id);
    expect(after.status).toBe("ABSENT");
  });

  it("arşivleme (is_active) denetim günlüğüne girer (B3)", () => {
    for (const sql of CREATE_TRIGGERS) db.exec(sql);
    db.prepare("UPDATE workers SET is_active = 0 WHERE id = 1").run();

    const logs = db
      .prepare("SELECT action_type, new_data FROM audit_logs WHERE entity_table = 'workers'")
      .all() as { action_type: string; new_data: string }[];
    expect(logs).toHaveLength(1);
    expect(logs[0].action_type).toBe("UPDATE");
    expect(JSON.parse(logs[0].new_data).is_active).toBe(0);
    expect(JSON.parse(logs[0].new_data).wage).toBe(900);
  });

  it("ücret değişimi denetim günlüğüne girer", () => {
    for (const sql of CREATE_TRIGGERS) db.exec(sql);
    db.prepare("UPDATE workers SET daily_wage = 1500 WHERE id = 1").run();

    const log = db
      .prepare(
        "SELECT action_type, old_data, new_data FROM audit_logs WHERE entity_table = 'workers'",
      )
      .get() as { action_type: string; old_data: string; new_data: string };
    expect(log.action_type).toBe("UPDATE");
    expect(JSON.parse(log.old_data).wage).toBe(900);
    expect(JSON.parse(log.new_data).wage).toBe(1500);
  });

  it("görünüm alanı değişimi denetim kaydı üretmez", () => {
    for (const sql of CREATE_TRIGGERS) db.exec(sql);
    db.prepare("UPDATE workers SET color = '#ff0000', short_label = 'A' WHERE id = 1").run();

    const count = db
      .prepare("SELECT COUNT(*) c FROM audit_logs WHERE entity_table = 'workers'")
      .get() as { c: number };
    expect(count.c).toBe(0);
  });
});

describe("attendanceRepository.upsertMany", () => {
  beforeEach(() => {
    insertWorkers([
      { id: 1, name: "Ali" },
      { id: 2, name: "Veli" },
    ]);
  });

  it("bir günün tüm puantajlarını tek işlemde yazar", async () => {
    const result = await attendanceRepository.upsertMany([
      { workerId: 1, date: "2026-06-20", status: "FULL" },
      { workerId: 2, date: "2026-06-20", status: "HALF" },
      { workerId: 1, date: "2026-06-21", status: null },
    ]);

    expect(result).toEqual({ written: 2, removed: 1 });
    expect(attendanceRows()).toEqual([
      { worker_id: 1, date: "2026-06-20", status: "FULL" },
      { worker_id: 2, date: "2026-06-20", status: "HALF" },
    ]);
  });

  it("geçersiz girdide hiçbir şey yazmaz (fail-closed)", async () => {
    await expect(
      attendanceRepository.upsertMany([
        { workerId: 1, date: "2026-06-20", status: "FULL" },
        { workerId: 1, date: "2026-06-20", status: "YOK" as never },
      ]),
    ).rejects.toThrow(/Geçersiz durum/);
    expect(attendanceRows()).toEqual([]);
  });

  it("geçersiz tarihte hiçbir şey yazmaz", async () => {
    await expect(
      attendanceRepository.upsertMany([{ workerId: 1, date: "20.06.2026", status: "FULL" }]),
    ).rejects.toThrow(/Geçersiz tarih/);
    expect(attendanceRows()).toEqual([]);
  });

  it("aynı worker+date için son değer geçerli olur", async () => {
    await attendanceRepository.upsertMany([
      { workerId: 1, date: "2026-06-20", status: "FULL" },
      { workerId: 1, date: "2026-06-20", status: "ABSENT" },
    ]);
    expect(attendanceRows()).toEqual([{ worker_id: 1, date: "2026-06-20", status: "ABSENT" }]);
  });

  it("remove tek kaydı siler, diğer günlere dokunmaz", async () => {
    await attendanceRepository.upsertMany([
      { workerId: 1, date: "2026-06-20", status: "FULL" },
      { workerId: 1, date: "2026-06-21", status: "FULL" },
    ]);
    await attendanceRepository.remove(1, "2026-06-20");

    expect(attendanceRows()).toEqual([{ worker_id: 1, date: "2026-06-21", status: "FULL" }]);
  });
});

describe("revert: attendance UPDATE (B1)", () => {
  beforeEach(() => {
    insertWorkers([{ id: 1, name: "Ali" }]);
    db.prepare(
      "INSERT INTO attendance (id, worker_id, date, status) VALUES (5,1,'2026-06-20','HALF')",
    ).run();
  });

  it("önceki puantajı geri yükler, kaydı silmez", async () => {
    const statements = await runRevert(
      makeLog({
        entity_table: "attendance",
        record_id: 5,
        old_data: JSON.stringify({ worker_id: 1, date: "2026-06-20", status: "FULL" }),
        new_data: JSON.stringify({ worker_id: 1, date: "2026-06-20", status: "HALF" }),
      }),
    );

    expect(statements.join("\n")).not.toMatch(/DELETE FROM attendance/);
    expect(attendanceRows()).toEqual([{ worker_id: 1, date: "2026-06-20", status: "FULL" }]);
  });

  it("puantaj kaydı silinmişse önceki değeri yeniden kurar", async () => {
    db.prepare("DELETE FROM attendance WHERE id = 5").run();

    await runRevert(
      makeLog({
        entity_table: "attendance",
        record_id: 5,
        old_data: JSON.stringify({ worker_id: 1, date: "2026-06-20", status: "FULL" }),
        new_data: JSON.stringify({ worker_id: 1, date: "2026-06-20", status: "HALF" }),
      }),
    );

    expect(attendanceRows()).toEqual([{ worker_id: 1, date: "2026-06-20", status: "FULL" }]);
  });
});

describe("revert: daily_metrics (B4)", () => {
  beforeEach(() => {
    insertWorkers([
      { id: 1, name: "W1" },
      { id: 2, name: "W2" },
      { id: 3, name: "W3" },
    ]);
    db.prepare("INSERT INTO daily_metrics (id, date) VALUES (7,'2026-06-20')").run();
  });

  it("UPDATE: yalnızca durumu değişen çalışanın puantajına dokunur", async () => {
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (1,'2026-06-20','FULL')",
    ).run();
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (2,'2026-06-20','ABSENT')",
    ).run();

    await runRevert(
      makeLog({
        entity_table: "daily_metrics",
        record_id: 7,
        old_data: JSON.stringify({
          date: "2026-06-20",
          production: "10",
          atts: [
            { id: 1, name: "W1", status: "FULL" },
            { id: 2, name: "W2", status: "FULL" },
            { id: 3, name: "W3", status: "YOK" },
          ],
        }),
        new_data: JSON.stringify({
          date: "2026-06-20",
          production: "12",
          atts: [
            { id: 1, name: "W1", status: "FULL" },
            { id: 2, name: "W2", status: "ABSENT" },
            { id: 3, name: "W3", status: "YOK" },
          ],
        }),
      }),
    );

    // W1 ve W3 bu işlemde değişmemişti: puantajlarına dokunulmamalı.
    expect(attendanceRows()).toEqual([
      { worker_id: 1, date: "2026-06-20", status: "FULL" },
      { worker_id: 2, date: "2026-06-20", status: "FULL" },
    ]);
  });

  it("UPDATE: bu işlemin oluşturduğu puantaj satırını siler", async () => {
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (1,'2026-06-20','FULL')",
    ).run();

    await runRevert(
      makeLog({
        entity_table: "daily_metrics",
        record_id: 7,
        old_data: JSON.stringify({
          date: "2026-06-20",
          production: "10",
          atts: [{ id: 1, name: "W1", status: "YOK" }],
        }),
        new_data: JSON.stringify({
          date: "2026-06-20",
          production: "12",
          atts: [{ id: 1, name: "W1", status: "FULL" }],
        }),
      }),
    );

    expect(attendanceRows()).toEqual([]);
  });

  it("UPDATE: sonradan ayrı işlemle değişen puantajı silmez", async () => {
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (1,'2026-06-20','ABSENT')",
    ).run();

    await runRevert(
      makeLog({
        entity_table: "daily_metrics",
        record_id: 7,
        old_data: JSON.stringify({
          date: "2026-06-20",
          production: "10",
          atts: [{ id: 1, name: "W1", status: "YOK" }],
        }),
        new_data: JSON.stringify({
          date: "2026-06-20",
          production: "12",
          atts: [{ id: 1, name: "W1", status: "FULL" }],
        }),
      }),
    );

    expect(attendanceRows()).toEqual([{ worker_id: 1, date: "2026-06-20", status: "ABSENT" }]);
  });

  it("INSERT: günün TÜM puantajını silmez", async () => {
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (1,'2026-06-20','FULL')",
    ).run();
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (2,'2026-06-21','FULL')",
    ).run();

    await runRevert(
      makeLog({
        action_type: "INSERT",
        entity_table: "daily_metrics",
        record_id: 7,
        new_data: JSON.stringify({
          date: "2026-06-20",
          production: "12",
          atts: [
            { id: 1, name: "W1", status: "FULL" },
            { id: 3, name: "W3", status: "YOK" },
          ],
        }),
      }),
    );

    expect(attendanceRows()).toEqual([{ worker_id: 2, date: "2026-06-21", status: "FULL" }]);
  });

  it("INSERT: anlık görüntü yoksa fail-closed — toplu silme yapmaz", async () => {
    db.prepare(
      "INSERT INTO attendance (worker_id, date, status) VALUES (1,'2026-06-20','FULL')",
    ).run();

    await expect(
      runRevert(
        makeLog({
          action_type: "INSERT",
          entity_table: "daily_metrics",
          record_id: 7,
          new_data: JSON.stringify({ date: "2026-06-20", production: "12" }),
        }),
      ),
    ).rejects.toThrow(/anlık görüntüsü yok/);
    expect(attendanceRows()).toHaveLength(1);
  });
});

describe("revert: workers ve ücret geçmişi (B2)", () => {
  beforeEach(() => {
    insertWorkers([{ id: 1, name: "Ali", wage: 1000 }]);
  });

  it("ücret UPDATE'i workers'ı VE worker_rate_history'yi geri alır", async () => {
    db.prepare(
      "INSERT INTO worker_rate_history (id, worker_id, valid_from, daily_wage, worker_type) VALUES (3,1,'2026-01-01',1500,'GUNLUK')",
    ).run();
    db.prepare(
      `INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
       VALUES ('UPDATE','worker_rate_history',3,?)`,
    ).run(JSON.stringify({ worker_id: 1, valid_from: "2026-01-01", wage: 1500, type: "GUNLUK" }));

    await runRevert(
      makeLog({
        entity_table: "workers",
        record_id: 1,
        old_data: JSON.stringify({ name: "Ali", type: "GUNLUK", wage: 1000, is_active: 1 }),
        new_data: JSON.stringify({ name: "Ali", type: "GUNLUK", wage: 1500, is_active: 1 }),
      }),
    );

    const worker = db.prepare("SELECT daily_wage FROM workers WHERE id = 1").get() as {
      daily_wage: number;
    };
    const rate = db.prepare("SELECT daily_wage FROM worker_rate_history WHERE id = 3").get() as {
      daily_wage: number;
    };
    expect(worker.daily_wage).toBe(1000);
    // Yalnız workers geri alınsa ekranda 1000, hesapta 1500 kalırdı.
    expect(rate.daily_wage).toBe(1000);
  });

  it("yeni eklenen ücret geçmişi satırını revert'te siler", async () => {
    db.prepare(
      "INSERT INTO worker_rate_history (id, worker_id, valid_from, daily_wage, worker_type) VALUES (4,1,'2026-07-01',1500,'GUNLUK')",
    ).run();
    db.prepare(
      `INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
       VALUES ('INSERT','worker_rate_history',4,?)`,
    ).run(JSON.stringify({ worker_id: 1, valid_from: "2026-07-01", wage: 1500, type: "GUNLUK" }));

    await runRevert(
      makeLog({
        entity_table: "workers",
        record_id: 1,
        old_data: JSON.stringify({ name: "Ali", type: "GUNLUK", wage: 1000, is_active: 1 }),
        new_data: JSON.stringify({ name: "Ali", type: "GUNLUK", wage: 1500, is_active: 1 }),
      }),
    );

    expect(db.prepare("SELECT COUNT(*) c FROM worker_rate_history").get()).toEqual({ c: 0 });
  });

  it("ücret değişmediyse ücret geçmişine dokunmaz", async () => {
    db.prepare(
      "INSERT INTO worker_rate_history (id, worker_id, valid_from, daily_wage, worker_type) VALUES (3,1,'2026-01-01',1000,'GUNLUK')",
    ).run();

    await runRevert(
      makeLog({
        entity_table: "workers",
        record_id: 1,
        old_data: JSON.stringify({ name: "Ali", type: "GUNLUK", wage: 1000, is_active: 1 }),
        new_data: JSON.stringify({ name: "Ahmet", type: "GUNLUK", wage: 1000, is_active: 1 }),
      }),
    );

    const worker = db.prepare("SELECT name FROM workers WHERE id = 1").get() as { name: string };
    // Geri alma YENİ değil ESKİ değeri yazar: isim "Ali"ye döner.
    expect(worker.name).toBe("Ali");
    const rate = db.prepare("SELECT daily_wage FROM worker_rate_history WHERE id = 3").get() as {
      daily_wage: number;
    };
    expect(rate.daily_wage).toBe(1000);
  });

  it("ücret geçmişi kaydı doğrudan geri alınabilir", async () => {
    db.prepare(
      "INSERT INTO worker_rate_history (id, worker_id, valid_from, daily_wage, worker_type) VALUES (3,1,'2026-01-01',1500,'GUNLUK')",
    ).run();

    await runRevert(
      makeLog({
        entity_table: "worker_rate_history",
        record_id: 3,
        old_data: JSON.stringify({
          worker_id: 1,
          valid_from: "2026-01-01",
          wage: 1000,
          type: "GUNLUK",
        }),
        new_data: JSON.stringify({
          worker_id: 1,
          valid_from: "2026-01-01",
          wage: 1500,
          type: "GUNLUK",
        }),
      }),
    );

    const rate = db.prepare("SELECT daily_wage FROM worker_rate_history WHERE id = 3").get() as {
      daily_wage: number;
    };
    expect(rate.daily_wage).toBe(1000);
  });

  it("silinen ücret geçmişi satırını geri kurar", async () => {
    await runRevert(
      makeLog({
        action_type: "DELETE",
        entity_table: "worker_rate_history",
        record_id: 3,
        old_data: JSON.stringify({
          worker_id: 1,
          worker_name: "Ali",
          valid_from: "2026-01-01",
          wage: 1200,
          type: "GUNLUK",
        }),
      }),
    );

    const rate = db
      .prepare("SELECT daily_wage, valid_from FROM worker_rate_history WHERE id = 3")
      .get() as { daily_wage: number; valid_from: string };
    expect(rate).toEqual({ daily_wage: 1200, valid_from: "2026-01-01" });
  });
});

describe("revert: sayısal doğrulama (B5)", () => {
  beforeEach(() => {
    insertWorkers([{ id: 1, name: "Ali", wage: 1000 }]);
  });

  it("bozuk yevmiye değerinde sessizce geçmez", async () => {
    await expect(
      runRevert(
        makeLog({
          entity_table: "workers",
          record_id: 1,
          old_data: JSON.stringify({ name: "Ali", type: "GUNLUK", wage: "abc", is_active: 1 }),
          new_data: JSON.stringify({ name: "Ali", type: "GUNLUK", wage: 1500, is_active: 1 }),
        }),
      ),
    ).rejects.toThrow(/geçersiz yevmiye/i);

    const worker = db.prepare("SELECT daily_wage FROM workers WHERE id = 1").get() as {
      daily_wage: number;
    };
    expect(worker.daily_wage).toBe(1000);
  });

  it("bozuk ödeme tutarında sessizce geçmez", async () => {
    db.prepare(
      "INSERT INTO payments (id, worker_id, amount, date) VALUES (4,1,500,'2026-06-15')",
    ).run();

    await expect(
      runRevert(
        makeLog({
          entity_table: "payments",
          record_id: 4,
          old_data: JSON.stringify({ worker_id: 1, amount: "NaN", date: "2026-06-15" }),
          new_data: JSON.stringify({ worker_id: 1, amount: 700, date: "2026-06-15" }),
        }),
      ),
    ).rejects.toThrow(/geçersiz/i);

    const payment = db.prepare("SELECT amount FROM payments WHERE id = 4").get() as {
      amount: number;
    };
    expect(payment.amount).toBe(500);
  });

  it("Infinity değerini de reddeder", async () => {
    db.prepare(
      "INSERT INTO payments (id, worker_id, amount, date) VALUES (4,1,700,'2026-06-15')",
    ).run();

    await expect(
      runRevert(
        makeLog({
          entity_table: "payments",
          record_id: 4,
          old_data: JSON.stringify({ worker_id: 1, amount: "Infinity", date: "2026-06-15" }),
          new_data: JSON.stringify({ worker_id: 1, amount: 800, date: "2026-06-15" }),
        }),
      ),
    ).rejects.toThrow(/geçersiz/i);
  });
});

describe("resolveAffectedDate (B7)", () => {
  it("attendance kaydında tarihi okur", () => {
    const ctx = createRevertContext(
      makeLog({ entity_table: "attendance", old_data: JSON.stringify({ date: "2026-06-20" }) }),
    );
    expect(resolveAffectedDate(ctx)).toBe("2026-06-20");
  });

  it("ücret geçmişi kaydında valid_from alanını okur", () => {
    const ctx = createRevertContext(
      makeLog({
        entity_table: "worker_rate_history",
        old_data: JSON.stringify({ valid_from: "2026-01-01" }),
      }),
    );
    expect(resolveAffectedDate(ctx)).toBe("2026-01-01");
  });

  it("workers kaydında tarih yoktur", () => {
    const ctx = createRevertContext(
      makeLog({
        entity_table: "workers",
        old_data: JSON.stringify({ name: "Ali", wage: "1000" }),
      }),
    );
    expect(resolveAffectedDate(ctx)).toBeNull();
  });

  it("bozuk old_data'da tarih çözülemez", () => {
    const ctx = createRevertContext(
      makeLog({ entity_table: "attendance", old_data: "{bozuk json" }),
    );
    expect(resolveAffectedDate(ctx)).toBeNull();
  });
});

describe("kayıt defteri", () => {
  it("her geri alınabilir tablo için üç işlem türünde de strateji var", () => {
    for (const table of [
      "attendance",
      "daily_metrics",
      "payments",
      "worker_rate_history",
      "workers",
    ]) {
      for (const action of ["INSERT", "UPDATE", "DELETE"]) {
        expect(getRevertStrategy(action, table), `${action}:${table}`).toBeDefined();
      }
    }
  });

  it("listede olmayan tablo geri alınamaz", () => {
    expect(getRevertStrategy("UPDATE", "closed_periods")).toBeUndefined();
    expect(getRevertStrategy("UPDATE", "sqlite_master")).toBeUndefined();
    expect(getRevertStrategy("REVERT", "workers")).toBeUndefined();
  });
});
