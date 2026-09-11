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
import { calculateDailyEarnings, rateResolverFor } from "./earningsCalculator";

export interface DailyBreakdown {
  date: string;
  dayName: string;
  dayNum: string;
  status: string | null;
  earned: number;
}

export interface WorkerStats {
  /** Seçili aydaki hakediş. */
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

/** Gün bazında hızlı erişim için tarih → o güne ait kayıtlar dizini. */
function indexByDate<T extends { date: string }>(rows: readonly T[]): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const key = String(row.date).trim();
    const bucket = map.get(key);
    if (bucket) bucket.push(row);
    else map.set(key, [row]);
  }
  return map;
}

export function calculateWorkerStats(
  worker: Worker,
  currentMonth: Date,
  metrics: readonly DailyMetric[],
  attendances: readonly Attendance[],
  workers: readonly Worker[],
  payments: readonly Payment[],
  rateHistory: readonly WorkerRate[] = [],
): WorkerStats {
  const attendanceByDate = indexByDate(attendances);
  const metricByDate = new Map<string, DailyMetric>();
  for (const m of metrics) metricByDate.set(String(m.date).trim(), m);

  // Ortak payı havuzu tüm ekibi gerektirir; hesaplanan çalışanın listede
  // bulunduğundan emin ol (çağıran yalnızca kişiyi verdiyse de doğru çalışsın).
  const poolWorkers: Worker[] = workers.some((w) => Number(w.id) === Number(worker.id))
    ? [...workers]
    : [...workers, worker];

  /** Tek bir günün, bu çalışan için hakedişini hesaplar. */
  const earnedOn = (dateStr: string): { status: AttendanceStatus | null; earned: number } => {
    const dayAttendances = attendanceByDate.get(dateStr) ?? [];
    const mine = dayAttendances.find((a) => Number(a.worker_id) === Number(worker.id));
    const status = mine?.status ?? null;

    if (!status || (status !== "FULL" && status !== "HALF")) {
      return { status, earned: 0 };
    }

    const metric = metricByDate.get(dateStr);
    const statusMap: Record<number, AttendanceStatus | null> = {};
    for (const a of dayAttendances) statusMap[Number(a.worker_id)] = a.status;

    const result = calculateDailyEarnings(
      poolWorkers,
      statusMap,
      metric?.total_earned ?? 0,
      metric?.extra_expenses ?? 0,
      rateResolverFor(dateStr, rateHistory),
    );

    // Yevmiyeli personel gün verisi girilmemiş olsa da ücretini hak eder;
    // ortak payı ise ancak o günün cirosu girilmişse oluşur.
    const earned = result.individualEarnings[worker.id] ?? 0;
    return { status, earned };
  };

  const days = eachDayOfInterval({
    start: startOfMonth(currentMonth),
    end: endOfMonth(currentMonth),
  });

  let totalEarnedInMonth = 0;
  const dailyBreakdown: DailyBreakdown[] = [];

  for (const day of days) {
    const dateStr = format(day, "yyyy-MM-dd");
    const { status, earned } = earnedOn(dateStr);
    totalEarnedInMonth += earned;

    dailyBreakdown.push({
      date: dateStr,
      dayName: format(day, "EEE", { locale: tr }),
      dayNum: format(day, "dd"),
      status,
      earned: Math.round(earned),
    });
  }

  // Tüm zamanların hakedişi: bu çalışanın puantaj kaydı olan her gün.
  let totalEarnedAllTime = 0;
  for (const [dateStr, rows] of attendanceByDate) {
    if (!rows.some((a) => Number(a.worker_id) === Number(worker.id))) continue;
    totalEarnedAllTime += earnedOn(dateStr).earned;
  }

  const monthPrefix = format(currentMonth, "yyyy-MM");
  const scopedPayments = payments.filter((p) => Number(p.worker_id) === Number(worker.id));

  const totalPaid = scopedPayments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
  const paidInMonth = scopedPayments
    .filter((p) => String(p.date).startsWith(monthPrefix))
    .reduce((sum, p) => sum + Number(p.amount || 0), 0);

  return {
    totalEarnedInMonth: Math.round(totalEarnedInMonth),
    paidInMonth: Math.round(paidInMonth),
    periodBalance: Math.round(totalEarnedInMonth - paidInMonth),

    totalEarnedAllTime: Math.round(totalEarnedAllTime),
    totalPaid: Math.round(totalPaid),
    balance: Math.round(totalEarnedAllTime - totalPaid),

    dailyBreakdown,
    fullDays: dailyBreakdown.filter((d) => d.status === "FULL").length,
    halfDays: dailyBreakdown.filter((d) => d.status === "HALF").length,
    absentDays: dailyBreakdown.filter((d) => d.status === "ABSENT").length,
    holidayDays: dailyBreakdown.filter((d) => d.status === "HOLIDAY").length,
  };
}
