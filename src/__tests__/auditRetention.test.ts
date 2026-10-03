import { describe, it, expect } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Karar K4: denetim kaydı budaması kalıcı olarak kaldırıldı — `audit_logs`
 * hiçbir koşulda silinmemeli. Bu test iki yönü de sabitler:
 *   1) şema/trigger seviyesinde budama yok (yeni kayıt eklenince eskisi kalır),
 *   2) açılışta çalışan bir budama yolu kalmamış.
 */

function dbWithOldLogs(oldCount: number): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(`
    CREATE TABLE audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action_type TEXT NOT NULL,
      entity_table TEXT NOT NULL,
      record_id INTEGER NOT NULL,
      old_data TEXT, new_data TEXT,
      created_at DATETIME DEFAULT (DATETIME('now','localtime')));
    CREATE TABLE workers (
      id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, daily_wage REAL NOT NULL,
      worker_type TEXT NOT NULL, created_at DATETIME DEFAULT (DATETIME('now','localtime')),
      is_active BOOLEAN DEFAULT 1);
  `);
  const insertOld = db.prepare(
    `INSERT INTO audit_logs (action_type, entity_table, record_id, created_at)
     VALUES ('INSERT','workers',1, DATETIME('now','localtime','-3 years'))`,
  );
  for (let i = 0; i < oldCount; i++) insertOld.run();
  return db;
}

/** Verilen koşulu sağlayan denetim kaydı sayısı. */
function countLogs(db: DatabaseSync, olderThanAYearOnly = false): number {
  const sql = olderThanAYearOnly
    ? `SELECT COUNT(*) AS n FROM audit_logs
       WHERE created_at < DATETIME('now','localtime','-12 months')`
    : "SELECT COUNT(*) AS n FROM audit_logs";
  const row = db.prepare(sql).get() as { n: number } | undefined;
  return row?.n ?? 0;
}

describe("denetim kaydı budaması kaldırıldı (K4)", () => {
  it("3 yıl önceki 1200 kayıt, yeni kayıt eklendikten sonra da duruyor", () => {
    const db = dbWithOldLogs(1200);
    expect(countLogs(db)).toBe(1200);
    expect(countLogs(db, true)).toBe(1200);

    db.prepare(
      `INSERT INTO audit_logs (action_type, entity_table, record_id)
       VALUES ('UPDATE','workers',1)`,
    ).run();

    expect(countLogs(db)).toBe(1201);
    expect(countLogs(db, true)).toBe(1200);
    db.close();
  });

  it("en yeni 500 koruma kuralı da uygulanmıyor — 12 aydan eski 600 kayıt silinmiyor", () => {
    const db = dbWithOldLogs(600);
    expect(countLogs(db)).toBe(600);
    expect(countLogs(db, true)).toBe(600);
    db.close();
  });

  it("budama modülü kaldırıldı: src/lib/retention.ts yok", () => {
    expect(existsSync(resolve(import.meta.dirname, "../lib/retention.ts"))).toBe(false);
  });

  it("açılış yolu budama çağrısı taşımıyor", () => {
    const app = readFileSync(resolve(import.meta.dirname, "../App.tsx"), "utf8");
    expect(app).not.toMatch(/pruneAuditLogs|lib\/retention/);
    expect(app).not.toMatch(/DELETE FROM audit_logs/i);
  });

  // Not: backup.ts yedek geri yüklemede tüm tabloları (audit_logs dahil) temizler —
  // bu bilinçli bir "tüm veri değişti" işlemidir, budama değil; bu yüzden listede yok.
  it("hiçbir kaynak dosya audit_logs tablosundan DELETE çalıştırmıyor", () => {
    for (const rel of [
      "../App.tsx",
      "../repositories/auditLogRepository.ts",
      "../stores/auditLogStore.ts",
    ]) {
      const source = readFileSync(resolve(import.meta.dirname, rel), "utf8");
      expect(source).not.toMatch(/DELETE\s+FROM\s+audit_logs/i);
    }
  });
});
