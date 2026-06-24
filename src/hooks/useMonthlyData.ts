import { useEffect } from "react";
import { usePaymentStore } from "../stores/paymentStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import type { Attendance, DailyMetric, Payment } from "../types";

interface UseMonthlyDataResult {
  payments: Payment[];
  attendances: Attendance[];
  metrics: DailyMetric[];
  isLoading: boolean;
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function useMonthlyData(
  workerId: number,
  monthStart: Date,
  monthEnd: Date,
): UseMonthlyDataResult {
  const { payments, fetchWorkerPayments, isLoading: payLoading } = usePaymentStore();
  const { attendances, fetchAttendanceByDateRange, isLoading: attLoading } = useAttendanceStore();
  const { metrics, fetchMetricsByDateRange, isLoading: metricsLoading } = useMetricsStore();

  const startStr = formatDate(monthStart);
  const endStr = formatDate(monthEnd);

  useEffect(() => {
    fetchWorkerPayments(workerId);
  }, [workerId, fetchWorkerPayments]);

  useEffect(() => {
    fetchAttendanceByDateRange(startStr, endStr);
    fetchMetricsByDateRange(startStr, endStr);
  }, [startStr, endStr, fetchAttendanceByDateRange, fetchMetricsByDateRange]);

  return {
    payments,
    attendances,
    metrics,
    isLoading: payLoading || attLoading || metricsLoading,
  };
}
