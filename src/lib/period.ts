/**
 * Dönem (ay) yardımcıları.
 *
 * Dönem anahtarı her zaman `YYYY-MM` biçimindedir ve `closed_periods.period`
 * sütununda bu biçimde saklanır.
 */

export type PeriodKey = string;

/** `2026-05-10` veya `2026-05` girdisinden dönem anahtarı üretir. */
export const periodOf = (dateStr: string): PeriodKey => String(dateStr).trim().slice(0, 7);

/** Date nesnesinden dönem anahtarı. */
export const periodOfDate = (date: Date): PeriodKey =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;

const MONTHS = [
  "Ocak",
  "Şubat",
  "Mart",
  "Nisan",
  "Mayıs",
  "Haziran",
  "Temmuz",
  "Ağustos",
  "Eylül",
  "Ekim",
  "Kasım",
  "Aralık",
];

/** `2026-05` → `Mayıs 2026` */
export function formatPeriod(period: PeriodKey): string {
  const [year, month] = period.split("-");
  const index = parseInt(month, 10) - 1;
  if (!year || Number.isNaN(index) || !MONTHS[index]) return period;
  return `${MONTHS[index]} ${year}`;
}

/**
 * Bugünden geriye, veri bulunan en eski döneme kadar olan dönemler.
 *
 * Veri yoksa YALNIZCA içinde bulunulan ay döner — eskiden veri olmasa bile
 * 36 ay listeleniyor ve ayarlar ekranı gereksizce uzayıp gidiyordu.
 */
export function periodsSince(earliest: PeriodKey | null, limit = 24): PeriodKey[] {
  const now = new Date();
  const current = periodOfDate(now);
  if (!earliest) return [current];

  const result: PeriodKey[] = [];
  const cursor = new Date(now.getFullYear(), now.getMonth(), 1);

  for (let i = 0; i < limit; i++) {
    const key = periodOfDate(cursor);
    result.push(key);
    if (key <= earliest) break;
    cursor.setMonth(cursor.getMonth() - 1);
  }
  return result;
}
