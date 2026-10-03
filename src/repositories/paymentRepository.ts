import { fetchQuery, executeQuery } from "../lib/db";
import type { Payment } from "../types";

export const paymentRepository = {
  findAll: (): Promise<Payment[]> =>
    fetchQuery<Payment>("SELECT * FROM payments ORDER BY date DESC, id DESC"),

  findByWorker: (worker_id: number): Promise<Payment[]> =>
    fetchQuery<Payment>("SELECT * FROM payments WHERE worker_id = ? ORDER BY date DESC, id DESC", [
      worker_id,
    ]),

  /** Aynı çalışan + tarih + tutar + açıklama kombinasyonunda kayıt var mı? */
  findExactDuplicate: async (
    worker_id: number,
    amount: number,
    date: string,
    description?: string,
  ): Promise<boolean> => {
    const rows = await fetchQuery<{ id: number }>(
      `SELECT id FROM payments
       WHERE worker_id = ?
         AND date = ?
         AND amount = ?
         AND IFNULL(description, '') = IFNULL(?, '')
       LIMIT 1`,
      [worker_id, date, amount, description || null],
    );
    return rows.length > 0;
  },

  /**
   * Çalışanın veritabanındaki güncel toplam ödemesi.
   *
   * Aşım kontrolü çağıranın (bileşenin) bayat olabilecek bakiyesine
   * güvenmemek için gereklidir: iki ödeme arasında bakiye tazelenmezse
   * kontrol yanlış değerlere bakar (PROBE-Q).
   */
  sumByWorker: async (worker_id: number): Promise<number> => {
    const rows = await fetchQuery<{ total: number | null }>(
      "SELECT SUM(amount) AS total FROM payments WHERE worker_id = ?",
      [worker_id],
    );
    return rows[0]?.total ?? 0;
  },

  create: async (worker_id: number, amount: number, date: string, description?: string) => {
    // Çift tıklama / in-flight guard atlanırsa aynı ödeme iki kez yazılmasın.
    if (await paymentRepository.findExactDuplicate(worker_id, amount, date, description)) {
      throw new Error("Bu ödeme zaten kayıtlı.");
    }
    return executeQuery(
      "INSERT INTO payments (worker_id, amount, date, description) VALUES (?, ?, ?, ?)",
      [worker_id, amount, date, description || null],
    );
  },

  /** `worker_id` ile sınırlıdır: yanlış çalışanın ödemesi silinemez. */
  remove: (id: number, worker_id: number) =>
    executeQuery("DELETE FROM payments WHERE id = ? AND worker_id = ?", [id, worker_id]),
};
