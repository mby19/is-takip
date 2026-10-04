import type {
  Worker,
  WorkerRate,
  WorkerType,
  AttendanceStatus,
  Attendance,
  DailyMetric,
} from "../types";

export interface DailyEarnings {
  /** Yevmiyeli personele o gün ödenecek toplam tutar (kuruş hassasiyetinde). */
  totalWorkerCosts: number;
  /** Ciro − gider − yevmiyeler. Ortaklara yalnız kârlı günde dağıtılır. */
  netProfit: number;
  /**
   * **Ortaklara dağıtılmayan tutar** — işaretli, `netProfit` ile aynı işarette.
   *
   * Değişmez (ADR-0009): `Σ ortak payları + undistributed = netProfit`.
   * Bu alan tek doğruluk kaynağıdır ve **iki** durumu kapsar:
   *  - `netProfit < 0` → `undistributed = netProfit` (`-X`). Zarar ortaklara
   *    yazılmaz, işletmenin riskidir (K3 kararı).
   *  - `netProfit > 0` **ama aktif ortak yok** → `undistributed = netProfit`
   *    (`+X`). Kâr ortada kalır; kimseye dağıtılmadığı için kaybolmaz.
   *  - Kâr gerçekten dağıtıldıysa `0`.
   *
   * Yevmiyeli (GUNLUK) ücretler bu kuraldan **etkilenmez**: her koşulda
   * ödenir.
   */
  undistributed: number;
  /** Tam gün çalışan bir ortağın payı (oran; tutar değil). Ortak yoksa/zararda 0. */
  partnerShare: number;
  /**
   * Kişi bazlı hakediş. Yevmiyeli ücretler ve ortak payları **kuruş
   * hassasiyetinde** ve birbirini tamamlayan şekilde dağıtılır:
   * yevmiyeli ücretlerin toplamı `totalWorkerCosts`, ortak paylarının toplamı
   * kârlı günde `netProfit` ile birebir aynıdır; dağıtılmayan fark
   * `undistributed` alanında yüzeye çıkar (ADR-0009).
   */
  individualEarnings: Record<number, number>;
}

export interface EffectiveRate {
  daily_wage: number;
  worker_type: WorkerType;
}

export type RateResolver = (worker: Worker) => EffectiveRate;

/** Durumun kazanç ağırlığı. ABSENT ve kayıtsız gün kazandırmaz. */
export function statusWeight(status: AttendanceStatus | null | undefined): number {
  if (status === "FULL") return 1;
  if (status === "HALF") return 0.5;
  return 0;
}

const ownRate: RateResolver = (w) => ({ daily_wage: w.daily_wage, worker_type: w.worker_type });

/* ------------------------------------------------------------------ *
 * Para hassasiyeti — ADR-0009
 *
 * Para iki ondalıklıdır; float aritmetiği kuruş kaybına/yaratımına yol
 * açar. Tek kural: **ham tutarlar önce hesaplanır, sonra kuruş tahsis
 * edilir.** Tahsis, toplamı korur — en büyük kalan payı alan birimler 1'er
 * kuruş tamamlar. Böylece gün satırlarının toplamı her zaman gösterilen
 * toplama eşit olur ve hiçbir kuruş yoktan yaratılmaz/yok edilmez.
 * ------------------------------------------------------------------ */

/** Tutarı kuruş (0,01) hassasiyetine yuvarlar. `-0` üretmez. */
export function roundMoney(value: number): number {
  const cents = Math.round(value * 100);
  return cents === 0 ? 0 : cents / 100;
}

/**
 * Ham (ondalıklı) tutarları kuruş cinsine tahsis eder.
 *
 * - Her birimin aldığı taban kuruş: `floor(tutar × 100)`.
 * - Kalan kuruş, **kalan payı (kesir) en büyük** birimlere 1'er kuruş
 *   olarak dağıtılır; eşitlikte sıra numarası belirleyicidir (deterministik).
 * - Toplam korunur: `Σ sonuç = round(Σ ham)`.
 * - Sıfır değerli birimler hiçbir zaman kuruş almaz (boş gün kuruş yutamaz).
 * - Negatif tutarlar (zarar) aynı kuralla, kalan payı en küçük birimden
 *   başlayarak kuruş eksiltilerek dağıtılır.
 */
export function allocateCents(raw: readonly number[]): number[] {
  const out = new Array<number>(raw.length).fill(0);
  const slots: number[] = [];
  const floors: number[] = [];
  const fracs: number[] = [];

  for (let i = 0; i < raw.length; i++) {
    const value = Number(raw[i]);
    if (!Number.isFinite(value) || value === 0) continue;
    const scaled = value * 100;
    const base = Math.floor(scaled);
    floors.push(base);
    out[i] = base;
    fracs.push(scaled - base);
    slots.push(i);
  }
  if (slots.length === 0) return out;

  let floorSum = 0;
  let fracSum = 0;
  for (let k = 0; k < floors.length; k++) {
    floorSum += floors[k];
    fracSum += fracs[k];
  }
  // Toplam, taban ve kalan payların toplamından üretilir: tek kaynak, tek kural.
  const totalCents = Math.round(floorSum + fracSum);
  const remaining = totalCents - floorSum;

  const order = fracs.map((f, k) => ({ k, f })).sort((a, b) => b.f - a.f || a.k - b.k);

  if (remaining > 0) {
    const give = Math.min(remaining, order.length);
    for (let n = 0; n < give; n++) out[slots[order[n].k]] += 1;
  } else if (remaining < 0) {
    const take = Math.min(-remaining, order.length);
    for (let n = 0; n < take; n++) out[slots[order[order.length - 1 - n].k]] -= 1;
  }

  return out.map((cents) => (cents === 0 ? 0 : cents / 100));
}

/* ------------------------------------------------------------------ *
 * Gün kümesi kuralı — ADR-0009
 * ------------------------------------------------------------------ */

/**
 * Hakedişe esas gün kümesi — **tek kural**: gün verisi (`daily_metrics`) ya
 * da puantaj kaydı olan gün. Puantajı olup cirosu girilmemiş gün de hakedişe
 * esastır; orada yevmiyeli ücret ödenir, ortak havuzu ne kâr ne zarar görür.
 *
 * Bu saf fonksiyon hem kişi dökümünün hem işletme toplamlarının gün
 * seçimini belirler — iki taraf farklı gün kümesi kullanırsa kişi toplamı
 * ile işletme net kârı tutmaz (ADR-0009).
 */
export function earningDaySet(
  metrics: readonly DailyMetric[],
  attendances: readonly Attendance[],
): ReadonlySet<string> {
  const days = new Set<string>();
  for (const m of metrics) days.add(String(m.date).trim());
  for (const a of attendances) days.add(String(a.date).trim());
  return days;
}

/* ------------------------------------------------------------------ *
 * Tarih etkili ücret çözümleme
 * ------------------------------------------------------------------ */

export interface RateIndex {
  /** worker_id → `valid_from`'e göre artan sıralı kayıtlar. */
  readonly byWorker: ReadonlyMap<number, readonly WorkerRate[]>;
  readonly empty: boolean;
}

/** `rateHistory` dizisini worker_id + tarih anahtarına göre önceden indeksler. */
export function buildRateIndex(history: readonly WorkerRate[]): RateIndex {
  const byWorker = new Map<number, WorkerRate[]>();
  for (const rate of history) {
    const id = Number(rate.worker_id);
    const bucket = byWorker.get(id);
    if (bucket) bucket.push(rate);
    else byWorker.set(id, [rate]);
  }
  for (const bucket of byWorker.values()) {
    bucket.sort((a, b) => {
      if (a.valid_from !== b.valid_from) return a.valid_from < b.valid_from ? -1 : 1;
      return a.id - b.id;
    });
  }
  return { byWorker, empty: history.length === 0 };
}

function resolveFromIndex(index: RateIndex, worker: Worker, date: string): EffectiveRate {
  const rows = index.byWorker.get(Number(worker.id));
  if (!rows || rows.length === 0) return ownRate(worker);

  // `valid_from <= date` olan en büyük kaydı bul (ikili arama → O(log n)).
  let lo = 0;
  let hi = rows.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (String(rows[mid].valid_from) <= date) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (best < 0) return ownRate(worker);
  return { daily_wage: Number(rows[best].daily_wage), worker_type: rows[best].worker_type };
}

/** Önceden kurulmuş indeksten, verilen tarihe ait ücret çözümleyicisi üretir. */
export function rateResolverFromIndex(index: RateIndex, date: string): RateResolver {
  if (index.empty) return ownRate;
  return (worker) => resolveFromIndex(index, worker, date);
}

/**
 * Tarih → çözümleyici fabrikası. Geçmişi **bir kez** indeksler; gün gün
 * çağırmak O(gün × çalışan × kayıt) doğrusal taramayı O(gün × çalışan × log kayıt)
 * yapar (ADR-0009).
 */
export function rateResolverFactory(
  history: readonly WorkerRate[],
): (date: string) => RateResolver {
  const index = buildRateIndex(history);
  return (date) => rateResolverFromIndex(index, date);
}

/**
 * Verilen tarih için ücret çözücü üretir — **tek seferlik** kullanım içindir
 * (bir gün, bir ekip). Geçmişi her çağrıda doğrusal tarar.
 *
 * Birden çok gün üzerinde çalışan çağıran yerler (ay sonu, takvim, gün
 * detayı) bunun yerine `rateResolverFactory(history)` kullanmalıdır: indeks
 * bir kez kurulur, sonraki tarihler ikili aramayla çözülür (ADR-0009).
 */
export function rateResolverFor(date: string, history: readonly WorkerRate[]): RateResolver {
  if (history.length === 0) return ownRate;
  return (worker) => resolveByScan(worker, date, history);
}

/**
 * Bir çalışanın verilen tarihte geçerli ücret/tip bilgisini bulur.
 * Geçmiş kaydı yoksa çalışanın güncel değerlerine düşer.
 */
export function resolveWorkerRate(
  worker: Worker,
  date: string,
  history: readonly WorkerRate[],
): EffectiveRate {
  if (history.length === 0) return ownRate(worker);
  return resolveByScan(worker, date, history);
}

/** Doğrusal tarama — tek seferlik çözümleme için (O(kayıt)). */
function resolveByScan(
  worker: Worker,
  date: string,
  history: readonly WorkerRate[],
): EffectiveRate {
  let best: WorkerRate | null = null;
  for (const rate of history) {
    if (Number(rate.worker_id) !== Number(worker.id)) continue;
    if (String(rate.valid_from) > date) continue;
    if (!best || String(rate.valid_from) > String(best.valid_from)) best = rate;
  }
  if (!best) return ownRate(worker);
  return { daily_wage: Number(best.daily_wage), worker_type: best.worker_type };
}

/* ------------------------------------------------------------------ *
 * Günlük hakediş formülü
 * ------------------------------------------------------------------ */

/**
 * Bir günün hakediş dağılımı.
 *
 * Model: yevmiyeliler önce sabit ücretlerini alır; kalan net kâr
 * (ciro − gider − yevmiyeler) çalışan ortaklar arasında gün ağırlığına göre
 * bölüşülür.
 *
 * **Zarar dağıtılmaz (K3 kararı, ADR-0009).** `netProfit < 0` olduğunda
 * ortakların payı 0'a düşer; zarar `undistributed` alanında işletmede kalır.
 * Yevmiyeli (GUNLUK) ücretler bu kuraldan etkilenmez — her koşulda ödenir.
 *
 * **Aktif ortak yoksa kâr da dağıtılmaz.** Ortak bulunmayan bir günde
 * (ya da hepsi ABSENT olduğunda) kâr havuzu boşta kalır; bu tutar
 * `undistributed` olarak işaretlenerek **raporlanır**. Aksi hâlde kâr ne
 * dağıtılır ne raporlanır ve para sessizce kaybolur.
 *
 * Gün eşiği (net kârın hesaplanıp dağıtılacağı koşul):
 *  1. Günde en az bir kişi aktif çalışıyor olmalı (yevmiyeli veya ortak);
 *  2. Günde **kayıtlı ekonomik hareket** olmalı — ciro veya gider girilmiş
 *     olmalıdır. Puantaj girilmiş ama ciro/gider girilmemiş gün, üretim
 *     girilmemiş bir gündür: yevmiyeli ücretler ödenir, ortak havuzu
 *     ne kâr ne zarar görür. Aksi hâlde eksik veri, ortaklara sahte zarar
 *     yazıyor olurdu.
 *
 * **Değişmez (ADR-0009):**
 *   `Σ ortak payları + undistributed = netProfit`
 * Buna denk olarak tüm kişi hakedişleri:
 *   `Σ individualEarnings = totalWorkerCosts + netProfit − undistributed`
 * Kâr ve sıfır günlerinde `undistributed = 0` olduğu için bu, eski
 * `Σ ortak payları = netProfit` kuralıyla birebir aynıdır.
 *
 * Bu fonksiyon uygulamadaki TEK hakediş formülüdür — hem gün detayı hem aylık
 * döküm buradan geçer.
 */
export function calculateDailyEarnings(
  workers: readonly Worker[],
  attendances: Record<number, AttendanceStatus | null>,
  totalEarned: number,
  extraExpenses: number,
  resolveRate: RateResolver = ownRate,
): DailyEarnings {
  if (workers.length === 0) {
    return {
      totalWorkerCosts: 0,
      netProfit: 0,
      undistributed: 0,
      partnerShare: 0,
      individualEarnings: {},
    };
  }

  const individualEarnings: Record<number, number> = {};
  const dailySlots: number[] = [];
  const dailyCosts: number[] = [];
  const activePartners: { id: number; factor: number }[] = [];

  for (const worker of workers) {
    const factor = statusWeight(attendances[worker.id]);
    const rate = resolveRate(worker);

    if (rate.worker_type === "GUNLUK") {
      dailySlots.push(worker.id);
      dailyCosts.push(rate.daily_wage * factor);
    } else if (rate.worker_type === "ORTAK" && factor > 0) {
      activePartners.push({ id: worker.id, factor });
    }
  }

  // Yevmiyeli ücretler kuruş hassasiyetinde, toplamı korunarak dağıtılır.
  const dailyAllocated = allocateCents(dailyCosts);
  let totalWorkerCosts = 0;
  for (let i = 0; i < dailySlots.length; i++) {
    const amount = dailyAllocated[i];
    individualEarnings[dailySlots[i]] = amount;
    totalWorkerCosts += amount;
  }

  // ABSENT günlerde yevmiye 0'dır; "çalışıldı" sayılması için gerçek
  // maliyete bakılır, kayıt varlığına değil.
  const hasActiveWork = totalWorkerCosts > 0 || activePartners.length > 0;
  const hasActivity = Number(totalEarned) > 0 || Number(extraExpenses) > 0;
  // Brüt kâr kuruş hassasiyetinde; gösterilen "ciro − gider − yevmiye = net"
  // eşitliği her zaman birebir tutar.
  const grossProfit = roundMoney(Number(totalEarned || 0) - Number(extraExpenses || 0));
  const netProfit = hasActiveWork && hasActivity ? roundMoney(grossProfit - totalWorkerCosts) : 0;

  const totalPartnerWeight = activePartners.reduce((sum, p) => sum + p.factor, 0);

  // K3 (ADR-0009): zarar ortaklara yazılmaz — dağıtılabilir havuz
  // max(netProfit, 0). Kâr için ise dağıtılabilir havuz **aktif ortak yoksa**
  // boş kalır; bu para ne dağıtılır ne de kaybolur: `undistributed` **dağıtılan
  // tutarın kendisinden** türetilir (`netProfit − Σ paylar`), böylece
  // değişmez her koşulda yapısal olarak tutar:
  //   `Σ ortak payları + undistributed = netProfit`
  const distributable = netProfit > 0 ? netProfit : 0;
  const partnerShare = totalPartnerWeight > 0 ? distributable / totalPartnerWeight : 0;

  let distributed = 0;
  if (activePartners.length > 0) {
    const shares = allocateCents(activePartners.map((p) => partnerShare * p.factor));
    for (let i = 0; i < activePartners.length; i++) {
      individualEarnings[activePartners[i].id] = shares[i];
      distributed += shares[i];
    }
  }
  const undistributed = roundMoney(netProfit - distributed);

  return { totalWorkerCosts, netProfit, undistributed, partnerShare, individualEarnings };
}
