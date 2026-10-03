/**
 * Bir ücret/tip değişikliğinin geçmişe etkisi.
 *
 * `effectiveFrom` geçmişte bir güne denk geliyorsa `worker_rate_history`'ye
 * yeni bir satır düşer ve o tarihten sonraki TÜM günlerin hakedişi yeni
 * yevmiyeyle yeniden hesaplanır — sessizce. Kilitli bir dönemde de aynı şey
 * olur; eskiden bu yol `ClosedPeriodError` ile engelleniyordu, artık
 * bilinçli düzeltmeye açık (kullanıcı kararı B: uyar, engelleme).
 *
 * Bu modül SAF'tır ve etki hesabının TEK kaynağıdır: ekran da store da bu
 * fonksiyonu çağırır. İki katmanın farklı karar vermesi (bileşen onay
 * diyaloğunu hiç açmadan kalıcı hata göstermesi) tam olarak bu tek
 * kaynağın olmamasından doğuyordu.
 */
import { periodOf, type PeriodKey } from "./period";

export interface RateChangeImpact {
  /** Kullanıcı onayı olmadan değişiklik yapılamaz mı? */
  requiresConfirmation: boolean;
  /** Yeniden hesaplanacak dönemler, eskiden yeniye (`2026-03`, `2026-04`, …). */
  periods: PeriodKey[];
  /** Bunların arasında kilitli olan dönemler. */
  closedPeriods: PeriodKey[];
}

export interface RateChangeImpactInput {
  /** YYYY-MM-DD — değişikliğin geçerli olacağı gün. */
  effectiveFrom: string;
  /** YYYY-MM-DD — bugün. */
  today: string;
  /** Veri bulunan en eski dönem; `null` ise hiç veri yok. */
  earliestDataPeriod: PeriodKey | null;
  /** Kapatılmış dönem anahtarları. */
  closedPeriods: readonly PeriodKey[];
}

const NO_IMPACT: RateChangeImpact = { requiresConfirmation: false, periods: [], closedPeriods: [] };

/** `2026-03` → `2026-04` gibi kalan ay anahtarı. */
function nextPeriod(period: PeriodKey): PeriodKey {
  const [year, month] = period.split("-").map(Number);
  return month >= 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/** `from`…`to` arasındaki ay anahtarları, her iki uç dahil. */
export function periodsInRange(from: PeriodKey, to: PeriodKey): PeriodKey[] {
  const result: PeriodKey[] = [];
  // Bozuk anahtar durumunda sonsuz döngü olmasın: `from` > `to` ise boş.
  if (from > to) return result;
  for (let cursor = from; cursor <= to; cursor = nextPeriod(cursor)) result.push(cursor);
  return result;
}

/**
 * `effectiveFrom` bugünden eskiyse ve etkilenen aralıkta veri varsa onay ister.
 *
 * GÜNCEL AY KİLİTLİ OLABİLİR (`PeriodLockSection` ve `MonthSummaryScreen`
 * üzerinden kapatılır); "güncel ay hiçbir zaman kilitli değildir" varsayımı
 * yanlıştı ve kapalı döneme onaysız ücret geçmişi yazılmasına yol açıyordu.
 * Bu yüzden kilit kontrolü `from`…bugün arasındaki TÜM dönemler için çalışır,
 * güncel ayı da kapsar.
 *
 * Güncel ay KİLİTLİ DEĞİLSE ve değişiklik yalnızca güncel aya düşüyorsa
 * (örn. "bu ayın 12'si") onay yine gerekmez: en sık kullanılan senaryo.
 */
export function rateChangeImpact(input: RateChangeImpactInput): RateChangeImpact {
  const from = periodOf(input.effectiveFrom);
  const current = periodOf(input.today);
  const closed = new Set(input.closedPeriods);

  // Gelecek: geçmişte yeniden hesaplanan dönem yok.
  if (from > current) return NO_IMPACT;

  // Yalnızca güncel ay etkileniyorsa geçmişte hesaplanan hakediş değişmez;
  // tek istisna güncel ayın kendisinin kilitli olmasıdır.
  if (from === current) {
    return closed.has(current)
      ? { requiresConfirmation: true, periods: [current], closedPeriods: [current] }
      : NO_IMPACT;
  }

  // `earliestDataPeriod` bilinmiyorsa etki aralığı hesaplanamaz: fail-closed,
  // en kötü durum (`from`…bugün) varsayılır. `null` "kesinlikle veri yok"
  // demek DEĞİLDİR — liste okunmamış da olabilir; iki katmanın ayrı
  // davranmasının kaynağı buydu.
  const start =
    !input.earliestDataPeriod || input.earliestDataPeriod < from ? from : input.earliestDataPeriod;
  if (start > current) return NO_IMPACT;

  const periods = periodsInRange(start, current);
  return {
    requiresConfirmation: true,
    periods,
    closedPeriods: periods.filter((p) => closed.has(p)),
  };
}

/** Onay diyaloğunda gösterilecek metin. Onay gerektirmiyorsa `null`. */
export function describeRateChangeImpact(impact: RateChangeImpact): string | null {
  if (!impact.requiresConfirmation) return null;
  const base = `${impact.periods.length} dönem etkilenecek: ${impact.periods.join(", ")}`;
  if (impact.closedPeriods.length === 0) return base;
  return `${base} — bunların arasında kilitli olanlar: ${impact.closedPeriods.join(", ")}`;
}
