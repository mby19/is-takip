import type { Worker } from "../types";

const upper = (s: string) => s.toLocaleUpperCase("tr-TR");

/** İsmi boşluklardan ayırır, boş parçaları atar. */
const parts = (name: string): string[] => name.trim().split(/\s+/).filter(Boolean);

/**
 * Aynı kişi için artan ayırt edicilikte aday baş harfler üretir.
 * Ahmet Yılmaz için: A → AY → AHY → AHMY …
 */
function candidates(name: string): string[] {
  const words = parts(name);
  if (words.length === 0) return ["?"];

  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : "";
  const out: string[] = [upper(first.slice(0, 1))];

  if (last) {
    for (let n = 1; n <= Math.min(first.length, 3); n++) {
      out.push(upper(first.slice(0, n) + last.slice(0, 1)));
    }
  }
  for (let n = 2; n <= Math.min(first.length, 3); n++) {
    out.push(upper(first.slice(0, n)));
  }
  return out;
}

/**
 * Bir ekip için baş harfleri hesaplar ve KÜME İÇİNDE benzersiz olmalarını
 * garanti eder.
 *
 * Tek harf yeterliyse tek harf kullanılır; "Mehmet Demir" ile "Murat Kaya"
 * gibi çakışan durumlarda soyadı harfi eklenerek ayrıştırılır. Hiçbir aday
 * yetmezse sona sıra numarası konur — takvim başlığında iki sütunun aynı
 * görünmesi kabul edilemez.
 */
export function workerInitials(workers: readonly Worker[]): Map<number, string> {
  const result = new Map<number, string>();
  const used = new Set<string>();

  for (const worker of workers) {
    const options = candidates(worker.name);
    let chosen = options.find((c) => !used.has(c));

    if (!chosen) {
      const base = options[options.length - 1];
      let suffix = 2;
      while (used.has(`${base}${suffix}`)) suffix++;
      chosen = `${base}${suffix}`;
    }

    used.add(chosen);
    result.set(worker.id, chosen);
  }

  return result;
}
