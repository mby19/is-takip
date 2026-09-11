import Database from "@tauri-apps/plugin-sql";
import { DROP_TRIGGERS, CREATE_TRIGGERS, TRIGGER_SCHEMA_VERSION } from "../schema/triggers";
import { buildTransactionScript } from "./sql";
import { reportError } from "./errorMonitoring";

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
 * Denetim tetikleyicileri kurulamadıysa dolu olur. Ayarlar ekranı bu değeri
 * kullanıcıya gösterir — sessizce denetimsiz çalışmayı engellemek için.
 */
let triggerSetupError: string | null = null;
export const getTriggerSetupError = (): string | null => triggerSetupError;

/**
 * Tetikleyicileri yalnızca tanımlar değiştiğinde yeniden kurar.
 * Sürüm damgası `PRAGMA user_version` içinde tutulur.
 */
const ensureTriggers = async (d: DatabaseInstance): Promise<void> => {
  const rows = await d.select<{ user_version: number }>("PRAGMA user_version;");
  const installed = Number(rows?.[0]?.user_version ?? 0);

  if (installed === TRIGGER_SCHEMA_VERSION) return;

  const script = buildTransactionScript([
    ...DROP_TRIGGERS,
    ...CREATE_TRIGGERS,
    `PRAGMA user_version = ${TRIGGER_SCHEMA_VERSION}`,
  ]);

  await d.execute(script);
};

/**
 * SQLite veritabanı bağlantısını başlatır / döndürür.
 */
export const getDb = async (): Promise<DatabaseInstance> => {
  if (dbInstance) return dbInstance;

  if (!loadPromise) {
    loadPromise = (Database as unknown as { load: (path: string) => Promise<unknown> })
      .load("sqlite:is_takip_v3.db")
      .then(async (db: unknown): Promise<DatabaseInstance> => {
        const d = db as DatabaseInstance;

        try {
          await d.execute("PRAGMA journal_mode=WAL;");
        } catch {
          // WAL kritik değil, varsayılan journal modu ile devam edilir.
        }

        try {
          await ensureTriggers(d);
          triggerSetupError = null;
        } catch (err: unknown) {
          // Tetikleyici kurulumu başarısız oldu. Uygulama çalışmaya devam eder
          // ama denetim kaydı ve geri alma özelliği güvenilir değildir —
          // bu yüzden hata yutulmaz, saklanır ve Ayarlar ekranında gösterilir.
          triggerSetupError = err instanceof Error ? err.message : String(err);
          reportError(err instanceof Error ? err : new Error(triggerSetupError), {
            scope: "trigger-setup",
          });
        }

        dbInstance = d;
        return dbInstance;
      })
      .catch((err: unknown) => {
        loadPromise = null;
        throw err;
      });
  }

  return loadPromise;
};

/**
 * Veritabanında bir okuma (SELECT) sorgusu çalıştırır.
 */
export const fetchQuery = async <T>(query: string, values: unknown[] = []): Promise<T[]> => {
  const db = await getDb();
  return db.select<T>(query, values);
};

/**
 * Veritabanında bir yazma (INSERT, UPDATE, DELETE) sorgusu çalıştırır.
 */
export const executeQuery = async (query: string, values: unknown[] = []): Promise<DbResult> => {
  const db = await getDb();
  return db.execute(query, values);
};

/**
 * Birden çok ifadeyi tek bir transaction içinde, tek bir bağlantıda çalıştırır.
 * Ya hepsi uygulanır ya hiçbiri.
 *
 * Bağlama parametresi kullanılamaz — değerler `sqlLiteral` ile gömülmelidir.
 */
export const executeTransaction = async (statements: string[]): Promise<void> => {
  if (statements.length === 0) return;
  const db = await getDb();

  try {
    await db.execute(buildTransactionScript(statements));
  } catch (err) {
    // Hata anında açık kalmış olabilecek transaction'ı kapat (best-effort).
    try {
      await db.execute("ROLLBACK;");
    } catch {
      // Aktif transaction yoksa SQLite hata verir; bu beklenen bir durum.
    }
    throw err;
  }
};
