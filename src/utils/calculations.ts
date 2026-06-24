import { startOfMonth, endOfMonth, eachDayOfInterval, format } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Payment, DailyMetric, Attendance } from "../types";

export interface DailyBreakdown {
  date: string;
  dayName: string;
  dayNum: string;
  status: string | null;
  earned: number;
}

export interface WorkerStats {
  totalEarnedInMonth: number;
  totalPaid: number;
  balance: number;
  dailyBreakdown: DailyBreakdown[];
  fullDays: number;
  halfDays: number;
  absentDays: number;
}

export function calculateWorkerStats(
  worker: Worker,
  currentMonth: Date,
  metrics: DailyMetric[],
  attendances: Attendance[],
  workers: Worker[],
  payments: Payment[],
): WorkerStats {
  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(currentMonth);
  const days = eachDayOfInterval({ start: monthStart, end: monthEnd });

  let totalEarnedInMonth = 0;
  const dailyBreakdown: DailyBreakdown[] = [];

  days.forEach((day) => {
    const dateStr = format(day, "yyyy-MM-dd");
    const metric = metrics.find((m) => m.date === dateStr);
    const dayAttendances = attendances.filter((a) => a.date === dateStr);

    const myAttendance = dayAttendances.find((a) => a.worker_id === worker.id);
    const status = myAttendance?.status || null;
    let dayEarned = 0;

    if (myAttendance && (myAttendance.status === "FULL" || myAttendance.status === "HALF")) {
      const weight = myAttendance.status === "FULL" ? 1 : 0.5;

      if (worker.worker_type === "GUNLUK") {
        dayEarned = worker.daily_wage * weight;
      } else {
        if (metric) {
          const netRevenue = metric.total_earned - metric.extra_expenses;

          let dailyWagesTotal = 0;
          dayAttendances.forEach((a) => {
            const w = workers.find((work) => work.id === a.worker_id);
            if (w && w.worker_type === "GUNLUK") {
              const wWeight = a.status === "FULL" ? 1 : a.status === "HALF" ? 0.5 : 0;
              dailyWagesTotal += w.daily_wage * wWeight;
            }
          });

          const pool = netRevenue - dailyWagesTotal;

          const partnersPresent = dayAttendances.filter((a) => {
            const w = workers.find((work) => work.id === a.worker_id);
            return w && w.worker_type === "ORTAK" && (a.status === "FULL" || a.status === "HALF");
          });

          let totalPartnerWeight = 0;
          partnersPresent.forEach((p) => {
            totalPartnerWeight += p.status === "FULL" ? 1 : 0.5;
          });

          if (totalPartnerWeight > 0) {
            dayEarned = (pool / totalPartnerWeight) * weight;
          }
        }
      }

      totalEarnedInMonth += dayEarned;
    }

    dailyBreakdown.push({
      date: dateStr,
      dayName: format(day, "EEE", { locale: tr }),
      dayNum: format(day, "dd"),
      status,
      earned: Math.round(dayEarned),
    });
  });

  const totalPaid = payments.reduce((sum, p) => sum + p.amount, 0);
  const fullDays = dailyBreakdown.filter((d) => d.status === "FULL").length;
  const halfDays = dailyBreakdown.filter((d) => d.status === "HALF").length;
  const absentDays = dailyBreakdown.filter((d) => d.status === "ABSENT").length;

  return {
    totalEarnedInMonth: Math.round(totalEarnedInMonth),
    totalPaid,
    balance: Math.round(totalEarnedInMonth - totalPaid),
    dailyBreakdown,
    fullDays,
    halfDays,
    absentDays,
  };
}
