/**
 * Türkçe metin sıralama ve arama normalizasyonu.
 *
 * Neden SQLite içinde çözülmüyor: `tauri-plugin-sql` yalnız `load`, `close`,
 * `execute` ve `select` komutlarını dışa açar; özel bir SQLite collation
 * kaydetme çağrısı yoktur (crate 2.3.2 `commands.rs`). SQL'deki varsayılan
 * `BINARY` collation ise `Ç`(U+00C7), `Ş`(U+015E), `Ğ`(U+011E) harflerini
 * `Z`'den sonra, büyük harfleri de küçüklerden önce atar. Bu yüzden sıralama
 * JS'e alınır: liste zaten bellekte geliyor (60–100 kişi) ve `workerRepository`
 * SQL'i, `Intl` karşılaştırmasını yapar.
 *
 * İki işlev ayrıdır ve karıştırılmamalıdır:
 *  - `compareTurkish` **sıralar**: Türkçe alfabe sırası korunur. `Ş` `S`'den
 *    SONRA gelir, yani "Selim" < "Şahin". Aksan katlama sıralamada kullanılırsa
 *    bu kaybolur (bkz. `foldTurkish`).
 *  - `foldTurkish` **arar**: aksan ve harf farkı yok sayılır, "sahin" "Şahin"i
 *    bulur. Sıralamada kullanılırsa liste yanlış yere düşer.
 */

/** Uygulamanın metin dili. Kısa etiketler ve isimler bu alfabeye göre sıralanır. */
export const TURKISH_LOCALE = "tr-TR";

/**
 * Türkçe alfabe sırası — `Intl` yoksa devreye giren yedek karşılaştırmanın
 * dayandığı sıra. `ı` `i`'den, `ğ` `g`'den, `ş` `s`'den sonra gelir.
 */
const TURKISH_ALPHABET = "abcçdefgğhıijklmnoöprsştuüvyz";

/** `NFD` ile ayrışmayan, Türkçe olmayan harflerin taban karşılığı. */
const NON_TURKISH_BASE: Record<string, string> = {
  ß: "ss",
  ẞ: "ss",
  æ: "ae",
  Æ: "ae",
  œ: "oe",
  Œ: "oe",
  ø: "o",
  Ø: "o",
  đ: "d",
  Đ: "d",
  ð: "d",
  Ð: "d",
  þ: "th",
  Þ: "th",
  ł: "l",
  Ł: "l",
};

/** `NFD` sonrası kalan birleşik işaretleri (aksanları) siler. */
const COMBINING_MARKS = /\p{M}+/gu;

/** Arama katlamasında Türkçe harflerin taban karşılığı. */
const SEARCH_FOLD: Record<string, string> = {
  ...NON_TURKISH_BASE,
  ı: "i",
  İ: "i",
};

/**
 * Sıralama karşılaştırması. `numeric: true` ile "K2" < "K10"; `sensitivity:
 * "base"` ile büyük/küçük harf ve aksan farkı yok sayılır — **Türkçe harfler
 * yine de ayrıdır**, `Ş` `S`'den sonra gelir. `Intl` standart WebView'lerde ve
 * Node'da vardır; yoksa elle alfabe tablosuna düşülür.
 */
const collator = createCollator();

function createCollator(): Intl.Collator | null {
  if (typeof Intl === "undefined" || typeof Intl.Collator !== "function") return null;
  try {
    return new Intl.Collator(TURKISH_LOCALE, { sensitivity: "base", numeric: true });
  } catch {
    return null;
  }
}

/**
 * Bir karakterin Türkçe alfabe sırasındaki yeri.
 *
 * Türkçe harfler kendi yerini korur (`ş` → `ş` sırası); diğer harfler `NFD`
 * ile ayrışıp aksanları atılarak taban harfe indirilir (`é` → `e`, `å` → `a`).
 * Böylece aksanlı isimler komşu harfin yanına düşer, Türkçe harflerin sırası
 * bozulmaz.
 */
function rankOf(char: string): number {
  const lower = char.toLocaleLowerCase(TURKISH_LOCALE);
  const direct = TURKISH_ALPHABET.indexOf(lower);
  if (direct >= 0) return direct;

  const nonTurkish = NON_TURKISH_BASE[char] ?? NON_TURKISH_BASE[lower];
  if (nonTurkish !== undefined) return TURKISH_ALPHABET.indexOf(nonTurkish[0]);

  // `å` ve `é` gibi harfler `NFD` ile ayrışır: aksan atılır, taban harf kalır.
  const decomposed = lower.normalize("NFD").replace(COMBINING_MARKS, "");
  if (decomposed !== lower) {
    const baseRank = TURKISH_ALPHABET.indexOf(decomposed[0]);
    if (baseRank >= 0) return baseRank;
  }

  // Alfabede olmayan harf (Çince, Arapça…): kod noktasına göre sabit sıra.
  // Türkçe harflerin önüne geçemez, böylece çok dillilik sıralamayı bozmaz.
  return TURKISH_ALPHABET.length + 0x10000 + (lower.codePointAt(0) ?? 0);
}

/**
 * `Intl` yoksa devreye giren yedek: harf harf Türkçe alfabe sırasını uygular.
 */
function fallbackCompare(a: string, b: string): number {
  const left = [...a];
  const right = [...b];
  const len = Math.min(left.length, right.length);
  for (let i = 0; i < len; i++) {
    const diff = rankOf(left[i]) - rankOf(right[i]);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  return left.length === right.length ? 0 : left.length < right.length ? -1 : 1;
}

/**
 * İki metni Türkçe alfabe sırasına göre karşılaştırır.
 *
 * Sonuç `Array.prototype.sort` ve `Intl.Collator` sözleşmesine uyar: negatif →
 * `a` önce, sıfır → eşit (`sort` kararlı olduğu için özgün sıra korunur),
 * pozitif → `b` önce.
 *
 * `Çetin` `C` ile `D` arasında, `Şahin` `S` ile `U` arasında sıralanır.
 * `Å` gibi Türkçe olmayan harfler bozmaz: `A` ile aynı kümeye, alfabet
 * sonrasına düşer.
 */
export function compareTurkish(a: string, b: string): number {
  if (a === b) return 0;
  return collator ? collator.compare(a, b) : fallbackCompare(a, b);
}

/**
 * Arama için metni aksan, harf ve büyük/küçük harf duyarsız hale getirir.
 *
 * "mehmet" → "mehmet", "Mehmet" → "mehmet", "Şahin"/"Sahin" → "sahin",
 * "Çetin"/"Cetin" → "cetin", "Işık"/"ışık" → "isik", "José" → "jose".
 */
export function foldTurkish(value: string): string {
  return value
    .normalize("NFD")
    .replace(COMBINING_MARKS, "")
    .toLocaleLowerCase(TURKISH_LOCALE)
    .replace(/[ıİßẞæÆœŒøØđĐðÐþÞłŁ]/g, (ch) => SEARCH_FOLD[ch])
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * `needle` (arama metni) `haystacks` içindeki herhangi bir alanda geçiyor mu?
 *
 * Her iki taraf da `foldTurkish` ile katlandığı için arama aksan ve büyük/küçük
 * harf duyarsızdır. Boş arama metni eşleşme sayılır — filtre kapalıyken tüm
 * liste görünür kalmalıdır.
 */
export function matchesTurkish(
  haystacks: readonly (string | null | undefined)[],
  needle: string,
): boolean {
  const query = foldTurkish(needle);
  if (!query) return true;
  return haystacks.some((raw) => {
    if (!raw) return false;
    return foldTurkish(raw).includes(query);
  });
}
