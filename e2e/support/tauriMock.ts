import { test as base, type Page } from "@playwright/test";
import { DatabaseSync } from "node:sqlite";
import { migrationSql } from "./schema";
import { CREATE_TRIGGERS, DROP_TRIGGERS, TRIGGER_SCHEMA_VERSION } from "../../src/schema/triggers";

/**
 * Tarayıcıda çalışan uygulamaya Tauri'nin SQL eklentisini taklit eden bir
 * köprü takar.
 *
 * Uygulama gerçek SQLite'a ihtiyaç duyduğu için sorgular Node tarafındaki
 * `node:sqlite` üzerinde çalıştırılır — sahte bir SQL yorumlayıcısı yazmak
 * yerine gerçek motoru kullanmak, testlerin gerçekten anlamlı olmasını sağlar.
 */
export interface SqlBridgePayload {
  cmd: string;
  args: Record<string, unknown>;
}

function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  db.exec(migrationSql());

  // Üretimdeki sıranın aynısı (bkz. lib/db.ts ensureTriggers): migration'lar
  // v1–v9 arasında eski adlarla trigger kuruyor; `IF NOT EXISTS` bunları
  // eziyor olmadığı için önce düşürülmeleri gerekir.
  for (const sql of DROP_TRIGGERS) db.exec(sql);
  for (const sql of CREATE_TRIGGERS) db.exec(sql);
  db.exec(`PRAGMA user_version = ${TRIGGER_SCHEMA_VERSION}`);
  return db;
}

const normalize = (value: unknown): unknown => {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === undefined) return null;
  return value;
};

export async function installTauriMock(page: Page): Promise<DatabaseSync> {
  const db = createDatabase();

  await page.exposeFunction("__sqlBridge", (payload: SqlBridgePayload) => {
    const { cmd, args } = payload;
    const query = String(args.query ?? "");
    const values = ((args.values as unknown[]) ?? []).map(normalize);

    if (cmd === "plugin:sql|load") return String(args.db ?? "");
    if (cmd === "plugin:sql|close") return true;

    if (cmd === "plugin:sql|select") {
      return db
        .prepare(query)
        .all(...(values as never[]))
        .map((row) => ({ ...row }));
    }

    if (cmd === "plugin:sql|execute") {
      // Çok ifadeli transaction betikleri bağlama parametresi kullanmaz.
      if (values.length === 0 && /;[\s\S]*\S/.test(query.trim().replace(/;\s*$/, ""))) {
        db.exec(query);
        return [0, 0];
      }
      const result = db.prepare(query).run(...(values as never[]));
      return [Number(result.changes ?? 0), Number(result.lastInsertRowid ?? 0)];
    }

    throw new Error(`Taklit edilmeyen komut: ${cmd}`);
  });

  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.__TAURI_INTERNALS__ = {
      invoke: (cmd: string, args: Record<string, unknown>) =>
        (w.__sqlBridge as (p: unknown) => Promise<unknown>)({ cmd, args }),
      transformCallback: (cb: unknown) => cb,
      convertFileSrc: (p: string) => p,
    };
  });

  return db;
}

/**
 * Her testte temiz bir veritabanı kurulur.
 * `auto: true` şart: aksi halde fixture yalnızca `db` parametresini bildiren
 * testlerde çalışır ve diğerlerinde köprü hiç kurulmaz.
 */
export const test = base.extend<{ db: DatabaseSync }>({
  db: [
    async ({ page }, use) => {
      const db = await installTauriMock(page);
      await use(db);
      db.close();
    },
    { auto: true },
  ],
});

export { expect } from "@playwright/test";
