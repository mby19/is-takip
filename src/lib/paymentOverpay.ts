/**
 * Bakiye aşımı hesabı — SAF, tek kaynak.
 *
 * Hem `paymentStore.addPayment` (yazma yolu) hem ödeme diyaloğu (onay
 * metni) bu dosyayı kullanır; iki yol ayrı hesaplarsa "ekranda uyarı
 * yoktu ama store reddetti" gibi çelişkili durumlar doğar.
 */

/** Aşım toleransı oranı — bakiyenin bu kadarına kadar soru sorulmaz. */
export const OVERPAY_RATE = 0.2;

/**
 * Taban tolerans (₺).
 *
 * Neden sabit bir taban var: oran tek başına yetmez. Bakiye 0 olan yeni
 * çalışana ilk gün avansı verilir ve bu meşrudur; `%20 × 0 = 0` eşiği
 * her avansta onay diyaloğu açardı.
 *
 * Neden `%20` var: saha ödemeleri puantaj girişinin geciktiği günlerde
 * yapılır, kuruş yuvarlaması ve gün sayımı farkları bakiyeyi küçük
 * miktarlarda aşabilir. Kuruş düzeyinde bir eşik her hafta yanlış
 * alarm üretir.
 *
 * Neden bu ikisi birlikte: `max(bakiye × %20, 2.000 TL)` — küçük
 * bakiyede meşru avansı geçirir, büyük bakiyede hata payını genişletir.
 * Örnek: 50.000 ₺ bakiyeye 500.000 ₺ ödeme → 450.000 ₺ aşım, eşiğin 45
 * katı → kesinlikle onay ister. Buna karşılık 50.000 ₺ bakiyeye 55.000 ₺
 * ödeme (5.000 ₺ avans) onaysız geçer.
 */
export const OVERPAY_FLOOR = 2000;

/**
 * Ödeme bakiyeyi ne kadar aşıyor?
 *
 * @returns Aşan tutar (₺). Tolerans içindeyse `0`.
 */
export function overpayExcess(balance: number, amount: number): number {
  const tolerance = Math.max(balance * OVERPAY_RATE, OVERPAY_FLOOR);
  const excess = amount - balance - tolerance;
  return excess > 0 ? excess : 0;
}
