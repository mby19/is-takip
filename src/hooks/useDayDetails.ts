import { useState, useMemo, useEffect } from "react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import type { Attendance, DailyMetric, Worker } from "../types";

interface UseDayDetailsResult {
  workers: Worker[];
  attendances: Attendance[];
  metric: DailyMetric | undefined;
  production: number;
  totalEarned: number;
  extraExpenses: number;
  isHoliday: boolean;
  setProduction: (v: number) => void;
  setTotalEarned: (v: number) => void;
  setExtraExpenses: (v: number) => void;
  setIsHoliday: (v: boolean) => void;
  markAttendance: (
    worker_id: number,
    date: string,
    status: "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null,
    workerName?: string,
  ) => Promise<void>;
  saveMetrics: () => Promise<void>;
}

export function useDayDetails(dateStr: string | null): UseDayDetailsResult {
  const { workers: allWorkers } = useWorkerStore();
  const { attendances, markAttendance } = useAttendanceStore();
  const { metrics, updateMetrics, fetchMetricsByDate } = useMetricsStore();

  const workers = useMemo(() => allWorkers.filter((w) => w.is_active !== false), [allWorkers]);

  const metric = useMemo(
    () =>
      dateStr ? metrics.find((m) => String(m.date).trim() === String(dateStr).trim()) : undefined,
    [metrics, dateStr],
  );

  const [production, setProduction] = useState<number>(0);
  const [totalEarned, setTotalEarned] = useState<number>(0);
  const [extraExpenses, setExtraExpenses] = useState<number>(0);
  const [isHoliday, setIsHoliday] = useState<boolean>(false);

  useEffect(() => {
    if (dateStr) {
      fetchMetricsByDate(dateStr);
    }
  }, [dateStr, fetchMetricsByDate]);

  useEffect(() => {
    if (metric) {
      setProduction(metric.production_amount || 0);
      setTotalEarned(metric.total_earned || 0);
      setExtraExpenses(metric.extra_expenses || 0);
      setIsHoliday(Boolean(metric.is_holiday));
    } else {
      setProduction(0);
      setTotalEarned(0);
      setExtraExpenses(0);
      setIsHoliday(false);
    }
  }, [metric]);

  const saveMetrics = async () => {
    if (!dateStr) return;
    await updateMetrics(dateStr, production, totalEarned, extraExpenses, isHoliday);
  };

  return {
    workers,
    attendances,
    metric,
    production,
    totalEarned,
    extraExpenses,
    isHoliday,
    setProduction,
    setTotalEarned,
    setExtraExpenses,
    setIsHoliday,
    markAttendance,
    saveMetrics,
  };
}
