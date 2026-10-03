/**
 * «Bugünün puantajı girildi mi?» ölçütü.
 *
 * Ölçüt bilinçli olarak "bir kayıt var mı" DEĞİL, "herkes için kayıt var mı"
 * olmalı: 40 kişilik ekipte tek kişi işaretlendiğinde gün dolmuş sayılırsa
 * kalan 39 kişinin puantajı sessizce kaybolur ve ay sonu hesabı eksik
 * kapanır — kullanıcıya hiçbir uyarı gitmeden.
 *
 * Arşivlenmiş çalışanlar sayılmaz: bugün onların puantajını girmek beklenmez
 * ve puantajsız arşivli bir kişi uyarıyı sürekli açık tutardı.
 */

/** Sadece kimlik ve aktiflik gerekir — store'dan ya da SQL sonucundan gelir. */
export interface CoverageWorker {
  id: number;
  is_active?: boolean | number | null;
}

export interface CoverageAttendance {
  worker_id: number | string;
  date: string;
}

/**
 * Verilen gün için AKTİF çalışanların tamamının kaydı var mı?
 *
 * Aktif çalışan yoksa `true` döner: kimsenin puantajı beklenmiyor, uyarı da
 * gerekmiyor.
 */
export function hasAllAttendanceRecorded(
  workers: readonly CoverageWorker[],
  attendances: readonly CoverageAttendance[],
  date: string,
): boolean {
  const expected = workers.filter((w) => w.is_active !== false && w.is_active !== 0);
  if (expected.length === 0) return true;

  const day = date.trim();
  const recorded = new Set<number>();
  for (const a of attendances) {
    if (String(a.date).trim() !== day) continue;
    recorded.add(Number(a.worker_id));
  }

  return expected.every((w) => recorded.has(w.id));
}
