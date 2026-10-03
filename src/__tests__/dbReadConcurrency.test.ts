import { describe, it, expect, vi, beforeEach } from "vitest";
import { TRIGGER_SCHEMA_VERSION } from "../schema/triggers";

vi.mock("../lib/errorMonitoring", () => ({ reportError: vi.fn() }));
vi.mock("../lib/schemaGuard", () => ({
  repairSchema: async () => ({ repaired: [], failures: [], triggersDropped: false }),
}));

/** Bir bağlantının SQLite'taki durumu: açık transaction + commit edilmemiş satırlar. */
interface FakeConn {
  id: number;
  idle: boolean;
  /** Bu bağlantıda `BEGIN` çalıştı ve `COMMIT`/`ROLLBACK` henüz çalışmadı. */
  open: boolean;
  /** Transaction içinde yazıldı, henüz kalıcılaşmadı. */
  pending: string[];
}

/**
 * sqlx havuzunun taklidi.
 *
 * Dört davranışı modeller:
 * 1. **FIFO** bağlantı havuzu: boşaltılan bağlantı kuyruğun **sonuna**,
 *    kiralanan bağlantı **başından** alınır. Bu production'daki
 *    `crossbeam_queue::ArrayQueue` davranışıdır (sqlx 0.8.6) ve LIFO'nun
 *    **tam tersidir** — `FakePool` FIFO'yu modellemezse, "kirli bağlantı
 *    temizlikten sonra havuzda kalır" hatası görünmez.
 * 2. Bağlantı boşaltıldığında havuza döner; **kirli olarak** dönebilir.
 * 3. Boş bağlantı yoksa yeni çağrı beklemek zorundadır (havuz tükenmez).
 * 4. SELECT, transaction'ı açık olan bağlantıda **o transaction'ın commit
 *    edilmemiş satırlarını da** görür — hata vermez, yanlış veri döner.
 */
class FakePool {
  readonly committed = new Set<string>();
  private readonly conns: FakeConn[] = [];
  private readonly releaseWaiters: Array<() => void> = [];
  /**
   * Kapatılan havuz: gerçekte `db.close()` boş bağlantıları kapatır ve
   * sonraki `Database.load()` YENİ bir havuz döndürür. Bu bayrak, kapalı
   * havuzun kullanılmaya devam etmesini engeller.
   */
  closed = false;

  /** Çağrı sırası — hangi SQL hangi bağlantıda çalıştı, hangi bağlantı kirliydi. */
  readonly log: string[] = [];

  /** Aynı anda havuzda bulunan SELECT sayısının tepe değeri. */
  peakSelects = 0;
  private inFlightSelects = 0;
  /** Şu ana kadar başlamış SELECT sayısı; `getDb()`'nin kendi probu bunu sayar. */
  selectStarted = 0;
  private selectStartedWaiters: Array<() => void> = [];

  /** Kapalıyken `select` çağrıları burada bekler — eşzamanlılığı ölçmek için. */
  readGate: Promise<void> | null = null;
  /** Kapalıyken `execute` çağrıları burada bekler. */
  executeGate: Promise<void> | null = null;

  constructor(
    readonly size: number,
    readonly failOn: (statement: string) => string | null = () => null,
  ) {
    for (let i = 0; i < size; i += 1) {
      this.conns.push({ id: i, idle: true, open: false, pending: [] });
    }
  }

  /**
   * FIFO kiralama: kuyruğun BAŞINDAN boş bağlantı alınır.
   *
   * `conns` kuyruk sırasını kendisi tutar (indeks 0 = en eski boş bağlantı).
   * `release` bağlantıyı sona taşır.
   */
  private async acquire(): Promise<FakeConn> {
    // FIFO: en uzun süredir boşta olan bağlantı önce verilir.
    const conn = this.conns.find((c) => c.idle);
    if (conn) {
      conn.idle = false;
      return conn;
    }
    // Havuz tükendi: bir bağlantı boşalana kadar bekle.
    const waiter = Promise.withResolvers<void>();
    this.releaseWaiters.push(waiter.resolve);
    await waiter.promise;
    return this.acquire();
  }

  private release(conn: FakeConn): void {
    if (this.closed) return;
    conn.idle = true;
    // FIFO: bırakılan bağlantı kuyruğun SONUNA gider (sqlx `ArrayQueue::push`).
    this.conns.splice(this.conns.indexOf(conn), 1);
    this.conns.push(conn);
    this.releaseWaiters.shift()?.();
  }

  /** Bu SELECT'in `n` tane yakın izleyicisinin başladığını bekle. */
  async waitForSelects(n: number): Promise<void> {
    if (this.selectStarted >= n) return;
    const waiter = Promise.withResolvers<void>();
    this.selectStartedWaiters.push(waiter.resolve);
    await waiter.promise;
  }
  async execute(script: string): Promise<{ rowsAffected: number }> {
    if (this.executeGate) await this.executeGate;
    const conn = await this.acquire();
    // Kirli bağlantıyla çalıştırılan yazma: kullanıcıya sessizce bozuk veri
    // yazmamak için kaydedilir, davranış testlerinde belgelenir.
    this.log.push(`[c${conn.idle ? "?" : conn.id}${conn.open ? " KIRLI" : ""}] ${script}`);
    try {
      for (const statement of script
        .split(/;\s*\n|;\s*$/)
        .map((s) => s.trim())
        .filter(Boolean)) {
        this.apply(conn, statement);
        const failure = this.failOn(statement);
        if (failure) throw new Error(failure);
      }
      return { rowsAffected: 1 };
    } finally {
      this.release(conn);
    }
  }

  async select<T>(query: string): Promise<T[]> {
    const conn = await this.acquire();
    this.log.push(`[c${conn.open ? " KIRLI" : ""} SELECT] ${query}`);
    this.selectStarted += 1;
    this.inFlightSelects += 1;
    this.peakSelects = Math.max(this.peakSelects, this.inFlightSelects);
    this.selectStartedWaiters.splice(0).forEach((resolve) => resolve());

    try {
      if (this.readGate) await this.readGate;
      if (/user_version/.test(query)) {
        return [{ user_version: TRIGGER_SCHEMA_VERSION }] as T[];
      }
      // Kirli bağlantı kendi transaction'ının yazılarını da görür — hata değil.
      const rows = [...this.committed, ...(conn.open ? conn.pending : [])];
      return rows as T[];
    } finally {
      this.inFlightSelects -= 1;
      this.release(conn);
    }
  }

  private apply(conn: FakeConn, statement: string): void {
    if (/^BEGIN/i.test(statement)) {
      // SQLite kirli bağlantıda ikinci transaction'ı reddeder.
      if (conn.open) throw new Error("cannot start a transaction within a transaction");
      conn.open = true;
      return;
    }
    if (/^COMMIT/i.test(statement)) {
      conn.pending.forEach((row) => this.committed.add(row));
      conn.pending = [];
      conn.open = false;
      return;
    }
    if (/^ROLLBACK/i.test(statement)) {
      conn.pending = [];
      conn.open = false;
      return;
    }
    const insert =
      /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+payments\s*\(\s*id\s*\)\s*VALUES\s*\(\s*'?(\d+)'?\s*\)/i.exec(
        statement,
      );
    if (insert) conn.pending.push(insert[1]);
  }

  /** Gerçekte `Pool::close()` boş bağlantıları kapatır ve havuzu kullanılamaz hâle getirir. */
  async close(): Promise<boolean> {
    this.closed = true;
    return true;
  }
}

let pool = new FakePool(4);

vi.mock("@tauri-apps/plugin-sql", () => ({
  default: {
    // Gerçekte havuz atıldıktan sonra `load` YENİ ve temiz bir havuz açar.
    load: async () => {
      if (pool.closed) pool = new FakePool(pool.size, pool.failOn);
      return pool;
    },
  },
}));

/** db.ts tekil durum tutar; her test için modül sıfırdan yüklenir. */
const freshDb = async () => {
  vi.resetModules();
  return import("../lib/db");
};

const FAILING_INSERT = "INSERT INTO payments (id) VALUES (2)";
const UNCOMMITTED = "999";

beforeEach(() => {
  pool = new FakePool(4);
});

describe("okuma kuyruğa girmiyor", () => {
  it("dört paralel SELECT aynı anda uçuşta olur", async () => {
    const { fetchQuery, getDb } = await freshDb();
    await getDb();

    // SELECT'leri tut: hepsi başlayıp **bitmeden** bırakılırsa paraleldir,
    // sıraya giriyorsa ilki bitmeden diğerleri başlayamaz.
    const held = Promise.withResolvers<void>();
    pool.readGate = held.promise;
    const reads = Promise.all([
      fetchQuery<string>("SELECT 1"),
      fetchQuery<string>("SELECT 2"),
      fetchQuery<string>("SELECT 3"),
      fetchQuery<string>("SELECT 4"),
    ]);

    await pool.waitForSelects(4);
    expect(pool.peakSelects).toBe(4);

    held.resolve();
    await reads;
  });

  it("okuma, transaction bitene kadar başlamaz; sonra hepsi birlikte devam eder", async () => {
    const { fetchQuery, executeTransaction, getDb } = await freshDb();
    await getDb();

    // Transaction'ı kuyrukta tut.
    const txHeld = Promise.withResolvers<void>();
    pool.executeGate = txHeld.promise;

    const tx = executeTransaction([FAILING_INSERT]);
    const readHeld = Promise.withResolvers<void>();
    pool.readGate = readHeld.promise;
    const reads = Promise.all([
      fetchQuery<string>("SELECT 1"),
      fetchQuery<string>("SELECT 2"),
      fetchQuery<string>("SELECT 3"),
    ]);

    // `getDb()` kendi `user_version` SELECT'ini zaten yaptı; ölçüm, o andan
    // sonra başlayan SELECT sayısına göre yapılır.
    const startedBefore = pool.selectStarted;
    await Promise.resolve();
    expect(pool.selectStarted).toBe(startedBefore);

    txHeld.resolve();
    pool.executeGate = null;
    await tx;

    // Kapı açıldı: bekleyen üç okuma da aynı anda devam eder.
    await pool.waitForSelects(4);
    expect(pool.peakSelects).toBe(3);

    readHeld.resolve();
    await reads;
  });

  it("executeQuery okuma kapısını açmaz", async () => {
    const { fetchQuery, executeQuery, getDb } = await freshDb();
    await getDb();

    const txHeld = Promise.withResolvers<void>();
    pool.executeGate = txHeld.promise;
    const write = executeQuery("INSERT INTO payments (id) VALUES (1)");

    const readHeld = Promise.withResolvers<void>();
    pool.readGate = readHeld.promise;
    const read = fetchQuery<string>("SELECT 1");
    await pool.waitForSelects(2);

    // Tek satırlık yazma okumayı beklemez.
    expect(pool.peakSelects).toBe(1);

    txHeld.resolve();
    pool.executeGate = null;
    await write;
    readHeld.resolve();
    await read;
  });
});

describe("havuz FIFO modeli", () => {
  it("bir bağlantıyı bıraktıktan sonra aynı bağlantıya geri vermez", async () => {
    pool = new FakePool(2);

    const first = await pool.execute("SELECT_MARKER_ONE");
    expect(first).toEqual({ rowsAffected: 1 });
    const second = await pool.execute("SELECT_MARKER_TWO");
    expect(second).toEqual({ rowsAffected: 1 });

    // FIFO: ilk çağrı c0'ı, ikinci c1'i alır; ikincisi bırakılınca kuyruk
    // [c0, c1] olur ve ÜÇÜNCÜ çağrı yine c0'a düşer. LIFO olsaydı üçüncü
    // çağrı c1'e düşerdi — test production'ın tersini modelliyordu.
    await pool.execute("SELECT_MARKER_THREE");

    const holders = pool.log.map((l) => l.match(/^\[c(\d+)/)?.[1]);
    expect(holders).toEqual(["0", "1", "0"]);
  });
});

describe("P0: rollback edilmemiş satır okunamaz", () => {
  /**
   * Asıl regresyon testi.
   *
   * Senaryo production'daki hatayı birebir yeniden üretir: transaction
   * `UNIQUE constraint failed` ile kesilir, `COMMIT` hiç çalışmaz ve
   * bağlantı havuza KİRLİ döner. Havuz FIFO olduğu için sonraki okuma kirli
   * bağlantıya düşer ve commit edilmemiş ödeme satırını kullanıcıya gösterir.
   *
   * Düzeltme: hangi bağlantının kirli olduğu bilinemediği için havuzun tamamı
   * atılır; sonraki okuma hiç transaction görmemiş yeni bir havuza düşer.
   */
  it("transaction hatasından sonra okuma rollback edilmemiş satırı DÖNDÜRMEZ", async () => {
    // Dört bağlantı: denetim ajanının gerçek modül üzerinde yakaladığı iz.
    // Havuz FIFO olduğu için `ROLLBACK`/prob kirli olan `c1`'DEĞİL, kuyrukta
    // ondan önce boşta olan temiz bir bağlantıya düşer; prob "temiz" der ve
    // kirli `c1` havuzda kalır. Sonraki SELECT tam olarak `c1`'e düşer.
    pool = new FakePool(4, (s) =>
      s.includes(`VALUES (${UNCOMMITTED})`) ? "UNIQUE constraint failed" : null,
    );
    const { fetchQuery, executeTransaction, getDb } = await freshDb();
    await getDb();

    await expect(
      executeTransaction([`INSERT INTO payments (id) VALUES (${UNCOMMITTED})`]),
    ).rejects.toThrow("UNIQUE constraint failed");

    // YANLIŞ davranışta burada `["999"]` dönerdi: rollback edilmemiş bir
    // ödeme satırı kullanıcıya gerçekmiş gibi görünürdü.
    const rows = await fetchQuery<string>("SELECT id FROM payments");
    expect(rows).toEqual([]);
    expect([...pool.committed]).toEqual([]);
  });

  it("temizlikten sonra hiçbir bağlantıya düşülmeden okuma yapılır", async () => {
    pool = new FakePool(4, (s) =>
      s.includes(`VALUES (${UNCOMMITTED})`) ? "UNIQUE constraint failed" : null,
    );
    const { fetchQuery, executeTransaction, getDb } = await freshDb();
    await getDb();

    await expect(
      executeTransaction([`INSERT INTO payments (id) VALUES (${UNCOMMITTED})`]),
    ).rejects.toThrow();
    await fetchQuery<string>("SELECT id FROM payments");

    // Hiçbir SELECT kirli bağlantıya düşmemeli: düştüğü yerde rollback
    // edilmemiş satırı görürdü.
    expect(pool.log.some((l) => l.includes("KIRLI") && l.includes("SELECT"))).toBe(false);
  });

  it("havuz atıldığı için eski bağlantılara hiçbir sorgu düşmez", async () => {
    const stale = new FakePool(2, (s) =>
      s.includes("INSERT INTO payments") ? "UNIQUE constraint failed" : null,
    );
    pool = stale;
    const { fetchQuery, executeTransaction, getDb } = await freshDb();
    await getDb();

    await expect(executeTransaction([FAILING_INSERT])).rejects.toThrow();
    await fetchQuery<string>("SELECT id FROM payments");

    expect(stale.closed).toBe(true);
    // Eski havuz kullanıcı verisine ait hiçbir sorgu görmedi.
    expect(stale.log.filter((l) => l.includes("SELECT") && l.includes("payments"))).toHaveLength(0);
  });

  it("havuz atılınca kuyrukta bekleyen yazma kapatılmış havuza düşmez", async () => {
    pool = new FakePool(2, (s) => (s.includes("VALUES (2)") ? "UNIQUE constraint failed" : null));
    const { executeQuery, executeTransaction, getDb } = await freshDb();
    await getDb();

    // Transaction'ı kuyrukta tut, arkasına bir yazma sıraya al.
    const held = Promise.withResolvers<void>();
    pool.executeGate = held.promise;
    const tx = executeTransaction([FAILING_INSERT]);
    const write = executeQuery("INSERT INTO payments (id) VALUES (7)");

    held.resolve();
    pool.executeGate = null;
    await expect(tx).rejects.toThrow("UNIQUE constraint failed");

    // Bekleyen yazma, havuz atıldıktan SONRA temiz havuzu kullanmalı.
    // `getDb()` `serialize`'dan önce çağrılırsa kapalı havuzu kullanır ve
    // kullanıcının bu yazması kaybolur.
    await expect(write).resolves.toEqual({ rowsAffected: 1 });
  });
});
