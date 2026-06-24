import { useEffect, useMemo } from "react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import type { Attendance, DailyMetric, Worker } from "../types";

interface DashboardStats {
  totalProd: number;
  totalRev: number;
}

interface UseWorkerDashboardResult {
  workers: Worker[];
  attendances: Attendance[];
  metrics: DailyMetric[];
  isLoading: boolean;
  attendanceMap: Record<string, Attendance>;
  metricsMap: Record<string, DailyMetric>;
  dashboardStats: DashboardStats;
}

export function useWorkerDashboard(monthStart: Date, monthEnd: Date): UseWorkerDashboardResult {
  const { workers, isLoading: workersLoading } = useWorkerStore();
  const { attendances, fetchAttendanceByDateRange, isLoading: attLoading } = useAttendanceStore();
  const { metrics, fetchMetricsByDateRange, isLoading: metricsLoading } = useMetricsStore();

  useEffect(() => {
    const startStr = formatDate(monthStart);
    const endStr = formatDate(monthEnd);
    Promise.all([
      fetchMetricsByDateRange(startStr, endStr),
      fetchAttendanceByDateRange(startStr, endStr),
    ]);
  }, [monthStart, monthEnd, fetchMetricsByDateRange, fetchAttendanceByDateRange]);

  const attendanceMap = useMemo(() => {
    const map: Record<string, Attendance> = {};
    attendances.forEach((a) => {
      const key = `${String(a.date).trim()}-${String(a.worker_id).trim()}`;
      map[key] = a;
    });
    return map;
  }, [attendances]);

  const metricsMap = useMemo(() => {
    const map: Record<string, DailyMetric> = {};
    metrics.forEach((m) => {
      if (m.date) map[String(m.date).trim()] = m;
    });
    return map;
  }, [metrics]);

  const dashboardStats = useMemo(() => {
    let totalProd = 0;
    let totalRev = 0;
    metrics.forEach((m) => {
      totalProd += m.production_amount || 0;
      totalRev += m.total_earned || 0;
    });
    return { totalProd, totalRev };
  }, [metrics]);

  return {
    workers,
    attendances,
    metrics,
    isLoading: workersLoading || attLoading || metricsLoading,
    attendanceMap,
    metricsMap,
    dashboardStats,
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
