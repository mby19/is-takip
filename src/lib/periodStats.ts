import { eachDayOfInterval, endOfMonth, format, startOfMonth } from "date-fns";
import { tr } from "date-fns/locale";
import type {
  Attendance,
  AttendanceStatus,
  DailyMetric,
  Payment,
  Worker,
  WorkerRate,
} from "../types";
import type { DailyBreakdown, WorkerStats } from "../utils/calculations";
import {
  allocateCents,
  calculateDailyEarnings,
  rateResolverFor,
  roundMoney,
} from "../utils/earningsCalculator";

/**
 * `worker_rate_history` açılış yılı (`RATE_HISTORY_EPOCH`). Bu yıldan önceye
 * kayıt tutulmadığı için "tüm dönemler" taraması buradan başlar.
 */
export const ALL_TIME_START_YEAR = 2000;

/* ------------------------------------------------------------------ *
 * Dönem penceresi
 * ------------------------------------------------------------------ */

export interface PeriodWindow {
  /** `2026-10` */
  period: string;
  /** `2026-10-01` */
  start: string;
  /** `2026-10-31` */
  end: string;
}

export interface DateRange {
  start: string;
  end: string;
}

/** Ekranda görüntülenen ayın indeksli sorgu için gereken sınırları. */
export function periodWindowOf(date: Date): PeriodWindow {
  return {
    period: format(date, "yyyy-MM"),
    start: format(startOfMonth(date), "yyyy-MM-dd"),
    end: format(endOfMonth(date), "yyyy-MM-dd"),
  };
}

/** `2026-10` → `2026-10-01` ay başı. */
function monthStartOf(period: string): Date {
  const [year, month] = period.split("-").map(Number);
  return new Date(year, (month || 1) - 1, 1);
}

/* ------------------------------------------------------------------ *
 * Ağır tabloları belleğe almadan okuma
 * ------------------------------------------------------------------ */

/**
 * Bir hesapta BİR KEZ kurulan tarih dizini.
 *
 * `calculateWorkerStats` her çağrıda `indexByDate`'i yeniden kuruyordu; 60
 * çalışanlık bir ekranda bu, aynı satırların 60 kez taranması demekti. Burada
 * dizin bir kez kurulur ve tüm çalışanlar arasında paylaşılır.
 */
export interface PeriodIndex {
  attendanceByDate: Map<string, Attendance[]>;
  metricByDate: Map<string, DailyMetric>;
}

export function indexByDate<T extends { date: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(row.date).trim();
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

export function buildPeriodIndex(
  attendance: readonly Attendance[],
  metrics: readonly DailyMetric[],
): PeriodIndex {
  const metricByDate = new Map<string, DailyMetric>();
  for (const m of metrics) metricByDate.set(String(m.date).trim(), m);
  return { attendanceByDate: indexByDate(attendance), metricByDate };
}

/* ------------------------------------------------------------------ *
 * Hakediş — günde bir kez, tüm ekip için
 * ------------------------------------------------------------------ */

export interface PeriodEarnings {
  /** worker_id → dönem içi kazanç (kuruş tahsis edilmiş, ADR-0009). */
  earned: Map<number, number>;
  /** worker_id → günlük döküm. Yalnız `withBreakdown` isteyende dolar. */
  breakdown: Map<number, DailyBreakdown[]>;
  /**
   * Dönemdeki günlerin `netProfit` toplamı (kuruş hassasiyetinde).
   */
  netProfit: number;
  /**
   * Dönemdeki günlerin **ortaklara dağıtılmayan** net kâr/zarar toplamı
   * (işaretli, ADR-0009 / K3). Zararlı günlerde zarar, aktif ortak bulunmayan
   * kârlı günlerde ise kâr burada toplanır — hiçbir para kaybolmaz.
   *
   * Değişmez: `Σ earned + undistributed = netProfit + wageCost`.
   */
  undistributed: number;
  /** Dönemdeki günlerin `totalWorkerCosts` toplamı. */
  wageCost: number;
}

/**
 * Bir ayın hakedişini **tüm çalışanlar için tek geçişte** hesaplar.
 *
 * Para formülü `calculateDailyEarnings`'tır — uygulamadaki tek kaynak
 * (ADR-0009). Buradaki fark yalnızca çalışma biçimi: gün başına bir kez
 * `calculateDailyEarnings` çağrılır ve sonuç `individualEarnings` haritasından
 * her çalışana dağıtılır.
 *
 * **Tek yuvarlama kuralı (ADR-0009 §1):** gün satırları ham (ondalıklı)
 * tutarlar üzerinden toplanır, sonra `allocateCents` ile **kuruş cinsine
 * tahsis edilir**; toplam bu satırların toplamından türetilir. Gün gün
 * `Math.round` yapılırsa ay toplamı gün satırlarının toplamıyla tutmaz —
 * 33,34 TL kazançta satırlar ₺17+₺17=₺34 derken ekran ₺33 gösterirdi.
 *
 * **Dağıtılmayan kural (K3, ADR-0009):** zararlı günde ortak payı 0'a
 * düştüğü ve aktif ortak yoksa kâr dağıtılmadığı için `earned` toplamı o
 * tutarı taşımaz. Tutar `undistributed` alanında ayrılır ve dönemin
 * `netProfit`/`wageCost` toplamlarıyla birlikte tutarlılık değişmezi
 * `Σ earned = wageCost + netProfit − undistributed` korunur.
 */
export function calculatePeriodEarnings(
  pool: readonly Worker[],
  month: Date,
  index: PeriodIndex,
  rateHistory: readonly WorkerRate[] = [],
  withBreakdown = false,
): PeriodEarnings {
  const days = eachDayOfInterval({ start: startOfMonth(month), end: endOfMonth(month) });

  const earned = new Map<number, number>();
  const breakdown = new Map<number, DailyBreakdown[]>();
  // Gün satırları ham tutarlarla toplanır; kuruş tahsisi gün döngüsü
  // BİTTİKTEN SONRA yapılır (ADR-0009 §1 — tek yuvarlama noktası).
  const rawsByWorker: number[][] = pool.map(() => new Array<number>(days.length).fill(0));
  for (const w of pool) {
    earned.set(w.id, 0);
    if (withBreakdown) breakdown.set(w.id, []);
  }

  let netProfit = 0;
  let undistributed = 0;
  let wageCost = 0;

  for (let dayIndex = 0; dayIndex < days.length; dayIndex++) {
    const day = days[dayIndex];
    const dateStr = format(day, "yyyy-MM-dd");
    const rows = index.attendanceByDate.get(dateStr) ?? [];
    const metric = index.metricByDate.get(dateStr);

    const statusMap: Record<number, AttendanceStatus | null> = {};
    for (const row of rows) statusMap[Number(row.worker_id)] = row.status;

    const dayResult = calculateDailyEarnings(
      pool,
      statusMap,
      metric?.total_earned ?? 0,
      metric?.extra_expenses ?? 0,
      rateResolverFor(dateStr, rateHistory),
    );

    netProfit += dayResult.netProfit;
    undistributed += dayResult.undistributed;
    wageCost += dayResult.totalWorkerCosts;

    for (let i = 0; i < pool.length; i++) {
      const w = pool[i];
      const status = statusMap[w.id] ?? null;
      // Yevmiyeli personel gün verisi (ciro) girilmemiş olsa da ücretini hak
      // eder; ortak payı ise o günün ciro/gideri ne ise ona göre oluşur.
      const amount = dayResult.individualEarnings[w.id] ?? 0;
      rawsByWorker[i][dayIndex] = amount;

      if (withBreakdown) {
        breakdown.get(w.id)?.push({
          date: dateStr,
          dayName: format(day, "EEE", { locale: tr }),
          dayNum: format(day, "dd"),
          status,
          earned: 0,
        });
      }
    }
  }

  // Tek yuvarlama noktası: gün satırları ham toplamdan kuruş cinsine
  // tahsis edilir, gösterilen toplam bu satırların toplamıdır.
  for (let i = 0; i < pool.length; i++) {
    const id = pool[i].id;
    const allocated = allocateCents(rawsByWorker[i]);
    const rows = withBreakdown ? breakdown.get(id) : undefined;
    let total = 0;
    for (let d = 0; d < allocated.length; d++) {
      total += allocated[d];
      if (rows) rows[d].earned = allocated[d];
    }
    earned.set(id, roundMoney(total));
  }

  return {
    earned,
    breakdown,
    netProfit: roundMoney(netProfit),
    undistributed: roundMoney(undistributed),
    wageCost: roundMoney(wageCost),
  };
}

/* ------------------------------------------------------------------ *
 * Tüm dönemler — yıl aralıklarıyla akıtılarak
 * ------------------------------------------------------------------ */

/** `toDate`'in bulunduğu yıla kadar, yıl yıl taranacak aralıklar. */
export function allTimeRanges(toDate: Date, fromYear: number = ALL_TIME_START_YEAR): DateRange[] {
  const toYear = toDate.getFullYear();
  const first = Math.max(fromYear, ALL_TIME_START_YEAR);
  const ranges: DateRange[] = [];
  for (let year = first; year <= toYear; year++) {
    ranges.push({ start: `${year}-01-01`, end: `${year}-12-31` });
  }
  return ranges;
}

export interface PeriodData {
  attendance: Attendance[];
  metrics: DailyMetric[];
}

export type PeriodLoader = (range: DateRange) => Promise<PeriodData>;

/**
 * Tüm dönemlerin hakedişini toplar.
 *
 * Tüm tabloyu tek seferde belleğe almak yerine yıl yıl aralık sorgusu
 * yapılır; her yılın satırları hesaplanıp atılır. Böylece bellek kullanımı
 * bir yıllık veriyle sınırlı kalır, sonuç `calculateWorkerStats`'ın
 * `totalEarnedAllTime` değeriyle birebir aynıdır.
 */
export async function accumulateAllTimeEarned(
  pool: readonly Worker[],
  rateHistory: readonly WorkerRate[],
  ranges: readonly DateRange[],
  load: PeriodLoader,
): Promise<Map<number, number>> {
  const totals = new Map<number, number>();
  for (const w of pool) totals.set(w.id, 0);

  for (const range of ranges) {
    const { attendance, metrics } = await load(range);
    if (attendance.length === 0) continue;

    const index = buildPeriodIndex(attendance, metrics);
    const yearStart = monthStartOf(range.start.slice(0, 7));
    for (let i = 0; i < 12; i++) {
      const month = new Date(yearStart.getFullYear(), yearStart.getMonth() + i, 1);
      const { earned } = calculatePeriodEarnings(pool, month, index, rateHistory);
      for (const [id, value] of earned) {
        totals.set(id, (totals.get(id) ?? 0) + value);
      }
    }
  }

  return totals;
}

/* ------------------------------------------------------------------ *
 * Ödemeler — tek doğruluk kaynağı
 * ------------------------------------------------------------------ */

/** Çalışana ait ödemeler. Store hangi çalışanın yüklendiğini bildirse de
 *  burada KİMLİK DAİMA doğrulanır: başka çalışanın ödemesi asla görünmez. */
export function paymentsOfWorker(payments: readonly Payment[], workerId: number): Payment[] {
  return payments.filter((p) => Number(p.worker_id) === Number(workerId));
}

/** Bir çalışanın belirli dönemdeki ödemeleri — bakiye hesabıyla aynı küme. */
export function paymentsInPeriod(
  payments: readonly Payment[],
  workerId: number,
  period: string,
): Payment[] {
  return paymentsOfWorker(payments, workerId).filter((p) =>
    String(p.date).trim().startsWith(period),
  );
}

const sumAmounts = (rows: readonly Payment[]): number =>
  rows.reduce((sum, p) => sum + (Number(p.amount) || 0), 0);

/**
 * Ekranda gösterilen istatistikler.
 *
 * `allTimeEarned` dışarıdan verilir: dönem hakedişi ekranda görüntülenen
 * ayın verisinden, tüm dönem toplamı ise akıtılmış taramadan gelir.
 *
 * Her tutar `roundMoney` ile **kuruş** hassasiyetine iner (`Math.round` tam
 * liraye yuvarlar ve 1.234,56 TL ödemeyi 1.235 TL gösterirdi). Dönem
 * hakedişi `periodEarnings.earned`'dan gelir; o da gün satırlarının kuruş
 * tahsisinden türetildiği için `totalEarnedInMonth === Σ gün satırı`.
 */
export function buildWorkerStats(
  worker: Worker,
  period: string,
  periodEarnings: PeriodEarnings,
  allTimeEarned: number,
  payments: readonly Payment[],
): WorkerStats {
  const breakdown = periodEarnings.breakdown.get(worker.id) ?? [];
  const totalEarnedInMonth = roundMoney(periodEarnings.earned.get(worker.id) ?? 0);

  const totalPaid = roundMoney(sumAmounts(paymentsOfWorker(payments, worker.id)));
  const paidInMonth = roundMoney(sumAmounts(paymentsInPeriod(payments, worker.id, period)));
  const totalEarnedAllTime = roundMoney(allTimeEarned);

  return {
    totalEarnedInMonth,
    paidInMonth,
    periodBalance: roundMoney(totalEarnedInMonth - paidInMonth),

    totalEarnedAllTime,
    totalPaid,
    balance: roundMoney(totalEarnedAllTime - totalPaid),

    dailyBreakdown: breakdown,
    fullDays: breakdown.filter((d) => d.status === "FULL").length,
    halfDays: breakdown.filter((d) => d.status === "HALF").length,
    absentDays: breakdown.filter((d) => d.status === "ABSENT").length,
    holidayDays: breakdown.filter((d) => d.status === "HOLIDAY").length,
  };
}

/* ------------------------------------------------------------------ *
 * Ücret geçmişi
 * ------------------------------------------------------------------ */

/** Çalışanın ücret geçmişi, en yeni geçerlilik önce. */
export function workerRateHistory(
  rateHistory: readonly WorkerRate[],
  workerId: number,
): WorkerRate[] {
  return rateHistory
    .filter((r) => Number(r.worker_id) === Number(workerId))
    .sort((a, b) => String(b.valid_from).localeCompare(String(a.valid_from)));
}

/**
 * Verilen tarihte geçerli olan ücret kaydının **geçerlilik başlangıcı**.
 * Kayıt yoksa `null` — ekranda "tüm geçmiş" anlamına gelir.
 */
export function rateValidFrom(
  rateHistory: readonly WorkerRate[],
  workerId: number,
  date: string,
): string | null {
  let best: WorkerRate | null = null;
  for (const r of rateHistory) {
    if (Number(r.worker_id) !== Number(workerId)) continue;
    const from = String(r.valid_from).trim();
    if (from > date) continue;
    if (!best || from > String(best.valid_from).trim()) best = r;
  }
  return best ? String(best.valid_from).trim() : null;
}

/* ------------------------------------------------------------------ *
 * Ay navigasyonu
 * ------------------------------------------------------------------ */

/**
 * Sonraki aya geçilebilir mi?
 *
 * Gelecek ay için ne puantaj ne ödeme girilebilir; gezinmeye izin vermek
 * kullanıcıya hep boş bir ekran gösterir ve yanlışlıkla yanlış döneme veri
 * yazma ihtimalini artırır.
 */
export function canSelectNextMonth(currentMonth: Date, now: Date = new Date()): boolean {
  const next = new Date(currentMonth.getFullYear(), currentMonth.getMonth() + 1, 1);
  return next.getTime() <= startOfMonth(now).getTime();
}
