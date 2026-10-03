import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRIGGER_SCHEMA_VERSION } from "../schema/triggers";

const reportError = vi.fn();

vi.mock("../lib/errorMonitoring", () => ({
  reportError: (...a: unknown[]) => reportError(...a),
}));

vi.mock("../lib/schemaGuard", () => ({
  repairSchema: async () => ({ repaired: [], failures: [], triggersDropped: false }),
}));

/** SQLite davranışının taklit edildiği tek "bağlantı" — bu testin dünya modeli. */
interface FakeDb {
  execute: (script: string) => Promise<{ rowsAffected: number }>;
  select: (query: string) => Promise<unknown[]>;
  close: () => Promise<boolean>;
  /** Bu bağlantıda açık transaction var mı? */
  isOpen: () => boolean;
  calls: string[];
  closed: boolean;
}

interface Harness {
  /** Transaction gövdesindeki bu ifade hata verir. */
  failOn?: (statement: string) => string | null;
  walFails?: boolean;
}

let harness: Harness = {};
let db = createFakeDb();

function createFakeDb(): FakeDb {
  const calls: string[] = [];
  let open = false;

  const runStatement = (statement: string): void => {
    const upper = statement.toUpperCase();

    if (upper.startsWith("PRAGMA JOURNAL_MODE")) {
      if (harness.walFails) throw new Error("disk I/O error");
      return;
    }
    if (upper.startsWith("BEGIN")) {
      if (open) throw new Error("cannot start a transaction within a transaction");
      open = true;
      return;
    }
    if (upper.startsWith("COMMIT")) {
      if (!open) throw new Error("cannot commit - no transaction is active");
      open = false;
      return;
    }

    const failure = harness.failOn?.(statement) ?? null;
    if (failure) throw new Error(failure);
  };

  const fake: FakeDb = {
    calls,
    closed: false,
    isOpen: () => open,
    execute: async (script) => {
      calls.push(script);
      if (fake.closed) throw new Error("pool is closed");
      // Gerçek davranış: betik ilk hatalı ifadede durur, sonrakiler çalışmaz.
      for (const statement of script
        .split(/;\s*\n|;\s*$/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        runStatement(statement);
      }
      return { rowsAffected: 1 };
    },
    select: async (query) => {
      calls.push(query);
      return /user_version/.test(query) ? [{ user_version: TRIGGER_SCHEMA_VERSION }] : [];
    },
    close: async () => {
      fake.closed = true;
      open = false;
      return true;
    },
  };

  return fake;
}

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    // Gerçekte havuz atıldıktan sonra `load` YENİ ve temiz bir havuz açar.
    load: async () => {
      if (db.closed) db = createFakeDb();
      return db;
    },
  },
}));

/** db.ts tekil durum tutar; her test için modül sıfırdan yüklenir. */
const freshDb = async () => {
  vi.resetModules();
  return import("../lib/db");
};

const FAILING_INSERT = "INSERT INTO payments (id) VALUES (2)";

beforeEach(() => {
  harness = {};
  db = createFakeDb();
  reportError.mockReset();
});

describe("executeTransaction hata temizliği", () => {
  it("başarılı transaction'da ek komut çalıştırmaz", async () => {
    const { executeTransaction, getDb } = await freshDb();
    await getDb();
    db.calls.length = 0;

    await executeTransaction(["DELETE FROM payments WHERE id = 1"]);

    expect(db.calls).toHaveLength(1);
    expect(db.calls[0]).toContain("BEGIN IMMEDIATE;");
    expect(db.calls[0]).toContain("COMMIT;");
    expect(db.isOpen()).toBe(false);
  });

  it("hatalı ifadede havuzu atar: kirli bağlantı havuzda kalmaz", async () => {
    harness.failOn = (s) =>
      s.includes("INSERT INTO payments") ? "UNIQUE constraint failed" : null;
    const { executeTransaction, getDb } = await freshDb();
    await getDb();
    const stale = db;
    db.calls.length = 0;

    await expect(
      executeTransaction(["DELETE FROM payments WHERE id = 1", FAILING_INSERT]),
    ).rejects.toThrow("UNIQUE constraint failed");

    // Artık ayrı `ROLLBACK`/`BEGIN IMMEDIATE` probu YOK: her `execute` çağrısı
    // havuzdan ayrı bir bağlantı kiralar ve kirli olan hangisi olduğu
    // bilinmez. Tek güvenli yol havuzu atmaktır.
    expect(stale.calls.map((c) => c.trim())).toEqual([expect.stringContaining(FAILING_INSERT)]);
    expect(stale.closed).toBe(true);
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("bağlantı havuzu yenileniyor") }),
      { scope: "transaction-cleanup" },
    );
  });

  it("havuz atıldıktan sonra sonraki işlem temiz havuzda çalışır", async () => {
    harness.failOn = (s) =>
      s.includes("INSERT INTO payments") ? "UNIQUE constraint failed" : null;
    const { executeQuery, executeTransaction, getDb } = await freshDb();
    await getDb();
    const stale = db;

    await expect(executeTransaction([FAILING_INSERT])).rejects.toThrow();

    // `getDb()` `serialize`'dan ÖNCE çağrılırsa bu yazma kapalı havuza düşer
    // ve kullanıcının verisi kaybolur.
    await expect(executeQuery("DELETE FROM payments WHERE id = 1")).resolves.toEqual({
      rowsAffected: 1,
    });
    expect(stale.closed).toBe(true);
  });

  it("eşzamanlı okuma, transaction ile temizliğin arasına girmez", async () => {
    harness.failOn = (s) =>
      s.includes("INSERT INTO payments") ? "UNIQUE constraint failed" : null;
    const { executeTransaction, fetchQuery, getDb } = await freshDb();
    await getDb();
    const stale = db;
    db.calls.length = 0;

    await Promise.allSettled([
      executeTransaction([FAILING_INSERT]),
      fetchQuery("SELECT COUNT(*) AS n FROM payments"),
    ]);

    // Okuma, transaction'ın başarısız olduğu ESKİ havuza değil, temiz havuza
    // düşer. (Kapı, transaction bitene kadar okumayı bekletir.)
    expect(stale.calls.map((c) => c.trim())).toEqual([expect.stringContaining(FAILING_INSERT)]);
    expect(db.calls.map((c) => c.trim())).toContain("SELECT COUNT(*) AS n FROM payments");
  });
});

describe("WAL modu açılışı", () => {
  it("WAL hatasını yutmaz: loglar ve uyarı olarak saklar", async () => {
    harness.walFails = true;
    const { getDb, getJournalModeWarning } = await freshDb();

    await getDb();

    expect(getJournalModeWarning()).toContain("disk I/O error");
    expect(reportError).toHaveBeenCalledWith(expect.any(Error), { scope: "journal-mode" });
  });

  it("WAL açıldığında uyarı boş kalır", async () => {
    const { getDb, getJournalModeWarning } = await freshDb();

    await getDb();

    expect(getJournalModeWarning()).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });
});
