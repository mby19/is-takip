import { startOfMonth, endOfMonth, eachDayOfInterval, format } from "date-fns";
import { tr } from "date-fns/locale";
import type {
  Worker,
  Payment,
  DailyMetric,
  Attendance,
  WorkerRate,
  AttendanceStatus,
} from "../types";
import {
  allocateCents,
  buildRateIndex,
  earningDaySet,
  calculateDailyEarnings,
  rateResolverFromIndex,
  roundMoney,
  type DailyEarnings,
  type RateIndex,
} from "./earningsCalculator";

export interface DailyBreakdown {
  date: string;
  dayName: string;
  dayNum: string;
  status: AttendanceStatus | null;
  earned: number;
}

export interface WorkerStats {
  /** Seçili aydaki hakediş. `dailyBreakdown` gün satırlarının toplamına **birebir** eşittir. */
  totalEarnedInMonth: number;
  /** Seçili ayda yapılan ödemeler. */
  paidInMonth: number;
  /** Dönem bakiyesi: ayın hakedişi − ayın ödemeleri. */
  periodBalance: number;

  /** Verilen tüm veri üzerinden toplam hakediş. */
  totalEarnedAllTime: number;
  /** Tüm zamanların ödemeleri. */
  totalPaid: number;
  /** Kalan borç: tüm hakediş − tüm ödemeler. */
  balance: number;

  dailyBreakdown: DailyBreakdown[];
  fullDays: number;
  halfDays: number;
  absentDays: number;
  holidayDays: number;
}

/**
 * Sık çağrılan hesapların indekslenmiş, önbelleklenmiş hâli.
 *
 * `calculateWorkerStats` ve `calculateBusinessTotals` saf parametrelerle de
 * çalışır (kendi indeksini kurar), fakat **aynı veri kümesi üzerinde birden
 * çok kez** çağrılıyorsa — ör. ay sonu ekranı 60 çalışan için çağırır —
 * bağlam bir kez kurulup paylaşılmalıdır. Aksi hâlde her çağrı tüm kayıtları
 * yeniden indeksler ve tarih → ücret araması her gün × her çalışan için
 * doğrusal tarama yapar (ADR-0009).
 */
export interface WorkerStatsContext {
  /** `YYYY-MM-DD` → o güne ait puantaj kayıtları. */
  readonly attendanceByDate: ReadonlyMap<string, readonly Attendance[]>;
  /** `YYYY-MM-DD` → o güne ait gün verisi. */
  readonly metricByDate: ReadonlyMap<string, DailyMetric>;
  /**
   * Hakedişe esas günler — `earningDaySet` kuralının sonucu. Kişi dökümü ve
   * işletme toplamları bu kümeyi paylaşır (ADR-0009).
   */
  readonly earningDays: ReadonlySet<string>;
  /** Ortak havuzunun tamamı — tüm çalışanlar (arşivlenmişler dahil). */
  readonly workers: readonly Worker[];
  /**
   * Ortak havuzu. Çalışan `workers` içindeyse dizinin **kendisi** döner
   * (klon alınmaz); değilse listeye eklenmiş ve önbelleklenmiş hali döner.
   */
  poolFor(worker: Worker): readonly Worker[];
  /**
   * Bir günün hakediş sonucu, hesaplanmış ve önbelleklenmiş.
   * Sonuç **havuza** bağlıdır: havuzdaki çalışan kümesi kârı değiştirir.
   */
  dayEarnings(pool: readonly Worker[], date: string): DailyEarnings;
}

export function createWorkerStatsContext(
  attendances: readonly Attendance[],
  metrics: readonly DailyMetric[],
  workers: readonly Worker[],
  rateHistory: readonly WorkerRate[] = [],
): WorkerStatsContext {
  const attendanceByDate = new Map<string, Attendance[]>();
  for (const row of attendances) {
    const key = String(row.date).trim();
    const bucket = attendanceByDate.get(key);
    if (bucket) bucket.push(row);
    else attendanceByDate.set(key, [row]);
  }

  const metricByDate = new Map<string, DailyMetric>();
  for (const m of metrics) metricByDate.set(String(m.date).trim(), m);

  // Hakedişe esas günler: gün verisi ya da puantajı olan gün (tek kural).
  const earningDays = earningDaySet(metrics, attendances);

  // Tarih etkili ücret geçmişi worker_id + tarih anahtarına göre bir kez
  // indekslenir; her gün için doğrusal tarama yapılmaz (ADR-0009).
  const rateIndex: RateIndex = buildRateIndex(rateHistory);
  const statusMaps = new Map<string, Record<number, AttendanceStatus | null>>();
  // Havuz klonu: listede varsa hiç klonlanmaz, yoksa çalışan başına bir kez
  // yapılıp önbelleklenir (ADR-0009, CC6).
  const extraPools = new Map<number, readonly Worker[]>();
  const poolCache = new WeakMap<readonly Worker[], Map<string, DailyEarnings>>();

  const poolFor = (worker: Worker): readonly Worker[] => {
    if (workers.some((w) => Number(w.id) === Number(worker.id))) return workers;
    const id = Number(worker.id);
    const cached = extraPools.get(id);
    if (cached) return cached;
    const pool: readonly Worker[] = [...workers, worker];
    extraPools.set(id, pool);
    return pool;
  };

  const statusMapFor = (date: string): Record<number, AttendanceStatus | null> => {
    const cached = statusMaps.get(date);
    if (cached) return cached;
    const map: Record<number, AttendanceStatus | null> = {};
    for (const a of attendanceByDate.get(date) ?? []) map[Number(a.worker_id)] = a.status;
    statusMaps.set(date, map);
    return map;
  };

  const dayEarnings = (pool: readonly Worker[], date: string): DailyEarnings => {
    let byDate = poolCache.get(pool);
    if (!byDate) {
      byDate = new Map<string, DailyEarnings>();
      poolCache.set(pool, byDate);
    }
    const hit = byDate.get(date);
    if (hit) return hit;

    const metric = metricByDate.get(date);
    const result = calculateDailyEarnings(
      pool,
      statusMapFor(date),
      metric?.total_earned ?? 0,
      metric?.extra_expenses ?? 0,
      rateResolverFromIndex(rateIndex, date),
    );
    byDate.set(date, result);
    return result;
  };

  return { attendanceByDate, metricByDate, earningDays, workers, dayEarnings, poolFor };
}

/**
 * İşletme bazlı dönem toplamları: yevmiye maliyeti ve net kâr.
 *
 * **Gün kümesi kuralı (ADR-0009):** hakedişe esas günler, dönem içinde
 * `daily_metrics` satırı olan **veya** en az bir puantaj kaydı olan günlerdir.
 * `calculateWorkerStats` da aynı kümeyi kullanır; böylece kişi bazlı
 * `totalEarnedInMonth` ile işletme bazlı `netProfit` aynı gerçeği anlatır.
 * Yalnız `daily_metrics` satırı olan günlerle sınırlı kalmak, puantajı olup
 * cirosu girilmemiş günlerin yevmiyesini ve zararını işletme toplamından
 * düşürür, iki tarafı ayırırdı.
 *
 * **Dağıtılmayan kuralı (K3, ADR-0009):** dönemdeki `undistributed`,
 * ortaklara **dağıtılmayan** net kâr/zararın toplamıdır (işaretli). Zararlı
 * günde ortak payı 0'a düştüğü için zarar burada toplanır; kârlı günde
 * **aktif ortak yoksa** kâr da burada toplanır — o para ne dağıtılır ne de
 * kaybolur. Kişi hakedişleri toplamı `wageCost + netProfit − undistributed`
 * olur; kâr gerçekten dağıtılan günlerde `undistributed = 0` olduğu için bu
 * eski `wageCost + netProfit` kuralıyla aynıdır.
 */
export function calculateBusinessTotals(
  context: WorkerStatsContext,
  periodPrefix: string,
  workers: readonly Worker[] = context.workers,
): { wageCost: number; netProfit: number; undistributed: number; days: number } {
  const periodDays: string[] = [];
  for (const date of context.earningDays) {
    if (date.startsWith(periodPrefix)) periodDays.push(date);
  }
  periodDays.sort();

  let wageCost = 0;
  let netProfit = 0;
  let undistributed = 0;
  for (const date of periodDays) {
    const day = context.dayEarnings(workers, date);
    wageCost += day.totalWorkerCosts;
    netProfit += day.netProfit;
    undistributed += day.undistributed;
  }

  return {
    wageCost: roundMoney(wageCost),
    netProfit: roundMoney(netProfit),
    undistributed: roundMoney(undistributed),
    days: periodDays.length,
  };
}

/**
 * Bir çalışanın ay + tüm zamanlar istatistikleri.
 *
 * `context` verilmezse verilen dizilerden kendisi kurulur (tek çağrı için
 * doğru, çok çağrı için yavaş). Ay sonu gibi **birden çok çalışan üzerinde
 * çağrılan** yerler `createWorkerStatsContext` ile tek bağlam paylaşmalıdır.
 */
export function calculateWorkerStats(
  worker: Worker,
  currentMonth: Date,
  metrics: readonly DailyMetric[],
  attendances: readonly Attendance[],
  workers: readonly Worker[],
  payments: readonly Payment[],
  rateHistory: readonly WorkerRate[] = [],
  context?: WorkerStatsContext,
): WorkerStats {
  const ctx = context ?? createWorkerStatsContext(attendances, metrics, workers, rateHistory);
  const workerId = Number(worker.id);
  const poolWorkers = ctx.poolFor(worker);
  const monthPrefix = format(currentMonth, "yyyy-MM");

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  const breakdown: DailyBreakdown[] = [];
  const raws: number[] = [];

  for (const day of days) {
    const dateStr = format(day, "yyyy-MM-dd");
    const rows = ctx.attendanceByDate.get(dateStr) ?? [];
    const mine = rows.find((a) => Number(a.worker_id) === workerId);
    const status = mine?.status ?? null;

    // Yevmiyeli personel gün verisi (ciro) girilmemiş olsa da ücretini hak
    // eder; ortak payı ise o günün ciro/gideri ne ise ona göre oluşur.
    const earned =
      status === "FULL" || status === "HALF"
        ? (ctx.dayEarnings(poolWorkers, dateStr).individualEarnings[workerId] ?? 0)
        : 0;

    raws.push(earned);
    breakdown.push({
      date: dateStr,
      dayName: format(day, "EEE", { locale: tr }),
      dayNum: format(day, "dd"),
      status,
      earned: 0,
    });
  }

  // Tek yuvarlama kuralı (ADR-0009): gün satırları ham toplamdan **kuruş
  // tahsis** edilir. Toplam korunur, kalan payı en büyük gün 1'er kuruş alır.
  // Böylece gün satırlarının toplamı gösterilen toplamla her zaman tutar;
  // 3 × 33,33 = 99,99 gibi kuruş kaybı ya da fazlası oluşmaz.
  const allocated = allocateCents(raws);
  let totalEarnedInMonth = 0;
  for (let i = 0; i < breakdown.length; i++) {
    breakdown[i].earned = allocated[i];
    totalEarnedInMonth += allocated[i];
  }

  // Tüm zamanların hakedişi: bu çalışanın puantaj kaydı olan her gün.
  let rawAllTime = 0;
  for (const [dateStr, rows] of ctx.attendanceByDate) {
    const mine = rows.find((a) => Number(a.worker_id) === workerId);
    if (!mine || (mine.status !== "FULL" && mine.status !== "HALF")) continue;
    rawAllTime += ctx.dayEarnings(poolWorkers, dateStr).individualEarnings[workerId] ?? 0;
  }

  let totalPaidRaw = 0;
  let paidInMonthRaw = 0;
  for (const p of payments) {
    if (Number(p.worker_id) !== workerId) continue;
    const amount = Number(p.amount || 0);
    totalPaidRaw += amount;
    if (String(p.date).startsWith(monthPrefix)) paidInMonthRaw += amount;
  }
  const totalPaid = roundMoney(totalPaidRaw);
  const paidInMonth = roundMoney(paidInMonthRaw);
  const totalEarnedAllTime = roundMoney(rawAllTime);

  let fullDays = 0;
  let halfDays = 0;
  let absentDays = 0;
  let holidayDays = 0;
  for (const row of breakdown) {
    if (row.status === "FULL") fullDays++;
    else if (row.status === "HALF") halfDays++;
    else if (row.status === "ABSENT") absentDays++;
    else if (row.status === "HOLIDAY") holidayDays++;
  }

  return {
    totalEarnedInMonth: roundMoney(totalEarnedInMonth),
    paidInMonth,
    periodBalance: roundMoney(roundMoney(totalEarnedInMonth) - paidInMonth),

    totalEarnedAllTime,
    totalPaid,
    balance: roundMoney(totalEarnedAllTime - totalPaid),

    dailyBreakdown: breakdown,
    fullDays,
    halfDays,
    absentDays,
    holidayDays,
  };
}
