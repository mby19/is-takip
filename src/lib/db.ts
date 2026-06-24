import Database from "@tauri-apps/plugin-sql";
import {
  DROP_TRIGGERS,
  CREATE_WORKERS_INSERT_LOG,
  CREATE_WORKERS_UPDATE_LOG,
  CREATE_WORKERS_DELETE_LOG,
  CREATE_ATTENDANCE_INSERT_LOG,
  CREATE_ATTENDANCE_UPDATE_LOG,
  CREATE_ATTENDANCE_DELETE_LOG,
  CREATE_DAILY_METRICS_INSERT_LOG,
  CREATE_DAILY_METRICS_UPDATE_LOG,
  CREATE_DAILY_METRICS_DELETE_LOG,
  CREATE_PAYMENTS_INSERT_LOG,
  CREATE_PAYMENTS_UPDATE_LOG,
  CREATE_PAYMENTS_DELETE_LOG,
} from "../schema/triggers";

interface DbResult {
  rowsAffected: number;
}

interface DatabaseInstance {
  select: <T>(query: string, values?: unknown[]) => Promise<T[]>;
  execute: (query: string, values?: unknown[]) => Promise<DbResult>;
}

let dbInstance: DatabaseInstance | null = null;
let loadPromise: Promise<DatabaseInstance> | null = null;

/**
 * SQLite veritabanı bağlantısını başlatır / döndürür
 */
export const getDb = async (): Promise<DatabaseInstance> => {
  if (dbInstance) return dbInstance;

  if (!loadPromise) {
    console.log("Loading is_takip.db...");
    loadPromise = (Database as unknown as { load: (path: string) => Promise<unknown> })
      .load("sqlite:is_takip_v3.db")
      .then(async (db: unknown): Promise<DatabaseInstance> => {
        const d = db as DatabaseInstance;
        console.log("Database loaded successfully");
        // WAL moduna geç (Performans için)
        try {
          await d.execute("PRAGMA journal_mode=WAL;");
          console.log("WAL mode enabled");
        } catch (e) {
          console.error("WAL mode error:", e);
        }

        // Dinamik tetikleyici entegrasyonu (Dual-Safety)
        try {
          for (const sql of DROP_TRIGGERS) {
            await d.execute(sql);
          }

          await d.execute(CREATE_WORKERS_INSERT_LOG);
          await d.execute(CREATE_WORKERS_UPDATE_LOG);
          await d.execute(CREATE_WORKERS_DELETE_LOG);
          await d.execute(CREATE_ATTENDANCE_INSERT_LOG);
          await d.execute(CREATE_ATTENDANCE_UPDATE_LOG);
          await d.execute(CREATE_ATTENDANCE_DELETE_LOG);
          await d.execute(CREATE_DAILY_METRICS_INSERT_LOG);
          await d.execute(CREATE_DAILY_METRICS_UPDATE_LOG);
          await d.execute(CREATE_DAILY_METRICS_DELETE_LOG);
          await d.execute(CREATE_PAYMENTS_INSERT_LOG);
          await d.execute(CREATE_PAYMENTS_UPDATE_LOG);
          await d.execute(CREATE_PAYMENTS_DELETE_LOG);
          console.log("Tüm denetim tetikleyicileri dinamik olarak doğrulandı");
        } catch (err) {
          console.error("Dinamik tetikleyici doğrulama hatası:", err);
        }

        dbInstance = d;
        return dbInstance;
      })
      .catch((err: unknown) => {
        console.error("Database load error:", err);
        alert("Veritabanı yükleme hatası: " + err);
        throw err;
      });
  }

  return loadPromise!;
};

/**
 * Veritabanında bir okuma (SELECT) sorgusu çalıştırır
 * @param query Çalıştırılacak SQL sorgusu
 * @param values Sorguya bağlanacak parametre dizisi
 */
export const fetchQuery = async <T>(query: string, values: unknown[] = []): Promise<T[]> => {
  const db = await getDb();
  return db.select<T>(query, values);
};

/**
 * Veritabanında bir yazma (INSERT, UPDATE, DELETE) sorgusu çalıştırır
 * @param query Çalıştırılacak SQL sorgusu
 * @param values Sorguya bağlanacak parametre dizisi
 */
export const executeQuery = async (query: string, values: unknown[] = []): Promise<DbResult> => {
  const db = await getDb();
  return db.execute(query, values);
};
