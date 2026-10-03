import { fetchQuery, executeQuery } from "../lib/db";
import { compareTurkish } from "../utils/turkishCollation";
import type { Worker, WorkerType } from "../types";

export const workerRepository = {
  /**
   * Tüm çalışanlar: aktifler önce, sonra Türkçe alfabe sırasında isim.
   *
   * İsim sıralaması bilinçli olarak SQL'e taşınmıyor. `tauri-plugin-sql`
   * (2.3.2) yalnız `load`/`close`/`execute`/`select` komutlarını açar; özel
   * bir SQLite collation kaydedilemez. SQL'de kalan `ORDER BY name ASC` ise
   * `BINARY` collation ile "Ç", "Ş", "Ğ" harflerini `Z`'den sonra atardı.
   * Liste zaten bellekte geldiği için (60–100 kişi) karşılaştırma JS'te
   * yapılır.
   *
   * Karşılaştırıcı İKİ anahtarlıdır: önce `is_active`, sonra isim. Yalnız
   * isme göre sıralamak SQL'den gelen grup sırasını bozup pasif çalışanları
   * araya karıştırıyordu — ekranda "pasif" filtresi yanlış satırları gizler.
   */
  findAll: async (): Promise<Worker[]> => {
    const rows = await fetchQuery<Worker>("SELECT * FROM workers");
    return rows.sort(
      (a, b) => Number(b.is_active) - Number(a.is_active) || compareTurkish(a.name, b.name),
    );
  },

  create: (name: string, daily_wage: number, worker_type: WorkerType) =>
    executeQuery(
      "INSERT INTO workers (name, daily_wage, worker_type, is_active) VALUES (?, ?, ?, 1)",
      [name, daily_wage, worker_type],
    ),

  /** Eklenen çalışanın id'sini döndürür (ücret geçmişi açılış kaydı için). */
  findIdByName: (name: string): Promise<{ id: number }[]> =>
    fetchQuery<{ id: number }>("SELECT id FROM workers WHERE name = ? ORDER BY id DESC LIMIT 1", [
      name,
    ]),

  update: (id: number, name: string, daily_wage: number, worker_type: WorkerType) =>
    executeQuery("UPDATE workers SET name = ?, daily_wage = ?, worker_type = ? WHERE id = ?", [
      name,
      daily_wage,
      worker_type,
      id,
    ]),

  updateStatus: (id: number, is_active: boolean) =>
    executeQuery("UPDATE workers SET is_active = ? WHERE id = ?", [is_active ? 1 : 0, id]),

  updateAppearance: (id: number, color: string | null, short_label: string | null) =>
    executeQuery("UPDATE workers SET color = ?, short_label = ? WHERE id = ?", [
      color,
      short_label,
      id,
    ]),

  archive: (id: number) => executeQuery("UPDATE workers SET is_active = 0 WHERE id = ?", [id]),
};
