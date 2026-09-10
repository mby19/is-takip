import { useState, useEffect, useMemo, useRef, memo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  addMonths,
  subMonths,
  isToday,
} from "date-fns";
import { tr } from "date-fns/locale";
import {
  ChevronLeft,
  ChevronRight,
  Check,
  Minus,
  X,
  Users,
  TrendingUp,
  Layers,
  ChevronDown,
} from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { TableSkeleton } from "./ui/skeleton";
import type { DailyMetric, Attendance, Worker } from "../types";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

interface CalendarViewProps {
  onDayClick: (date: string) => void;
  onWorkerClick?: (worker: Worker) => void;
}

const getStatusDot = (status?: string) => {
  const popClass = status ? "animate-status-pop" : "";
  switch (status) {
    case "FULL":
      return (
        <div
          className={`w-6 h-6 rounded-md bg-emerald-100 dark:bg-emerald-500/20 flex items-center justify-center ${popClass}`}
        >
          <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" strokeWidth={3} />
        </div>
      );
    case "HALF":
      return (
        <div
          className={`w-6 h-6 rounded-md bg-amber-100 dark:bg-amber-500/20 flex items-center justify-center ${popClass}`}
        >
          <Minus className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" strokeWidth={3} />
        </div>
      );
    case "ABSENT":
      return (
        <div
          className={`w-6 h-6 rounded-md bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center ${popClass}`}
        >
          <X className="w-3.5 h-3.5 text-rose-500 dark:text-rose-400" strokeWidth={3} />
        </div>
      );
    default:
      return <div className="w-4 h-4 rounded-full border border-border/60" />;
  }
};

const CalendarRow = memo(function CalendarRow({
  dateStr,
  dayName,
  today,
  metric,
  workers,
  attendanceMap,
  onDayClick,
  rowRef,
}: {
  dateStr: string;
  dayName: string;
  today: boolean;
  metric: DailyMetric | undefined;
  workers: readonly Worker[];
  attendanceMap: Record<string, Attendance>;
  onDayClick: (date: string) => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={rowRef}
      onClick={() => onDayClick(dateStr)}
      className={`flex h-12 border-b border-border/40 transition-colors group cursor-pointer active:bg-muted/60 ${
        today ? "bg-primary/4 dark:bg-primary/8" : "hover:bg-muted/30 dark:hover:bg-muted/10"
      }`}
    >
      <div
        className={`w-14 shrink-0 flex items-center justify-center gap-1 border-r sticky left-0 z-50 shadow-[2px_0_5px_rgba(0,0,0,0.03)] transition-colors ${
          today ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
        }`}
      >
        <span className="text-xs font-black">{dateStr.slice(8)}</span>
        <span className={`text-[7px] uppercase font-bold ${today ? "opacity-70" : "opacity-40"}`}>
          {dayName}
        </span>
      </div>

      {workers.map((w) => {
        const att = attendanceMap[`${dateStr}-${w.id}`];
        return (
          <div
            key={w.id}
            className="w-20 shrink-0 overflow-hidden flex items-center justify-center border-r border-border/30"
          >
            {getStatusDot(att?.status)}
          </div>
        );
      })}

      <div className="w-24 shrink-0 flex items-center justify-center transition-all group-hover:bg-black/5 dark:group-hover:bg-white/5">
        {metric && metric.production_amount > 0 ? (
          <div className="bg-primary/10 dark:bg-primary/20 text-primary text-[10px] font-black px-3 py-1 rounded-md flex items-center gap-1.5 shadow-sm border border-primary/10 dark:border-primary/20">
            <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse" />
            {metric.production_amount} <span className="opacity-50 text-[8px]">PALET</span>
          </div>
        ) : (
          <span className="min-w-12 h-11 flex items-center justify-center text-[9px] text-muted-foreground/40 font-black uppercase tracking-widest hover:text-primary transition-colors border border-dashed border-transparent hover:border-primary/30 px-3 py-2 rounded-lg active:bg-muted/30">
            + VERİ
          </span>
        )}
      </div>
    </div>
  );
});

export function CalendarView({ onDayClick, onWorkerClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const workers = useWorkerStore((s) => s.workers);
  const workersLoading = useWorkerStore((s) => s.isLoading);
  const attendances = useAttendanceStore((s) => s.attendances);
  const fetchAttendanceByDateRange = useAttendanceStore((s) => s.fetchAttendanceByDateRange);
  const attLoading = useAttendanceStore((s) => s.isLoading);
  const metrics = useMetricsStore((s) => s.metrics);
  const fetchMetricsByDateRange = useMetricsStore((s) => s.fetchMetricsByDateRange);
  const metricsLoading = useMetricsStore((s) => s.isLoading);

  const isLoading = workersLoading || attLoading || metricsLoading;

  const [isMonthPickerOpen, setIsMonthPickerOpen] = useState(false);
  const [pickerYear, setPickerYear] = useState(currentDate.getFullYear());

  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLDivElement>(null);

  const monthStart = startOfMonth(currentDate);
  const monthEnd = endOfMonth(currentDate);
  const daysInMonth = eachDayOfInterval({ start: monthStart, end: monthEnd });

  useEffect(() => {
    const loadAllData = async () => {
      const startStr = format(monthStart, "yyyy-MM-dd");
      const endStr = format(monthEnd, "yyyy-MM-dd");
      await Promise.all([
        fetchMetricsByDateRange(startStr, endStr),
        fetchAttendanceByDateRange(startStr, endStr),
      ]);
    };
    loadAllData();
  }, [currentDate, fetchMetricsByDateRange, fetchAttendanceByDateRange]);

  // Auto-scroll to today
  useEffect(() => {
    if (
      todayRowRef.current &&
      (isToday(currentDate) || format(currentDate, "yyyy-MM") === format(new Date(), "yyyy-MM"))
    ) {
      setTimeout(() => {
        todayRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 300);
    }
  }, [currentDate, daysInMonth.length, workers.length]);

  useEffect(() => {
    const scrollView = scrollRef.current;
    const headerView = headerRef.current;
    if (!scrollView || !headerView) return;

    const handleScroll = () => {
      headerView.scrollLeft = scrollView.scrollLeft;
    };

    scrollView.addEventListener("scroll", handleScroll);

    const resizeObserver = new ResizeObserver(() => {
      headerView.scrollLeft = scrollView.scrollLeft;
    });
    resizeObserver.observe(scrollView);

    return () => {
      scrollView.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

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

  const animPalet = useAnimatedCounter(dashboardStats.totalProd, "palet");
  const animRevenue = useAnimatedCounter(dashboardStats.totalRev, "revenue");

  /** İsme göre dinamik font size — uzun isimler sığsın diye */
  const nameFontSize = (name: string) => {
    const len = name.split(" ")[0].length;
    if (len <= 5) return 9;
    if (len <= 7) return 8;
    if (len <= 9) return 7.5;
    return 6.5;
  };

  if (workers.length === 0) {
    if (isLoading) {
      return <TableSkeleton rows={6} cols={4} />;
    }
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center space-y-4 bg-background animate-scale-in">
        <div className="w-24 h-24 bg-primary/10 rounded-full flex items-center justify-center mb-2 animate-float">
          <Users className="w-12 h-12 text-primary opacity-50" />
        </div>
        <h2 className="text-xl font-black tracking-tight">Henüz Çalışan Yok</h2>
        <p className="text-sm text-muted-foreground font-medium max-w-62.5 leading-relaxed">
          İş takibine başlamak için <strong className="text-foreground">Kişiler</strong> sekmesinden
          çalışan ekleyebilirsiniz.
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col w-full min-h-0 bg-background overflow-hidden relative stagger-children">
      {/* HEADER */}
      <div className="z-50 bg-card border-b flex flex-col shrink-0 shadow-sm">
        {/* Ay Navigasyonu */}
        <div className="px-4 py-2.5 flex items-center justify-between">
          <button
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-90 transition-all hover:bg-muted"
          >
            <ChevronLeft className="w-5 h-5 text-muted-foreground" />
          </button>

          <Dialog
            open={isMonthPickerOpen}
            onOpenChange={(open) => {
              setIsMonthPickerOpen(open);
              if (open) setPickerYear(currentDate.getFullYear());
            }}
          >
            <DialogTrigger asChild>
              <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg hover:bg-muted active:scale-95 transition-all group">
                <h2 className="text-sm font-bold capitalize tracking-tight text-foreground group-hover:text-primary transition-colors">
                  {format(currentDate, "MMMM yyyy", { locale: tr })}
                </h2>
                <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors" />
              </button>
            </DialogTrigger>
            <DialogContent className="rounded-[28px] border-none shadow-2xl max-w-xs w-[90%] p-6">
              <DialogHeader className="mb-4">
                <DialogTitle className="text-center font-black text-lg">Dönem Seçimi</DialogTitle>
              </DialogHeader>

              <div className="flex items-center justify-between bg-muted/30 rounded-2xl p-1.5 mb-5 border border-border/50">
                <button
                  onClick={() => setPickerYear((y) => y - 1)}
                  className="w-12 h-10 flex items-center justify-center rounded-xl hover:bg-background shadow-sm active:scale-90 transition-all text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-lg font-black text-primary">{pickerYear}</div>
                <button
                  onClick={() => setPickerYear((y) => y + 1)}
                  className="w-12 h-10 flex items-center justify-center rounded-xl hover:bg-background shadow-sm active:scale-90 transition-all text-muted-foreground hover:text-foreground"
                >
                  <ChevronRight className="w-5 h-5" />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-2.5">
                {[
                  "Ocak",
                  "Şubat",
                  "Mart",
                  "Nisan",
                  "Mayıs",
                  "Haziran",
                  "Temmuz",
                  "Ağustos",
                  "Eylül",
                  "Ekim",
                  "Kasım",
                  "Aralık",
                ].map((m, index) => {
                  const isCurrentSelection =
                    currentDate.getMonth() === index && currentDate.getFullYear() === pickerYear;
                  return (
                    <button
                      key={m}
                      onClick={() => {
                        const newDate = new Date(pickerYear, index, 1);
                        setCurrentDate(newDate);
                        setIsMonthPickerOpen(false);
                      }}
                      className={`h-12 rounded-2xl text-xs font-black transition-all active:scale-95 border-2 border-transparent ${
                        isCurrentSelection
                          ? "bg-primary text-primary-foreground shadow-lg shadow-primary/20"
                          : "bg-muted/40 text-muted-foreground hover:bg-muted hover:border-border"
                      }`}
                    >
                      {m}
                    </button>
                  );
                })}
              </div>
            </DialogContent>
          </Dialog>

          <button
            onClick={() => setCurrentDate(addMonths(currentDate, 1))}
            className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-90 transition-all hover:bg-muted"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Mini Dashboard */}
        <div className="px-4 pb-3 grid grid-cols-2 gap-2">
          <div className="bg-primary/5 rounded-xl p-2 flex flex-col items-center justify-center border border-primary/10">
            <Layers className="w-3.5 h-3.5 text-primary mb-1" />
            <div className="text-[9px] font-bold text-muted-foreground tracking-widest uppercase">
              Toplam Palet
            </div>
            <div className="text-xs font-black text-primary">
              {animPalet} <span className="text-[9px]">palet</span>
            </div>
          </div>
          <div className="bg-emerald-50 dark:bg-emerald-500/5 rounded-xl p-2 flex flex-col items-center justify-center border border-emerald-100 dark:border-emerald-500/10">
            <TrendingUp className="w-3.5 h-3.5 text-emerald-500 mb-1" />
            <div className="text-[9px] font-bold text-muted-foreground tracking-widest uppercase">
              Toplam Kazanç
            </div>
            <div className="text-xs font-black text-emerald-600 dark:text-emerald-400">
              ₺{animRevenue.toLocaleString("tr-TR")}
            </div>
          </div>
        </div>

        {/* Lejant */}
        <div className="flex justify-center gap-5 py-1.5 text-[8px] font-bold uppercase tracking-wider text-muted-foreground border-t border-border/50 bg-muted/10">
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-teal-500" /> Tam
          </div>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-amber-400" /> Yarım
          </div>
          <div className="flex items-center gap-1">
            <div className="w-1.5 h-1.5 rounded-full bg-rose-400" /> Yok
          </div>
        </div>

        {/* Tablo Başlığı */}
        <div ref={headerRef} className="overflow-hidden flex no-scrollbar border-t bg-muted/20">
          <div className="min-w-max flex text-[9px] font-black uppercase tracking-widest text-muted-foreground">
            <div className="w-14 shrink-0 py-3 text-center border-r bg-card sticky left-0 z-50 text-foreground shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
              GÜN
            </div>
            {workers.map((w: Worker) => (
              <div
                key={w.id}
                onClick={() => onWorkerClick && onWorkerClick(w)}
                className="w-20 shrink-0 py-3 text-center border-r truncate px-1 cursor-pointer hover:bg-primary/5 active:bg-primary/10 transition-colors text-foreground hover:text-primary font-black"
                style={{ fontSize: nameFontSize(w.name) }}
              >
                {w.name.split(" ")[0]}
              </div>
            ))}
            <div className="w-24 shrink-0 py-3 text-center text-primary font-bold bg-primary/3">
              PALET
            </div>
          </div>
        </div>
      </div>

      {/* TABLO GÖVDESİ */}
      <div ref={scrollRef} className="flex-1 overflow-auto no-scrollbar pb-24">
        <div className="min-w-max">
          {daysInMonth.map((date: Date) => {
            const dateStr = format(date, "yyyy-MM-dd");
            const metric = metricsMap[dateStr];
            const dayName = format(date, "EEE", { locale: tr });
            const today = isToday(date);

            return (
              <CalendarRow
                key={dateStr}
                dateStr={dateStr}
                dayName={dayName}
                today={today}
                metric={metric}
                workers={workers}
                attendanceMap={attendanceMap}
                onDayClick={onDayClick}
                rowRef={
                  today
                    ? (el) => {
                        (todayRowRef as React.MutableRefObject<HTMLDivElement | null>).current = el;
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}
