import { describe, it, expect, beforeEach } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { repairSchema } from "../lib/schemaGuard";
import { CREATE_TRIGGERS } from "../schema/triggers";

/** node:sqlite üzerinde gerçek SQLite ile çalışan bir Db adaptörü. */
const adapt = (db: DatabaseSync) => ({
  select: async <T>(query: string, values: unknown[] = []) =>
    db.prepare(query).all(...(values as never[])) as T[],
  execute: async (query: string, values: unknown[] = []) => {
    if (values.length === 0) {
      db.exec(query);
      return { rowsAffected: 0 };
    }
    const r = db.prepare(query).run(...(values as never[]));
    return { rowsAffected: Number(r.changes ?? 0) };
  },
});

/**
 * Migration 14 öncesi bir veritabanı: 'HOLIDAY' durumu ve buna ait kayıt var,
 * yeni tablolar yok. Onarımın bu halini dönüştürmesi gerekiyor.
 */
function legacyDb(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, daily_wage REAL NOT NULL,
      worker_type TEXT CHECK( worker_type IN ('ORTAK','GUNLUK') ) NOT NULL,
      created_at DATETIME DEFAULT (DATETIME('now','localtime')), is_active BOOLEAN DEFAULT 1);
    CREATE TABLE attendance (
      id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id INTEGER NOT NULL, date TEXT NOT NULL,
      status TEXT CHECK( status IN ('FULL','HALF','ABSENT','HOLIDAY') ) NOT NULL,
      UNIQUE(worker_id,date), FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE);
    CREATE TABLE daily_metrics (
      id INTEGER PRIMARY KEY AUTOINCREMENT, date TEXT UNIQUE NOT NULL,
      production_amount INTEGER DEFAULT 0, total_earned REAL DEFAULT 0, extra_expenses REAL DEFAULT 0,
      is_holiday INTEGER DEFAULT 0);
    CREATE TABLE payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id INTEGER NOT NULL, amount REAL NOT NULL,
      date TEXT NOT NULL, description TEXT);
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT, action_type TEXT NOT NULL, entity_table TEXT NOT NULL,
      record_id INTEGER NOT NULL, old_data TEXT, new_data TEXT,
      created_at DATETIME DEFAULT (DATETIME('now','localtime')));
    CREATE TABLE worker_rate_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id INTEGER NOT NULL,
      valid_from TEXT NOT NULL, daily_wage REAL NOT NULL, worker_type TEXT NOT NULL,
      FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE);
    INSERT INTO workers (name, daily_wage, worker_type) VALUES ('Ahmet Yılmaz', 900, 'GUNLUK');
    INSERT INTO attendance (worker_id, date, status)
      VALUES (1,'2026-09-01','FULL'), (1,'2026-09-02','HALF'), (1,'2026-09-03','ABSENT'),
             (1,'2026-09-04','HOLIDAY');
  `);
  // Üretimdeki gibi tetikleyiciler kurulu: daily_metrics olanları attendance'a bakar.
  for (const sql of CREATE_TRIGGERS) db.exec(sql);
  return db;
}

let db: DatabaseSync;
beforeEach(() => {
  db = legacyDb();
});

const tables = () =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[]).map(
    (r) => r.name,
  );
const attendanceCount = () =>
  Number((db.prepare("SELECT COUNT(*) c FROM attendance").get() as { c: number }).c);

const statusOf = (date: string) =>
  (db.prepare("SELECT status FROM attendance WHERE date = ?").get(date) as { status: string })
    .status;

const attendanceTableSql = () =>
  (
    db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='attendance'").get() as {
      sql: string;
    }
  ).sql;

describe("repairSchema", () => {
  it("eksik tabloları ve sütunları tamamlar", async () => {
    const report = await repairSchema(adapt(db));
    expect(report.failures).toEqual([]);
    expect(tables()).toEqual(expect.arrayContaining(["worker_rate_history", "closed_periods"]));

    const workerCols = (db.prepare("PRAGMA table_info(workers)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(workerCols).toEqual(expect.arrayContaining(["color", "short_label"]));

    const auditCols = (db.prepare("PRAGMA table_info(audit_logs)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(auditCols).toContain("reverted_at");
  });

  it("KRİTİK: attendance yeniden kurulurken tabloyu ve veriyi kaybetmez", async () => {
    const report = await repairSchema(adapt(db));

    expect(report.failures).toEqual([]);
    expect(tables()).toContain("attendance");
    expect(tables()).not.toContain("attendance_fix");
    expect(attendanceCount()).toBe(4);

    // Artık 'HOLIDAY' yazılamamalı — CHECK kısıtı onu reddetmeli.
    expect(() =>
      db.exec("INSERT INTO attendance (worker_id, date, status) VALUES (1,'2026-09-05','HOLIDAY')"),
    ).toThrow();
  });

  it("tetikleyicilerin düşürüldüğünü bildirir", async () => {
    const report = await repairSchema(adapt(db));
    expect(report.triggersDropped).toBe(true);
    // Çağıran taraf bunları yeniden kurar; onarım sonrası kurulu olmamaları normal.
    const triggers = db.prepare("SELECT name FROM sqlite_master WHERE type='trigger'").all() as {
      name: string;
    }[];
    expect(triggers).toHaveLength(0);
  });

  it("yarıda kalmış yeniden kurulumdan veriyi kurtarır", async () => {
    // Eski sürümün bıraktığı durumu birebir kur: attendance yok, veri geçici tabloda.
    db.exec(`
      CREATE TABLE attendance_fix (
        id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id INTEGER NOT NULL, date TEXT NOT NULL,
        status TEXT CHECK( status IN ('FULL','HALF','ABSENT','HOLIDAY') ) NOT NULL,
        UNIQUE(worker_id,date));
      INSERT INTO attendance_fix (id,worker_id,date,status)
        SELECT id,worker_id,date,status FROM attendance;
      DROP TABLE attendance;
    `);
    expect(tables()).not.toContain("attendance");

    const report = await repairSchema(adapt(db));

    expect(report.repaired).toContain("Yarıda kalmış puantaj tablosu kurtarıldı");
    expect(report.failures).toEqual([]);
    expect(tables()).toContain("attendance");
    expect(attendanceCount()).toBe(4);
  });

  it("migration 10'dan kalan attendance_new'i de kurtarır", async () => {
    db.exec(`
      CREATE TABLE attendance_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT, worker_id INTEGER NOT NULL, date TEXT NOT NULL,
        status TEXT CHECK( status IN ('FULL','HALF','ABSENT','HOLIDAY') ) NOT NULL,
        UNIQUE(worker_id,date));
      INSERT INTO attendance_new (id,worker_id,date,status)
        SELECT id,worker_id,date,status FROM attendance;
      DROP TABLE attendance;
    `);
    const report = await repairSchema(adapt(db));
    expect(report.failures).toEqual([]);
    expect(attendanceCount()).toBe(4);
  });

  it("'HOLIDAY' kayıtlarını 'ABSENT' yapar ve constraint'i HOLIDAY'sız kurar", async () => {
    // legacyDb() migration 14 öncesi şemayı kurar ve bir HOLIDAY kaydı bırakır.
    expect(statusOf("2026-09-04")).toBe("HOLIDAY");
    expect(attendanceTableSql()).toContain("HOLIDAY");

    const report = await repairSchema(adapt(db));

    expect(report.failures).toEqual([]);
    expect(statusOf("2026-09-04")).toBe("ABSENT");
    expect(attendanceTableSql()).not.toContain("HOLIDAY");
    // Diğer kayıtlar korunur — dönüşüm yalnız HOLIDAY olan satırlara dokunur.
    expect(attendanceCount()).toBe(4);
    expect(statusOf("2026-09-01")).toBe("FULL");
    expect(statusOf("2026-09-02")).toBe("HALF");
  });

  it("son çare: veri hiç bulunamazsa tabloyu boş kurar ve bunu söyler", async () => {
    db.exec("DROP TABLE attendance");
    const report = await repairSchema(adapt(db));

    expect(report.failures).toEqual([]);
    expect(tables()).toContain("attendance");
    expect(attendanceCount()).toBe(0);
    expect(report.repaired.join(" ")).toContain("önceki kayıtlar bulunamadı");
  });

  it("ikinci çalıştırmada hiçbir şey yapmaz", async () => {
    await repairSchema(adapt(db));
    for (const sql of CREATE_TRIGGERS) db.exec(sql);

    const second = await repairSchema(adapt(db));
    expect(second.repaired).toEqual([]);
    expect(second.failures).toEqual([]);
    expect(second.triggersDropped).toBe(false);
  });

  it("güncel şemaya dokunmaz", async () => {
    await repairSchema(adapt(db));
    const before = attendanceCount();
    const report = await repairSchema(adapt(db));
    expect(report.repaired).toEqual([]);
    expect(attendanceCount()).toBe(before);
  });
});
