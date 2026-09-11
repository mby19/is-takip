/**
 * Uygulama sürümü. Derleme sırasında `package.json` içinden gömülür
 * (bkz. vite.config.ts `define`), böylece iki yerde elle güncellenmez.
 */
export const APP_VERSION: string =
  typeof __APP_VERSION__ === "string" && __APP_VERSION__ ? __APP_VERSION__ : "0.0.0";
