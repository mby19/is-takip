import { describe, it, expect, beforeEach, vi } from "vitest";
import type { DatabaseSync } from "node:sqlite";
import type { AuditLog } from "../types";
import { importDatabase, BACKUP_FORMAT_VERSION } from "../lib/backup";
import { getRevertStrategy, createRevertContext } from "../stores/revertStrategies";

/**
 * `worker_rate_history` id'si yedek→geri yükleme zinciri boyunca korunmalı.
 *
 * Neden: tablo `id INTEGER PRIMARY KEY AUTOINCREMENT` + `UNIQUE(worker_id,
 * valid_from)` tanımlıdır (`src-tauri/src/db.rs`, migration 11). Denetim
 * tetikleyicileri `audit_logs.record_id` alanına `NEW.id`/`OLD.id` yazar
 * (`src/schema/triggers.ts`) ve `revertStrategies` geri almayı bu id üzerinden
 * yapar. `backup.ts` id'yi yedeğe almazsa geri yüklemede id'ler yeniden
 * atanır, denetim kaydı başka bir satırı gösterir ve "Geri al" SESSİZCE
 * yanlış yere düşer — kullanıcı hata bile görmez.
 *
 * Bu test gerçek SQLite (`node:sqlite`) üzerinde tam zinciri çalıştırır:
 * yedek al → geri yükle → revert.
 */

const state = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("../lib/db", async () => {
  // `node:sqlite` yalnızca test ortamında vardır; fabrika içinde yüklenir.
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

vi.mock("../lib/tauri", async () => {
  const actual = await vi.importActual<typeof import("../lib/tauri")>("../lib/tauri");
  return {
    ...actual,
    isTauri: () => false,
    saveTextFileToDownloads: async () => "/tmp/test-guvenlik-yedegi.json",
  };
});

const db = state.db as DatabaseSync;

/** `importDatabase` tüm tabloları silip yeniden yazar ve tetikleyicileri kurar. */
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
  CREATE TABLE worker_rate_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    valid_from TEXT NOT NULL,
    daily_wage REAL NOT NULL,
    worker_type TEXT NOT NULL,
    created_at DATETIME DEFAULT (DATETIME('now','localtime')),
    UNIQUE(worker_id, valid_from),
    FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
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
  CREATE TABLE closed_periods (
    period TEXT PRIMARY KEY,
    closed_at DATETIME,
    note TEXT
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

interface RateRow {
  id: number;
  worker_id: number;
  daily_wage: number;
}

/** Gerçek `exportDatabase` çıktısıyla aynı biçimde yedek JSON'u üretir. */
const buildBackupJson = (): string => {
  const table = (name: string) => db.prepare(`SELECT * FROM ${name}`).all() as unknown[];
  return JSON.stringify({
    version: BACKUP_FORMAT_VERSION,
    app_version: "test",
    schema_version: 1,
    exported_at: "2026-03-01T09:00:00.000Z",
    workers: table("workers"),
    // `SELECT *` id'yi zaten içerir; `validateBackup` önceki sürümde onu
    // düşürüyordu.
    worker_rate_history: table("worker_rate_history"),
    attendance: table("attendance"),
    daily_metrics: table("daily_metrics"),
    payments: table("payments"),
    audit_logs: table("audit_logs"),
    closed_periods: table("closed_periods"),
  });
};

const rateAt = (id: number): RateRow | undefined =>
  db.prepare("SELECT id, worker_id, daily_wage FROM worker_rate_history WHERE id = ?").get(id) as
    | RateRow
    | undefined;

/** `revertStrategies`'in ürettiği SQL'i gerçek veritabanında çalıştırır. */
const revertRateUpdate = async (log: AuditLog): Promise<void> => {
  const strategy = getRevertStrategy("UPDATE", "worker_rate_history");
  if (!strategy) throw new Error("worker_rate_history UPDATE stratejisi yok");
  const statements = await strategy.execute(createRevertContext(log));
  const body = statements
    .map((s) => (s.trim().endsWith(";") ? s.trim() : `${s.trim()};`))
    .join("\n");
  db.exec(`BEGIN IMMEDIATE;\n${body}\nCOMMIT;`);
};

const WAGE_CHANGE_LOG: AuditLog = {
  id: 1,
  action_type: "UPDATE",
  entity_table: "worker_rate_history",
  record_id: 3,
  old_data: JSON.stringify({ worker_id: 1, valid_from: "2026-01-01", wage: 1000, type: "GUNLUK" }),
  new_data: JSON.stringify({ worker_id: 1, valid_from: "2026-01-01", wage: 1500, type: "GUNLUK" }),
  created_at: "2026-03-01 09:00:00",
  reverted_at: null,
};

beforeEach(() => {
  // `importDatabase` tabloları silip tetikleyicileri yeniden kurar; her test
  // temiz bir şema ile başlamalı.
  db.exec("PRAGMA foreign_keys = OFF;");
  for (const row of db.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all() as {
    name: string;
  }[]) {
    db.exec(`DROP TRIGGER IF EXISTS ${row.name}`);
  }
  for (const row of db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as { name: string }[]) {
    db.exec(`DROP TABLE IF EXISTS ${row.name}`);
  }
  db.exec(SCHEMA);
  db.exec(`INSERT INTO workers (id, name, daily_wage, worker_type) VALUES (1,'Ali',1500,'GUNLUK')`);
  db.exec(
    `INSERT INTO workers (id, name, daily_wage, worker_type) VALUES (2,'Veli',2000,'GUNLUK')`,
  );
  // id'ler bilerek 3 ve 4: AUTOINCREMENT yeniden atarsa 1 ve 2 ile çakışmaz
  // ama başka çalışanların satırlarına denk gelir — hata görünür olsun.
  db.exec(
    `INSERT INTO worker_rate_history (id, worker_id, valid_from, daily_wage, worker_type)
     VALUES (3, 1, '2026-01-01', 1500, 'GUNLUK')`,
  );
  db.exec(
    `INSERT INTO worker_rate_history (id, worker_id, valid_from, daily_wage, worker_type)
     VALUES (4, 2, '2026-01-01', 2500, 'GUNLUK')`,
  );
  // Ali'nin ücreti 1000 → 1500 değişmiş; denetim kaydı id=3'e bağlı.
  db.prepare(
    `INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
       VALUES ('UPDATE','worker_rate_history',3,?,?)`,
  ).run(
    JSON.stringify({ worker_id: 1, valid_from: "2026-01-01", wage: 1000, type: "GUNLUK" }),
    JSON.stringify({ worker_id: 1, valid_from: "2026-01-01", wage: 1500, type: "GUNLUK" }),
  );
});

describe("yedek → geri yükleme → ücret geçmişi revert'i", () => {
  it("geri yüklemeden sonra denetim kaydının gösterdiği satır aynı satırdır", async () => {
    await importDatabase(buildBackupJson());

    expect(rateAt(3)).toMatchObject({ worker_id: 1, daily_wage: 1500 });
    expect(rateAt(4)).toMatchObject({ worker_id: 2, daily_wage: 2500 });
  });

  it("revert, geri yüklemeden sonra GERÇEKTEN doğru satıra düşer", async () => {
    await importDatabase(buildBackupJson());

    await revertRateUpdate(WAGE_CHANGE_LOG);

    // Eski maaş geri yazıldı...
    expect(rateAt(3)?.daily_wage).toBe(1000);
    // ...ve DİĞER çalışanın ücret geçmişine dokunulmadı.
    expect(rateAt(4)?.daily_wage).toBe(2500);
  });

  it("ESKİ (id'siz) yedek geri yüklendiğinde revert sessizce hiçbir satıra düşmez", async () => {
    // v1-v3 biçiminde alınmış yedekte `worker_rate_history.id` yoktur. Bu
    // yedek geri yüklendiğinde id'ler yeniden atanır ve denetim kaydının
    // gösterdiği satır kaybolur. Revert'in buna karşı SESSİZ kalmaması için
    // (v4'te id korunduğu için normalde oluşmaz) en azından hiçbir maaşın
    // yanlış çalışana yazılmadığını doğrularız.
    const legacy = JSON.parse(buildBackupJson()) as {
      version: number;
      worker_rate_history: Record<string, unknown>[];
    };
    legacy.version = 3;
    legacy.worker_rate_history = legacy.worker_rate_history.map(({ id: _id, ...rest }) => rest);

    await importDatabase(JSON.stringify(legacy));

    // id'ler yeniden atandı: denetim kaydı artık var olmayan bir satırı gösterir.
    expect(rateAt(3)).toBeUndefined();
    expect(rateAt(1)?.daily_wage).toBe(1500);
    expect(rateAt(2)?.daily_wage).toBe(2500);

    await revertRateUpdate(WAGE_CHANGE_LOG);

    // Kullanıcı "Geri al" der, hata çıkmaz — ama hiçbir maaş değişmez.
    // Bu, eski yedeklerin kaçınılmaz sınırıdır; v4 yedeklerinde oluşmaz.
    expect(rateAt(1)?.daily_wage).toBe(1500);
    expect(rateAt(2)?.daily_wage).toBe(2500);
  });
});
