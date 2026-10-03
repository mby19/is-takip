import { fetchQuery, executeTransaction } from "../lib/db";
import { sqlLiteral } from "../lib/sql";
import type { Attendance, AttendanceStatus } from "../types";

/** SQL'de kabul edilen durumlar — CHECK kısıtıyla birebir aynı. */
const VALID_STATUSES: readonly string[] = ["FULL", "HALF", "ABSENT", "HOLIDAY"];

/**
 * Tek bir puantaj yazma ifadesi.
 *
 * Neden `INSERT OR REPLACE` DEĞİL: `REPLACE`, çakışan satırı önce DELETE
 * edip sonra yeni satırı AUTOINCREMENT id'siyle yeniden INSERT eder. Yani
 * bir puantaj DEĞİŞİKLİĞİ bile DELETE+INSERT olarak denetlenir; `attendance_
 * update_log` tetikleyicisi hiç tetiklenmez ve "Geri Al" elde yalnızca
 * DELETE kaydı kalır — geri alma da puantajı siler, önceki değeri geri
 * yüklemez. `ON CONFLICT DO UPDATE` ise satırın `id`'sini korur ve UPDATE
 * olarak denetlenir.
 *
 * `OR ROLLBACK`: yazma ifadeleri bu biçimde üretilir. SQLite bir kısıt
 * ihlalinde varsayılan olarak yalnızca O İFADEYİ geri alır ve transaction
 * açık kalır; sonraki COMMIT önceki yazmaları kalıcılaştırır. `OR ROLLBACK`
 * ile ihlal tüm bloğu düşürür (bkz. `src/lib/sql.ts`).
 */
const upsertSql = (workerId: number, date: string, status: AttendanceStatus): string =>
  `INSERT OR ROLLBACK INTO attendance (worker_id, date, status) VALUES (${sqlLiteral(workerId)}, ${sqlLiteral(date)}, ${sqlLiteral(status)})
     ON CONFLICT(worker_id, date) DO UPDATE SET status = excluded.status`;

// SQLite'ta DELETE ifadesi çatışma algoritmasını (OR ROLLBACK) KABUL ETMEZ;
// transaction içinde kısıt ihlali zaten tüm bloğu geri alır.
const deleteSql = (workerId: number, date: string): string =>
  `DELETE FROM attendance WHERE worker_id = ${sqlLiteral(workerId)} AND date = ${sqlLiteral(date)}`;

export interface AttendanceUpsertEntry {
  workerId: number;
  /** YYYY-MM-DD */
  date: string;
  /** `null` => o güne ait kaydı sil. */
  status: AttendanceStatus | null;
}

/**
 * Girdiyi doğrular ve normalize eder.
 *
 * Fail-closed: geçersiz bir giriş varsa HİÇBİR ifade üretilmez. Aksi halde
 * geçersiz durum yazılmaya çalışılır ve transaction ortasında constraint
 * hatasıyla geri alınır — kullanıcı hangi satırın yazılamadığını bilemez.
 */
const normalizeEntries = (entries: AttendanceUpsertEntry[]): AttendanceUpsertEntry[] => {
  if (!Array.isArray(entries)) throw new Error("Puantaj listesi geçersiz.");

  return entries.map((entry, index) => {
    const workerId = Number(entry?.workerId);
    if (!Number.isInteger(workerId) || workerId <= 0) {
      throw new Error(`Geçersiz çalışan id (${index}. kayıt): ${String(entry?.workerId)}`);
    }

    const date = String(entry?.date ?? "").trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      throw new Error(`Geçersiz tarih (${index}. kayıt): "${date}"`);
    }

    const status = entry?.status ?? null;
    if (status !== null && !VALID_STATUSES.includes(status)) {
      throw new Error(`Geçersiz durum (${index}. kayıt): "${String(status)}"`);
    }

    return { workerId, date, status };
  });
};

export const attendanceRepository = {
  findAll: (): Promise<Attendance[]> =>
    fetchQuery<Attendance>("SELECT * FROM attendance ORDER BY date"),

  findByDate: (date: string): Promise<Attendance[]> =>
    fetchQuery<Attendance>("SELECT * FROM attendance WHERE date = ?", [date]),

  findByDateRange: (start: string, end: string): Promise<Attendance[]> =>
    fetchQuery<Attendance>("SELECT * FROM attendance WHERE date >= ? AND date <= ?", [start, end]),

  /**
   * Tablodaki en eski puantaj tarihi (`YYYY-MM-DD`), yoksa `null`.
   *
   * "Tüm dönemler" taraması boş yılları sormak zorunda değil: akıtma zaten
   * `attendance.length === 0` olan aralığı atlar. Tabanı verinin gerçekten
   * başladığı yıla çekmek, sonucu değiştirmeden sorgu sayısını düşürür.
   */
  earliestDate: async (): Promise<string | null> => {
    const rows = await fetchQuery<{ earliest: string | null }>(
      "SELECT MIN(date) AS earliest FROM attendance",
    );
    return rows[0]?.earliest ?? null;
  },

  /** Tek puantaj yazar. `upsertMany`'nin tek girdili hâli. */
  upsert: async (worker_id: number, date: string, status: AttendanceStatus) => {
    await attendanceRepository.upsertMany([{ workerId: worker_id, date, status }]);
  },

  /** Tek puantaj kaydını siler. `upsertMany`'nin tek girdili hâli. */
  remove: async (worker_id: number, date: string) => {
    await attendanceRepository.upsertMany([{ workerId: worker_id, date, status: null }]);
  },

  /**
   * Bir günün tüm puantajlarını TEK atomik işlemde yazar.
   *
   * Ya hepsi yazılır ya hiçbiri: `executeTransaction` ifadeleri tek
   * bağlantıda `BEGIN IMMEDIATE … COMMIT` bloğunda çalıştırır, kısıt ihlali
   * tüm bloğu geri alır. Bu, "yarısı kaydedildi yarısı kaydedilmedi"
   * durumunu — sahada en tehlikeli hata türü — imkânsız kılar.
   *
   * Dönem kilidi bu katmanda YOKTUR; `attendanceStore` katmanında kontrol
   * edilir.
   */
  upsertMany: async (
    entries: AttendanceUpsertEntry[],
  ): Promise<{ written: number; removed: number }> => {
    const normalized = normalizeEntries(entries);
    if (normalized.length === 0) return { written: 0, removed: 0 };

    let written = 0;
    let removed = 0;
    const statements: string[] = [];

    for (const entry of normalized) {
      if (entry.status === null) {
        statements.push(deleteSql(entry.workerId, entry.date));
        removed += 1;
      } else {
        statements.push(upsertSql(entry.workerId, entry.date, entry.status));
        written += 1;
      }
    }

    await executeTransaction(statements);
    return { written, removed };
  },
};
