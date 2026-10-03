import Database from "@tauri-apps/plugin-sql";
import { DROP_TRIGGERS, CREATE_TRIGGERS, TRIGGER_SCHEMA_VERSION } from "../schema/triggers";
import { buildTransactionScript } from "./sql";
import { reportError } from "./errorMonitoring";
import { repairSchema, type SchemaRepairReport } from "./schemaGuard";

interface DbResult {
  rowsAffected: number;
}

interface DatabaseInstance {
  select: <T>(query: string, values?: unknown[]) => Promise<T[]>;
  execute: (query: string, values?: unknown[]) => Promise<DbResult>;
  /** Yalnızca kirli bağlantı kurtarmasında kullanılır; her sürümde olmayabilir. */
  close?: () => Promise<boolean>;
}

let dbInstance: DatabaseInstance | null = null;
let loadPromise: Promise<DatabaseInstance> | null = null;

/**
 * Denetim tetikleyicileri kurulamadıysa dolu olur. Ayarlar ekranı bu değeri
 * kullanıcıya gösterir — sessizce denetimsiz çalışmayı engellemek için.
 */
let triggerSetupError: string | null = null;
export const getTriggerSetupError = (): string | null => triggerSetupError;

/** Açılışta yapılan şema onarımlarının raporu — Ayarlar ekranında gösterilir. */
let schemaReport: SchemaRepairReport = { repaired: [], failures: [], triggersDropped: false };
export const getSchemaReport = (): SchemaRepairReport => schemaReport;

/**
 * `PRAGMA journal_mode=WAL` çalıştırılamadıysa dolu olur.
 *
 * WAL açılmazsa yazma performansı ve kilitlenme davranışı değişir; bu yüzden
 * hata yutulmaz — hem loglanır hem de Ayarlar ekranı tarafından okunabilir.
 */
let journalModeError: string | null = null;
export const getJournalModeWarning = (): string | null => journalModeError;

const asError = (err: unknown): Error => (err instanceof Error ? err : new Error(String(err)));

/**
 * Tetikleyicileri yalnızca tanımlar değiştiğinde yeniden kurar.
 * Sürüm damgası `PRAGMA user_version` içinde tutulur.
 */
const ensureTriggers = async (d: DatabaseInstance, force = false): Promise<void> => {
  const rows = await d.select<{ user_version: number }>("PRAGMA user_version;");
  const installed = Number(rows?.[0]?.user_version ?? 0);

  if (!force && installed === TRIGGER_SCHEMA_VERSION) return;

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
          journalModeError = null;
        } catch (err: unknown) {
          // WAL kritik değil ama ücretsiz de değil: yazma performansı ve kilit
          // davranışı değişir. Sessizce yutulmaz — loglanır ve Ayarlar ekranı
          // için `getJournalModeWarning()` üzerinden saklanır.
          journalModeError = asError(err).message;
          reportError(asError(err), { scope: "journal-mode" });
        }

        // Migration'lar eksik kalmışsa tamamla. Tetikleyicilerden ÖNCE olmalı:
        // tetikleyiciler var olmayan tablolara kurulamaz.
        try {
          schemaReport = await repairSchema(d);
          if (schemaReport.repaired.length > 0) {
            console.info("[Şema] Onarıldı:", schemaReport.repaired.join(", "));
          }
          for (const f of schemaReport.failures) {
            reportError(new Error(`${f.step}: ${f.message}`), { scope: "schema-repair" });
          }
        } catch (err: unknown) {
          reportError(err instanceof Error ? err : new Error(String(err)), {
            scope: "schema-repair",
          });
        }

        try {
          // Onarım tetikleyicileri düşürdüyse sürüm damgası güncel görünse de
          // yeniden kurulmaları gerekir.
          await ensureTriggers(d, schemaReport.triggersDropped);
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
 * **Yazma** çağrılarını tek bir kanaldan geçirir.
 *
 * Neden: `@tauri-apps/plugin-sql` bir bağlantı havuzu kullanır ve her
 * `execute`/`select` çağrısı için havuzdan **ayrı bir** bağlantı kiralar.
 * Transaction hatasından sonra o bağlantı kirli olarak havuza döner; havuzun
 * boş bağlantı kuyruğu FIFO olduğu için (`crossbeam_queue::ArrayQueue`) bir
 * sonraki çağrı kirli bağlantıya düşmez. Bu yüzden transaction gövdesi ile
 * havuzun atılması **tek bir kuyruk adımı** olmalıdır: araya giren bir yazma
 * kuyruktaki yerini korur, eski (kapatılmış) havuzu kullanmaz.
 *
 * Kuyruk yalnız yazmalarda aktiftir: okumalar paralel çalışır, aşağıdaki
 * okuma/yazma kapısı yalnız çakışmayı engeller.
 *
 * SQLite zaten tek yazıcı kabul ettiği için sıralama beklenen davranıştır.
 */
let dbQueue: Promise<unknown> = Promise.resolve();

const serialize = <T>(task: () => Promise<T>): Promise<T> => {
  // Önceki adım reddedildiyse kuyruk da kopmamalı: hatayı yutup sıradakine geç.
  const run = dbQueue.then(task, task);
  dbQueue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
};

/**
 * Transaction kapısı: `executeTransaction` sırasında okuma başlatılmaz.
 *
 * Okuma (`fetchQuery`) kuyruğa **girmez** — eşzamanlı SELECT'ler havuzdan ayrı
 * bağlantılar alıp paralel ilerler. `MonthSummaryScreen`'in `Promise.all` ile
 * attığı iki sorgu artık sıraya girmez.
 *
 * Peki okuma, transaction açıkken neden engelleniyor? Çünkü `db.execute(betiği)`
 * reddedildiğinde sqlx o bağlantıyı **havuza geri verirken transaction hâlâ
 * açıktır**. O aralıkta aynı bağlantıya düşen bir SELECT hata vermez — açık
 * transaction içinde çalışır ve birazdan `ROLLBACK` ile silinecek, henüz
 * commit edilmemiş satırları okur. Yani kullanıcıya hata değil **yanlış veri**
 * gider. Transaction gövdesi sırasında okuma güvenlidir (o bağlantı havuzdan
 * kiralanmıştır, okuma başka bağlantı alır ve WAL'da commit öncesi anlık
 * görüntüyü okur); tehlikeli olan yalnız temizlik penceresidir.
 *
 * `executeQuery` kapıya girmez: tek ifadeli bir yazma autocommit'te çalışır,
 * bağlantıda açık transaction bırakmaz. Yalnız yazma-yazma sıralaması için
 * `serialize` kuyruğunu kullanır — aksi hâlde sık görülen tek satırlık
 * yazmalar her okumanın önüne geçer ve K9'un çözdüğü sıkışıklık geri gelir.
 */
let transactionsPending = 0;
let readersActive = 0;
let readGate: Promise<void> | null = null;
let openReadGate: () => void = () => {};
let readersDrained: Promise<void> | null = null;
let signalReadersDrained: () => void = () => {};

const enterRead = async (): Promise<void> => {
  // `while`: kapı açıldığında araya başka bir transaction girmiş olabilir.
  while (transactionsPending > 0) {
    readGate ??= new Promise<void>((resolve) => {
      openReadGate = resolve;
    });
    await readGate;
  }
  readersActive += 1;
};

const leaveRead = (): void => {
  readersActive -= 1;
  if (readersActive === 0 && readersDrained) {
    const signal = signalReadersDrained;
    readersDrained = null;
    signal();
  }
};

/**
 * Transaction isteği gelir gelmez kapıyı kapatır.
 *
 * Kapatma senkron olmalıdır: kuyruk görevi bir microtask'a ertelenir, kapı
 * gövde başında kapatılırsa aynı anda gelen bir okuma araya girer. Sayaç
 * kullanılır çünkü kuyrukta birden fazla transaction bekleyebilir; ilki
 * bittiğinde kapı ikincisi hâlâ beklediği için açılmamalıdır.
 */
const requestTransaction = (): void => {
  transactionsPending += 1;
};

/**
 * Transaction gövdesi başlamadan önce kapıdan önce içeri girmiş okumaları
 * bitirir: onların `select` çağrısı transaction hata verip bağlantıyı kirli
 * bıraktıktan sonra havuza düşerse yanlış veri okurlar. Yeni okumalar zaten
 * kapıda bekliyor.
 */
const enterTransaction = async (): Promise<void> => {
  if (readersActive > 0) {
    readersDrained = new Promise<void>((resolve) => {
      signalReadersDrained = resolve;
    });
    await readersDrained;
  }
};

const leaveTransaction = (): void => {
  transactionsPending -= 1;
  if (transactionsPending === 0 && readGate) {
    const open = openReadGate;
    readGate = null;
    open();
  }
};

/**
 * Veritabanında bir okuma (SELECT) sorgusu çalıştırır.
 *
 * Kuyruğa girmez. Bekleme tek koşulda olur: bir transaction gövdesi ya da
 * temizliği sürüyorsa. Bkz. yukarıdaki kapı açıklaması.
 */
export const fetchQuery = async <T>(query: string, values: unknown[] = []): Promise<T[]> => {
  await enterRead();
  try {
    // Bağlantı kapıdan geçtikten sonra alınır: temizlikte havuz atılmışsa
    // okuma kapalı havuza düşmez, `getDb()` temiz havuzu açar.
    const db = await getDb();
    return await db.select<T>(query, values);
  } finally {
    leaveRead();
  }
};

/**
 * Veritabanında bir yazma (INSERT, UPDATE, DELETE) sorgusu çalıştırır.
 *
 * Okuma kapısına girmez; yalnız diğer yazmalarla sıralanır.
 */
export const executeQuery = async (query: string, values: unknown[] = []): Promise<DbResult> => {
  // Bağlantı kuyruk adımının İÇİNDE alınır: bir önceki transaction havuzu
  // attıysa bu adımda temiz havuz açılır. `serialize`'dan ÖNCE alınırsa
  // kuyrukta bekleyen bu yazma kapatılmış havuzu kullanır ve hata verir —
  // kullanıcının yazma isteği, başka bir işlemin temizliği yüzden kaybolur.
  return serialize(async () => (await getDb()).execute(query, values));
};

/**
 * Bağlantı havuzunu kapatıp singleton'ları sıfırlar. Sonraki `getDb()` çağrısı
 * temiz, hiç transaction görmemiş yeni bir havuz kurar.
 *
 * Bilinen yan etki: kuyrukta bekleyen bir görev eski (kapatılmış) havuzu
 * tutuyor olabilir. Bu yüzden `executeQuery` ve `executeTransaction`
 * bağlantıyı kuyruk adımının içinde alır.
 */
const discardPool = async (db: DatabaseInstance): Promise<void> => {
  if (dbInstance === db) {
    dbInstance = null;
    loadPromise = null;
  }
  try {
    await db.close?.();
  } catch (err: unknown) {
    reportError(asError(err), { scope: "transaction-cleanup" });
  }
};

/**
 * Transaction hatasından sonra bağlantı havusunu YENİLER.
 *
 * Neden doğrulama (`BEGIN IMMEDIATE` probu) yetmez — düzeltmenin tamamını
 * belirleyen nokta:
 *
 *  1. `db.execute()` her çağrıda havuzdan **ayrı bir bağlantı** kiralar
 *     (`Executor for &Pool` → `acquire()`/`release()`, sqlx 0.8.6). Yani
 *     ayrı `ROLLBACK;`, `BEGIN IMMEDIATE;`, `COMMIT;` çağrıları üç ayrı
 *     bağlantıya düşer.
 *  2. sqlx'in boş bağlantı kuyruğu **FIFO**'dur (`crossbeam_queue::ArrayQueue`:
 *     `release` → kuyruk sonu, `pop_idle` → kuyruk başı). Kirli bağlantı
 *     havuza **son** sırayla döner, dolayısıyla bir sonraki `execute` onu
 *     almaz — **temiz** bir bağlantı alır.
 *  3. O temiz bağlantıda `BEGIN IMMEDIATE` **başarılı** olur ve prob "temiz"
 *     der. Oysa kirli bağlantı hâlâ havuzda ve transaction'ı hâlâ açık.
 *  4. Sonraki `fetchQuery` kirli bağlantıyı alır ve **rollback edilmemiş
 *     ödeme satırını kullanıcıya gerçekmiş gibi gösterir**.
 *
 * Aynı `db.execute()` çağrısında birleştirmek (`ROLLBACK; BEGIN IMMEDIATE;
 * COMMIT;`) de yetmez: üçü tek bağlantıda çalışır ama O bağlantı kirli olan
 * değildir, prob yine temiz bir bağlantıda başarılı olur.
 *
 * Bu yüzden tek güvenli yol havuzu atmaktır: kirli bağlantı yok edilir,
 * sonraki `getDb()` hiç transaction görmemiş bağlantılarla açılır.
 *
 * Maliyet: yalnızca BAŞARISIZ transaction'da çalışır ve `getDb()` bir kez
 * daha `PRAGMA journal_mode` + şema onarımı + tetikleyici sürüm probu
 * çalıştırır. Kullanıcının yanlış ödeme tutarı görmesinden ucuzdur.
 */
const recyclePoolAfterFailure = async (db: DatabaseInstance, cause: unknown): Promise<void> => {
  reportError(
    new Error(`Transaction geri alındı, bağlantı havuzu yenileniyor: ${asError(cause).message}`),
    { scope: "transaction-cleanup" },
  );
  await discardPool(db);
};
/**
 * Birden çok ifadeyi tek bir transaction içinde, tek bir bağlantıda çalıştırır.
 * Ya hepsi uygulanır ya hiçbiri.
 *
 * Bağlama parametresi kullanılamaz — değerler `sqlLiteral` ile gömülmelidir.
 */
export const executeTransaction = async (statements: string[]): Promise<void> => {
  if (statements.length === 0) return;

  // Kapı istek anında, kuyruğa girmeden önce kapanır: kuyrukta bekleyen bir
  // transaction boyunca okuma girmez, çünkü o anda bağlantı henüz kirli değil
  // olsa da araya giren bir okuma bir sonraki transaction'ın kirli penceresine
  // denk gelebilir.
  requestTransaction();
  let released = false;
  try {
    await serialize(async () => {
      try {
        await enterTransaction();
        // Havuz temizlikte atılmış olabilir; bu yüzden kuyruk adımının içinde al.
        const db = await getDb();
        try {
          await db.execute(buildTransactionScript(statements));
        } catch (err: unknown) {
          // Betik ilk hatalı ifadede durdu; `COMMIT` hiç çalışmadı. Transaction
          // o bağlantıda açık kaldı ve bağlantı havuza KİRLİ döndü. Hangi
          // bağlantının kirli olduğu bilinmediği için havuzun tamamı atılır —
          // aksi halde sonraki bir SELECT rollback edilmemiş satırı okur.
          // MUTASYON GERİ AL
          await recyclePoolAfterFailure(db, err);
          throw err;
        }
      } finally {
        released = true;
        leaveTransaction();
      }
    });
  } finally {
    // Kuyruk adımı hiç çalışmazsa kapı sonsuza dek kapalı kalırdı.
    if (!released) leaveTransaction();
  }
};
