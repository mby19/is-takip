/**
 * PDF yazı tipi ve karakter politikası.
 *
 * Neden gömülü (TTF) font yok: `public/fonts/Inter-*.ttf` dosyaları gerçek font
 * değildi — GitHub "Page not found" HTML sayfasıydı. jsPDF bu baytları font
 * olarak kabul edip PDF'e yazıyor, sonuç bozuk gliflerdi. jsPDF'in TTF'i
 * çalışma anında `addFileToVFS` ile beslenmek zorundadır; uygulama paketinde
 * doğrulanmış bir TTF olmadan bu yol sessizce bozuk belge üretir.
 *
 * Bu yüzden jsPDF'in **yerleşik** fontlarını (Helvetica) kullanıyoruz. Yerleşik
 * fontlar `WinAnsiEncoding` (cp1252) ile yazılır. cp1252'de Türkçe harflerin
 * yalnızca yarısı vardır:
 *
 *   doğrudan çizilir : ç Ç ö Ö ü Ü
 *   karşılığı yok     : ş Ş ğ Ğ ı İ ₺ (ve Latin-1 dışı her karakter)
 *
 * Eksik harfler PDF'e olduğu gibi yazılırsa 2 baytlık/bozuk glif olarak
 * çıkar. Bu yüzden `toWinAnsiText` bunları okunabilir ASCII karşılıklarına
 * eşler. Bu eşleme kayıp değildir: kaybedilen bilgi harfin biçimidir, tutar
 * değil. Kullanıcı yanlış harfli bir belge almasın diye belgeye düzeltilemeyen
 * bu durum `PDF_FONT_WARNING` satırıyla belgenin içine de yazılır.
 */

/** Yerleşik font ailesi — cp1252 (WinAnsi) kapsamı. */
export const PDF_FONT = "helvetica";

/**
 * cp1252'de glifi olmayan karakterler → okunabilir karşılık.
 *
 * Bilinçli olarak sadeleştirme: `ş` → `s` (üstüne nokta konulamaz), `İ` → `I`
 * (Türkçe `I/İ` ayrımı kaybolur). Tutarlar ve tarihler etkilenmez.
 */
const UNSUPPORTED: Record<string, string> = {
  ş: "s",
  Ş: "S",
  ğ: "g",
  Ğ: "G",
  ı: "i",
  İ: "I",
  "₺": "TL",
};

/**
 * Belgenin altına yazılan uyarı.
 *
 * Metnin kendisi bilinçli olarak yalnızca harflerin *karşılıklarını* içerir:
 * belgeye yazıldığında okunan satır tam da uygulanan dönüşümü anlatır.
 */
export const PDF_FONT_WARNING =
  "Not: Bu belgede s/g/i/I harfleri, gomulu Turkce yazitipi bulunamadigi icin " +
  "karsiliklariyla yazilmistir. Tutarlar ve tarihler etkilenmemistir.";

/**
 * jsPDF'in WinAnsi dönüşüm tablosunun karşıladığı cp1252'ye özgü karakterler
 * (0x80–0x9F aralığı): tireler, tırnaklar, para veopyright işaretleri.
 * Bunlar Latin-1'de yoktur ama jsPDF doğru bayta çevirir.
 */
const WIN_ANSI_ONLY = "–—‘’‚“”„†‡•…€‰‹›ˆ™Œœ˜ŠšŽžƒ";

/** Bir karakter doğrudan cp1252'de çizilebiliyor mu? */
const isDirectlyRenderable = (ch: string): boolean => {
  const code = ch.codePointAt(0) ?? 0;
  if (code >= 0x20 && code <= 0x7e) return true;
  if (code >= 0xa0 && code <= 0xff) return true;
  return WIN_ANSI_ONLY.includes(ch);
};

/** Sonuç: dönüştürülmüş metin ve kaç karakterin karşılığa çevrildiği. */
export interface WinAnsiText {
  text: string;
  /** Karşılığı olmadığı için değiştirilen karakter sayısı. */
  foldedCount: number;
}

/**
 * Metni jsPDF'in yerleşik fontlarıyla güvenle çizilebilir hâle getirir.
 *
 * cp1252'de karşılığı olmayan her karakter ya harf eşlemesinden geçer ya da
 * `?` ile değiştirilir — hiçbir durumda bozuk bayt PDF'e sızmaz.
 */
export const toWinAnsiText = (input: string): WinAnsiText => {
  let text = "";
  let foldedCount = 0;

  for (const ch of input) {
    if (isDirectlyRenderable(ch)) {
      text += ch;
      continue;
    }
    const mapped = UNSUPPORTED[ch];
    text += mapped ?? "?";
    foldedCount += 1;
  }

  return { text, foldedCount };
};
