/**
 * Dokunmatik geri bildirimi.
 *
 * Puantaj hücresine her dokunuşta ekranı kapatan bir bildirim yerine parmak
 * altında fiziksel teyit verir: masaüstünde/iOS'ta `navigator.vibrate` YOKTUR
 * ve bu sessizce geçerilmelidir — "titreşim desteklenmiyor" diye göstermek,
 * kullanıcının dokunuşun kaydedilmediğini düşünmesine yol açar.
 *
 * `vibrate` bir güvenlik bağlamı gerektirir; burada çağırmıyoruz ama giriş
 * noktası yine de try/catch ile sarılır: bir tarayıcı bu API'yi "mevcut"
 * gösterip çağrıldığında `NotAllowedError` fırlatabiliyor.
 */

/** Kaydedilen değişiklik — tek kısa darbe. */
const SUCCESS = 15;
/** Hata — iki darbeli kalıp, dokunmatik olarak "olmadı" demenin en ayırt edici yolu. */
const ERROR = [40, 60, 40];

const vibrate = (pattern: number | number[]): boolean => {
  try {
    if (typeof navigator === "undefined") return false;
    if (typeof navigator.vibrate !== "function") return false;
    return navigator.vibrate(pattern);
  } catch {
    // Titreşim bir güzellik katmanı; başarısız olması akışı bozmamalı.
    return false;
  }
};

/** `false` dönerse cihaz titreşimi desteklemiyor ya da izin vermiyor. */
export const hapticSuccess = (): boolean => vibrate(SUCCESS);
export const hapticError = (): boolean => vibrate(ERROR);
