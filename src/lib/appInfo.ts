/**
 * Uygulama sürümü. Derleme sırasında `package.json` içinden gömülür
 * (bkz. vite.config.ts `define`), böylece iki yerde elle güncellenmez.
 */
const definedVersion: string | undefined =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : undefined;

/**
 * `define` eksikse (vite/vitest yapılandırması bozuldu) sürümün bilinmediğini
 * AÇIKÇA belirtiyoruz: eskiden burada sessizce `0.0.0` görünüyordu ve
 * kullanıcı "hangi sürümde olduğunu bilmiyorum" diye hata bildiremiyordu.
 */
export const APP_VERSION: string = definedVersion ?? "bilinmiyor (build yapılandırması eksik)";

export const APP_VERSION_IS_DEFINED: boolean = definedVersion !== undefined;

if (!APP_VERSION_IS_DEFINED && import.meta.env?.DEV) {
  console.error(
    "[appInfo] __APP_VERSION__ define'ı yok. vite.config.ts / vitest.config.ts içindeki " +
      "`define: { __APP_VERSION__: ... }` kaydını kontrol et.",
  );
}
