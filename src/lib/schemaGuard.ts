/**
 * Şema kendini onarma katmanı.
 *
 * Rust migration'ları bazı cihazlarda uygulanmamış olabiliyor (yarıda kalan
 * bir migration sonrakilerin tamamını durdurur; geliştirme kipinde yeni arayüz
 * eski bir ikili ile eşleşebilir). Bunun belirtisi kullanıcıya "no such table"
 * gibi anlaşılmaz hatalar olarak yansıyordu.
 *
 * Buradaki kontroller açılışta çalışır, eksik olanı tamamlar ve her biri
 * yeniden çalıştırılabilir (idempotent). Tetikleyicilerin JS tarafından
 * yönetilmesiyle aynı gerekçe — bkz. ADR-0003.
 *
 * NOT: Bu katman migration'ların yerine geçmez; yalnızca eksik kalmışsa
 * tamamlar. Yeni şema değişiklikleri yine `src-tauri/src/db.rs` içine yazılır
 * ve buraya da eklenir.
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
}

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

/**
 * attendance tablosunun CHECK kısıtına HOLIDAY ekler.
 * SQLite CHECK değiştirmeye izin vermediği için tablo yeniden kurulur.
 */
const REBUILD_ATTENDANCE = [
  `CREATE TABLE attendance_fix (
     id INTEGER PRIMARY KEY AUTOINCREMENT,
     worker_id INTEGER NOT NULL,
     date TEXT NOT NULL,
     status TEXT CHECK( status IN ('FULL', 'HALF', 'ABSENT', 'HOLIDAY') ) NOT NULL,
     UNIQUE(worker_id, date),
     FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
   )`,
  "INSERT INTO attendance_fix (id, worker_id, date, status) SELECT id, worker_id, date, status FROM attendance",
  "DROP TABLE attendance",
  "ALTER TABLE attendance_fix RENAME TO attendance",
  "CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)",
];

/**
 * Eksik şema parçalarını tamamlar. Her adım kendi başına güvenlidir; biri
 * başarısız olursa diğerleri denenmeye devam eder ve sonuç raporlanır.
 */
export async function repairSchema(db: Db): Promise<SchemaRepairReport> {
  const repaired: string[] = [];
  const failures: { step: string; message: string }[] = [];

  const run = async (step: string, needed: () => Promise<boolean>, statements: string[]) => {
    try {
      if (!(await needed())) return;
      for (const sql of statements) await db.execute(sql);
      repaired.push(step);
    } catch (err: unknown) {
      failures.push({ step, message: err instanceof Error ? err.message : String(err) });
    }
  };

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

  await run(
    "İzin durumu kısıtı",
    async () => {
      const sql = await tableSql(db, "attendance");
      return sql.length > 0 && !sql.includes("HOLIDAY");
    },
    REBUILD_ATTENDANCE,
  );

  await run(
    "Puantaj tarih indeksi",
    async () => {
      const rows = await db.select<{ n: number }>(
        "SELECT COUNT(*) AS n FROM sqlite_master WHERE type = 'index' AND name = 'idx_attendance_date'",
      );
      return Number(rows[0]?.n ?? 0) === 0;
    },
    ["CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date)"],
  );

  return { repaired, failures };
}
