/**
 * Görsel desen (emoji) ve PIN mantığının saf, React'tan bağımsız parçası.
 *
 * Buradaki fonksiyonlar UI'ın geri kalanından bağımsız test edilebilir;
 * bileşenler yalnızca bu kuralları uygular.
 */

/** Emoji deseni uzunluğu. */
export const PATTERN_LENGTH = 3;

/** Kurtarma PIN'i uzunluğu. */
export const PIN_LENGTH = 4;

export interface LockEmoji {
  id: string;
  char: string;
  name: string;
}

/** Kilit ekranlarında seçilebilen emojiler (tek kaynak). */
export const LOCK_EMOJIS: readonly LockEmoji[] = [
  { id: "panda", char: "🐼", name: "Panda" },
  { id: "rocket", char: "🚀", name: "Roket" },
  { id: "diamond", char: "💎", name: "Elmas" },
  { id: "unicorn", char: "🦄", name: "Unicorn" },
  { id: "clover", char: "🍀", name: "Yonca" },
  { id: "pizza", char: "🍕", name: "Pizza" },
  { id: "guitar", char: "🎸", name: "Gitar" },
  { id: "saturn", char: "🪐", name: "Satürn" },
  { id: "crown", char: "👑", name: "Taç" },
];

/** Emoji karakterini döndürür; bilinmeyen id için boş string. */
export const emojiChar = (id: string | undefined): string =>
  LOCK_EMOJIS.find((emoji) => emoji.id === id)?.char ?? "";

/**
 * Desene yeni bir id ekler.
 *
 * Uzunluk sınırı aşılırsa en eski kayıt düşürülür; pencere her zaman
 * `length` uzunluğunda tutulur. Böylece pencere süresi dolmadan yapılan
 * 4. (ve sonraki) basışlar deseni bozmaz, sadece kaydırır — kullanıcı
 * kilitli kalmaz.
 */
export function appendToPattern(
  current: readonly string[],
  id: string,
  length: number = PATTERN_LENGTH,
): string[] {
  const next = [...current, id];
  return next.length > length ? next.slice(next.length - length) : next;
}

/** Desen tamamlandı mı? Uzunluk dışında hiçbir koşula bakmaz. */
export function isPatternComplete(
  sequence: readonly string[],
  length: number = PATTERN_LENGTH,
): boolean {
  return sequence.length === length;
}

/**
 * İki desen birebir aynı mı?
 *
 * Hem uzunluk hem sıra kontrolü şart: uzunluk farklıysa desen asla
 * eşleşmiş sayılmaz (LK2 — 4 elemana düşen pencere 3'lüyle karşılaştırılıyordu).
 */
export function matchesPattern(
  expected: readonly string[],
  entered: readonly string[],
  length: number = PATTERN_LENGTH,
): boolean {
  if (expected.length !== length || entered.length !== length) return false;
  return expected.every((value, index) => value === entered[index]);
}

/**
 * PIN'e rakam ekler. Uzunluk dolduysa yeni basış yok sayılır;
 * PIN her zaman tam olarak `length` uzunluğunda ilerler.
 */
export function appendToPin(current: string, digit: string, length: number = PIN_LENGTH): string {
  return current.length >= length ? current : current + digit;
}
