import { DROP_TRIGGERS } from "../schema/triggers";
import { buildTransactionScript } from "./sql";

/**
 * Şema kendini onarma katmanı.
 *
 * Rust migration'ları bazı cihazlarda uygulanmamış olabiliyor (yarıda kalan
 * bir migration sonrakilerin tamamını durdurur). Bunun belirtisi kullanıcıya
 * "no such table" gibi anlaşılmaz hatalar olarak yansıyordu.
 *
 * Buradaki kontroller açılışta çalışır, eksik olanı tamamlar ve her biri
 * yeniden çalıştırılabilir (idempotent). Tetikleyicilerin JS tarafından
 * yönetilmesiyle aynı gerekçe — bkz. ADR-0003.
 *
 * DİKKAT — tablo yeniden kurulumu hakkında:
 * SQLite'ta `ALTER TABLE ... RENAME TO`, veritabanındaki TÜM tetikleyicileri
 * yeniden ayrıştırır. `daily_metrics` tetikleyicileri `attendance` tablosuna
 * referans verdiği için, attendance düşürülmüşken yapılan bir yeniden
 * adlandırma "error in trigger ...: no such table" ile reddedilir ve tablo
 * ortada kalır. Bu yüzden yeniden kurulum ÖNCE tüm tetikleyicileri düşürür ve
 * TEK transaction içinde çalışır.
 */

interface Db {
  select: <T>(query: string, values?: unknown[]) => Promise<T[]>;
  execute: (query: string, values?: unknown[]) => Promise<{ rowsAffected: number }>;
}

export interface SchemaRepairReport {
  /** Uygulanan onarımların insan okunur adları. */
  repaired: string[];
  /** Onarılamayan sorunlar — kullanıcıya gösterilir. */
  failures: { step: string; message: string }[];
  /** Onarım sırasında tetikleyiciler düşürüldüyse yeniden kurulmaları gerekir. */
  triggersDropped: boolean;
}

/** Yeniden kurulum yarıda kalırsa verinin beklediği geçici tablo adları. */
const LEFTOVER_TABLES = ["attendance_fix", "attendance_new"];

const ATTENDANCE_COLUMNS = "(id, worker_id, date, status)";

const CREATE_ATTENDANCE_FIX = `
CREATE TABLE attendance_fix (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL,
  date TEXT NOT NULL,
  status TEXT CHECK( status IN ('FULL', 'HALF', 'ABSENT', 'HOLIDAY') ) NOT NULL,
  UNIQUE(worker_id, date),
  FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
)`;

const CREATE_ATTENDANCE_INDEX =
  "CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)";

const CREATE_WORKER_RATE_HISTORY = `
CREATE TABLE IF NOT EXISTS worker_rate_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  worker_id INTEGER NOT NULL,
  valid_from TEXT NOT NULL,
  daily_wage REAL NOT NULL,
  worker_type TEXT CHECK( worker_type IN ('ORTAK', 'GUNLUK') ) NOT NULL,
  created_at DATETIME DEFAULT (DATETIME('now', 'localtime')),
  UNIQUE(worker_id, valid_from),
  FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
)`;

const CREATE_CLOSED_PERIODS = `
CREATE TABLE IF NOT EXISTS closed_periods (
  period TEXT PRIMARY KEY,
  closed_at DATETIME DEFAULT (DATETIME('now', 'localtime')),
  note TEXT
)`;

const tableExists = async (db: Db, name: string): Promise<boolean> => {
  const rows = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return Number(rows[0]?.n ?? 0) > 0;
};

const columnExists = async (db: Db, table: string, column: string): Promise<boolean> => {
  const rows = await db.select<{ name: string }>(`PRAGMA table_info(${table})`);
  return rows.some((r) => r.name === column);
};

const tableSql = async (db: Db, name: string): Promise<string> => {
  const rows = await db.select<{ sql: string | null }>(
    "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?",
    [name],
  );
  return rows[0]?.sql ?? "";
};

const indexExists = async (db: Db, name: string): Promise<boolean> => {
  const rows = await db.select<{ n: number }>(
    "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = ?",
    [name],
  );
  return Number(rows[0]?.n ?? 0) > 0;
};

/**
 * Eksik şema parçalarını tamamlar. Her adım kendi başına güvenlidir; biri
 * başarısız olursa diğerleri denenmeye devam eder ve sonuç raporlanır.
 */
export async function repairSchema(db: Db): Promise<SchemaRepairReport> {
  const report: SchemaRepairReport = { repaired: [], failures: [], triggersDropped: false };

  const run = async (
    step: string,
    needed: () => Promise<boolean>,
    statements: string[],
    dropsTriggers = false,
  ) => {
    try {
      if (!(await needed())) return;
      // Tek transaction: yarıda kalıp tabloyu ortada bırakamaz.
      await db.execute(buildTransactionScript(statements));
      report.repaired.push(step);
      if (dropsTriggers) report.triggersDropped = true;
    } catch (err: unknown) {
      report.failures.push({ step, message: err instanceof Error ? err.message : String(err) });
    }
  };

  // 0) KURTARMA — her şeyden önce.
  // Önceki bir sürümde yeniden kurulum yarıda kaldıysa puantaj verisi geçici
  // tabloda bekliyordur; tablo kaybolmuş gibi görünür ama veri durur.
  for (const leftover of LEFTOVER_TABLES) {
    await run(
      "Yarıda kalmış puantaj tablosu kurtarıldı",
      async () => !(await tableExists(db, "attendance")) && (await tableExists(db, leftover)),
      [...DROP_TRIGGERS, `ALTER TABLE ${leftover} RENAME TO attendance`, CREATE_ATTENDANCE_INDEX],
      true,
    );
  }

  // Son çare: geçici tablo da yoksa puantaj tablosu boş olarak kurulur.
  // Veri kurtarılamaz ama uygulama açılabilir; rapor bunu açıkça söyler.
  await run(
    "Puantaj tablosu boş olarak yeniden oluşturuldu (önceki kayıtlar bulunamadı)",
    async () => !(await tableExists(db, "attendance")),
    [
      ...DROP_TRIGGERS,
      CREATE_ATTENDANCE_FIX,
      "ALTER TABLE attendance_fix RENAME TO attendance",
      CREATE_ATTENDANCE_INDEX,
    ],
    true,
  );

  await run("Ücret geçmişi tablosu", async () => !(await tableExists(db, "worker_rate_history")), [
    CREATE_WORKER_RATE_HISTORY,
    "CREATE INDEX IF NOT EXISTS idx_rate_history_worker ON worker_rate_history(worker_id, valid_from)",
    `INSERT OR IGNORE INTO worker_rate_history (worker_id, valid_from, daily_wage, worker_type)
       SELECT id, '2000-01-01', daily_wage, worker_type FROM workers`,
  ]);

  await run("Dönem kilidi tablosu", async () => !(await tableExists(db, "closed_periods")), [
    CREATE_CLOSED_PERIODS,
  ]);

  await run(
    "Geri alma işareti",
    async () => !(await columnExists(db, "audit_logs", "reverted_at")),
    ["ALTER TABLE audit_logs ADD COLUMN reverted_at DATETIME"],
  );

  await run("Çalışan rengi", async () => !(await columnExists(db, "workers", "color")), [
    "ALTER TABLE workers ADD COLUMN color TEXT",
  ]);

  await run(
    "Çalışan kısa etiketi",
    async () => !(await columnExists(db, "workers", "short_label")),
    ["ALTER TABLE workers ADD COLUMN short_label TEXT"],
  );

  // İzin (HOLIDAY) kısıtı: SQLite CHECK değiştirmeye izin vermez, tablo
  // yeniden kurulur. Tetikleyiciler ÖNCE düşürülür — yukarıdaki nota bakın.
  await run(
    "İzin durumu kısıtı",
    async () => {
      const sql = await tableSql(db, "attendance");
      return sql.length > 0 && !sql.includes("HOLIDAY");
    },
    [
      ...DROP_TRIGGERS,
      CREATE_ATTENDANCE_FIX,
      `INSERT INTO attendance_fix ${ATTENDANCE_COLUMNS} SELECT id, worker_id, date, status FROM attendance`,
      "DROP TABLE attendance",
      "ALTER TABLE attendance_fix RENAME TO attendance",
      CREATE_ATTENDANCE_INDEX,
    ],
    true,
  );

  await run(
    "Puantaj tarih indeksi",
    async () =>
      (await tableExists(db, "attendance")) && !(await indexExists(db, "idx_attendance_date")),
    [CREATE_ATTENDANCE_INDEX],
  );

  return report;
}
