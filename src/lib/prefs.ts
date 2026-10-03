/**
 * Cihaza özel tercihlerin kalıcı ayarı.
 *
 * Bu ayarlar veritabanı yedeğine girmez — ekip tercihi değil, uygulama
 * görünümü tercihidir. Yine de bileşenler `localStorage`'ı doğrudan
 * çağırmaz: erişim kısıtlı webview'da ve gizli modda `SecurityError` fırlatır
 * ve `useState` başlangıcında oluşan bu hata uygulamayı komple çökertirdi
 * (bkz. themeStore'daki aynı koruma).
 */

const readRaw = (key: string): string | null => {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
};

const writeRaw = (key: string, value: string): void => {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Yazılamıyorsa ayar yalnızca bu oturumda geçerli olur; kullanıcıyı uyarma.
  }
};

/** Kayıtlı değeri okur; erişilemezse ya da yoksa `fallback` döner. */
export const readPref = (key: string, fallback: string | null = null): string | null => {
  const stored = readRaw(key);
  return stored === null ? fallback : stored;
};

/** Ayarı yazar. Yazma başarısızsa sessizce geçilir. */
export const writePref = (key: string, value: string): void => {
  writeRaw(key, value);
};
