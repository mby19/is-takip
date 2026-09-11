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
  Palmtree,
  Users,
  TrendingUp,
  Layers,
  ChevronDown,
  Archive,
} from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { TableSkeleton } from "./ui/skeleton";
import type { DailyMetric, Attendance, Worker, AttendanceStatus } from "../types";
import { calculateDailyEarnings, rateResolverFor } from "../utils/earningsCalculator";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "./ui/dialog";

interface CalendarViewProps {
  onDayClick: (date: string) => void;
  onWorkerClick?: (worker: Worker) => void;
}

/** Lejant ile hücreler aynı kaynaktan beslenir — renkler ayrışamaz. */
const STATUS_STYLE: Record<
  AttendanceStatus,
  { label: string; dot: string; box: string; icon: typeof Check; iconClass: string }
> = {
  FULL: {
    label: "Tam",
    dot: "bg-emerald-500",
    box: "bg-emerald-100 dark:bg-emerald-500/20",
    icon: Check,
    iconClass: "text-emerald-600 dark:text-emerald-400",
  },
  HALF: {
    label: "Yarım",
    dot: "bg-amber-500",
    box: "bg-amber-100 dark:bg-amber-500/20",
    icon: Minus,
    iconClass: "text-amber-600 dark:text-amber-400",
  },
  ABSENT: {
    label: "Yok",
    dot: "bg-rose-500",
    box: "bg-rose-100 dark:bg-rose-500/20",
    icon: X,
    iconClass: "text-rose-500 dark:text-rose-400",
  },
  HOLIDAY: {
    label: "İzin",
    dot: "bg-sky-500",
    box: "bg-sky-100 dark:bg-sky-500/20",
    icon: Palmtree,
    iconClass: "text-sky-600 dark:text-sky-400",
  },
};

const STATUS_ORDER: AttendanceStatus[] = ["FULL", "HALF", "ABSENT", "HOLIDAY"];

const getStatusDot = (status?: string) => {
  const style = status ? STATUS_STYLE[status as AttendanceStatus] : undefined;
  if (!style) return <div className="w-4 h-4 rounded-full border border-border/60" />;

  const Icon = style.icon;
  return (
    <div
      className={`w-6 h-6 rounded-md flex items-center justify-center animate-status-pop ${style.box}`}
      title={style.label}
    >
      <Icon className={`w-3.5 h-3.5 ${style.iconClass}`} strokeWidth={3} />
    </div>
  );
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
  const dayLabel = `${dateStr} gününü aç`;

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      aria-label={dayLabel}
      onClick={() => onDayClick(dateStr)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDayClick(dateStr);
        }
      }}
      className={`flex h-12 border-b border-border/40 transition-colors group cursor-pointer active:bg-muted/60 focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 ${
        today ? "bg-primary/4 dark:bg-primary/8" : "hover:bg-muted/30 dark:hover:bg-muted/10"
      }`}
    >
      <div
        className={`w-14 shrink-0 flex items-center justify-center gap-1 border-r sticky left-0 z-30 shadow-[2px_0_5px_rgba(0,0,0,0.03)] transition-colors ${
          today ? "bg-primary text-primary-foreground" : "bg-card text-foreground"
        }`}
      >
        <span className="text-xs font-black">{dateStr.slice(8)}</span>
        <span className={`text-[10px] uppercase font-bold ${today ? "opacity-80" : "opacity-60"}`}>
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
            <div className="w-1.5 h-1.5 rounded-full bg-primary" />
            {metric.production_amount} <span className="opacity-70 text-[10px]">PALET</span>
          </div>
        ) : (
          <span className="min-w-12 h-11 flex items-center justify-center text-[10px] text-muted-foreground/60 font-black uppercase tracking-widest group-hover:text-primary transition-colors px-3 py-2 rounded-lg">
            + VERİ
          </span>
        )}
      </div>
    </div>
  );
});

export function CalendarView({ onDayClick, onWorkerClick }: CalendarViewProps) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [showArchived, setShowArchived] = useState(false);

  const allWorkers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);
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

  const activeWorkers = useMemo(
    () => allWorkers.filter((w) => w.is_active !== false),
    [allWorkers],
  );

  /** Bu ayda kaydı olan arşivlenmiş çalışanlar — istenirse sütun olarak gösterilir. */
  const archivedWithData = useMemo(() => {
    const ids = new Set(attendances.map((a) => Number(a.worker_id)));
    return allWorkers.filter((w) => w.is_active === false && ids.has(w.id));
  }, [allWorkers, attendances]);

  // Sütunlar: varsayılan olarak sadece aktif ekip. Arşivliler isteğe bağlı.
  const columnWorkers = useMemo(
    () => (showArchived ? [...activeWorkers, ...archivedWithData] : activeWorkers),
    [activeWorkers, archivedWithData, showArchived],
  );

  // Hesaplama her zaman tüm ekip üzerinden yapılır (ortak payı doğru kalsın).
  const calcWorkers = useMemo(
    () => [...activeWorkers, ...archivedWithData],
    [activeWorkers, archivedWithData],
  );

  useEffect(() => {
    // Aralık burada hesaplanır: monthStart/monthEnd her render'da yeni Date
    // nesnesi olduğu için bağımlılık listesine konulamaz — effect kendini
    // sonsuz döngüye sokar ve takvim yükleme durumundan hiç çıkmaz.
    const startStr = format(startOfMonth(currentDate), "yyyy-MM-dd");
    const endStr = format(endOfMonth(currentDate), "yyyy-MM-dd");
    void Promise.all([
      fetchMetricsByDateRange(startStr, endStr),
      fetchAttendanceByDateRange(startStr, endStr),
    ]);
  }, [currentDate, fetchMetricsByDateRange, fetchAttendanceByDateRange]);

  useEffect(() => {
    if (format(currentDate, "yyyy-MM") !== format(new Date(), "yyyy-MM")) return;
    const timer = setTimeout(() => {
      todayRowRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => clearTimeout(timer);
  }, [currentDate, daysInMonth.length, columnWorkers.length]);

  useEffect(() => {
    const scrollView = scrollRef.current;
    const headerView = headerRef.current;
    if (!scrollView || !headerView) return;

    const handleScroll = () => {
      headerView.scrollLeft = scrollView.scrollLeft;
    };

    scrollView.addEventListener("scroll", handleScroll);
    const resizeObserver = new ResizeObserver(handleScroll);
    resizeObserver.observe(scrollView);

    return () => {
      scrollView.removeEventListener("scroll", handleScroll);
      resizeObserver.disconnect();
    };
  }, []);

  const attendanceMap = useMemo(() => {
    const map: Record<string, Attendance> = {};
    attendances.forEach((a) => {
      map[`${String(a.date).trim()}-${String(a.worker_id).trim()}`] = a;
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

  /**
   * Ay özeti. "Ciro" ham gelir; "Net Kâr" gider ve yevmiyeler düşüldükten
   * sonra kalan tutar — ikisi ayrı gösterilir, çünkü tek başına ciro
   * kârdan sistematik olarak yüksektir.
   */
  const dashboardStats = useMemo(() => {
    const attendanceByDate = new Map<string, Attendance[]>();
    for (const a of attendances) {
      const key = String(a.date).trim();
      const bucket = attendanceByDate.get(key);
      if (bucket) bucket.push(a);
      else attendanceByDate.set(key, [a]);
    }

    let totalProd = 0;
    let totalRevenue = 0;
    let netProfit = 0;

    for (const metric of metrics) {
      const dateStr = String(metric.date).trim();
      totalProd += metric.production_amount || 0;
      totalRevenue += metric.total_earned || 0;

      const statusMap: Record<number, AttendanceStatus | null> = {};
      for (const a of attendanceByDate.get(dateStr) ?? []) {
        statusMap[Number(a.worker_id)] = a.status;
      }

      netProfit += calculateDailyEarnings(
        calcWorkers,
        statusMap,
        metric.total_earned || 0,
        metric.extra_expenses || 0,
        rateResolverFor(dateStr, rateHistory),
      ).netProfit;
    }

    return { totalProd, totalRevenue, netProfit };
  }, [metrics, attendances, calcWorkers, rateHistory]);

  const animPalet = useAnimatedCounter(dashboardStats.totalProd, "palet");
  const animRevenue = useAnimatedCounter(Math.round(dashboardStats.totalRevenue), "revenue");
  const animProfit = useAnimatedCounter(Math.round(dashboardStats.netProfit), "profit");

  /** Uzun isimler için yazı boyutu — okunabilirlik sınırı 10px. */
  const nameFontSize = (name: string) => {
    const len = name.split(" ")[0].length;
    if (len <= 6) return 11;
    if (len <= 9) return 10;
    return 9;
  };

  if (activeWorkers.length === 0 && archivedWithData.length === 0) {
    if (isLoading) return <TableSkeleton rows={6} cols={4} />;
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
      <div className="z-40 bg-card border-b flex flex-col shrink-0 shadow-sm">
        {/* Ay navigasyonu */}
        <div className="px-4 py-2.5 flex items-center justify-between">
          <button
            onClick={() => setCurrentDate(subMonths(currentDate, 1))}
            aria-label="Önceki ay"
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
                  aria-label="Önceki yıl"
                  className="w-12 h-10 flex items-center justify-center rounded-xl hover:bg-background shadow-sm active:scale-90 transition-all text-muted-foreground hover:text-foreground"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="text-lg font-black text-primary">{pickerYear}</div>
                <button
                  onClick={() => setPickerYear((y) => y + 1)}
                  aria-label="Sonraki yıl"
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
                        setCurrentDate(new Date(pickerYear, index, 1));
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
            aria-label="Sonraki ay"
            className="w-11 h-11 rounded-xl flex items-center justify-center active:scale-90 transition-all hover:bg-muted"
          >
            <ChevronRight className="w-5 h-5 text-muted-foreground" />
          </button>
        </div>

        {/* Ay özeti */}
        <div className="px-4 pb-3 grid grid-cols-3 gap-2">
          <div className="bg-primary/5 rounded-xl p-2 flex flex-col items-center justify-center border border-primary/10">
            <Layers className="w-3.5 h-3.5 text-primary mb-1" />
            <div className="text-[10px] font-bold text-muted-foreground tracking-wide uppercase">
              Palet
            </div>
            <div className="text-xs font-black text-primary font-mono">{animPalet}</div>
          </div>
          <div className="bg-muted/40 rounded-xl p-2 flex flex-col items-center justify-center border">
            <TrendingUp className="w-3.5 h-3.5 text-muted-foreground mb-1" />
            <div className="text-[10px] font-bold text-muted-foreground tracking-wide uppercase">
              Ciro
            </div>
            <div className="text-xs font-black font-mono">
              ₺{animRevenue.toLocaleString("tr-TR")}
            </div>
          </div>
          <div
            className={`rounded-xl p-2 flex flex-col items-center justify-center border ${
              dashboardStats.netProfit < 0
                ? "bg-rose-50 dark:bg-rose-500/5 border-rose-100 dark:border-rose-500/20"
                : "bg-emerald-50 dark:bg-emerald-500/5 border-emerald-100 dark:border-emerald-500/20"
            }`}
          >
            <Wallet2Icon negative={dashboardStats.netProfit < 0} />
            <div className="text-[10px] font-bold text-muted-foreground tracking-wide uppercase">
              Net Kâr
            </div>
            <div
              className={`text-xs font-black font-mono ${
                dashboardStats.netProfit < 0
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              ₺{animProfit.toLocaleString("tr-TR")}
            </div>
          </div>
        </div>

        {/* Lejant */}
        <div className="flex justify-center gap-4 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground border-t border-border/50 bg-muted/10">
          {STATUS_ORDER.map((s) => (
            <div key={s} className="flex items-center gap-1">
              <div className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s].dot}`} />
              {STATUS_STYLE[s].label}
            </div>
          ))}
        </div>

        {archivedWithData.length > 0 && (
          <button
            onClick={() => setShowArchived((v) => !v)}
            aria-pressed={showArchived}
            className="flex items-center justify-center gap-1.5 py-1.5 text-[10px] font-bold uppercase tracking-wide text-muted-foreground border-t border-border/50 hover:bg-muted/30 transition-colors"
          >
            <Archive className="w-3 h-3" />
            {showArchived ? "Arşivlenmişleri gizle" : `Arşivlenmiş (${archivedWithData.length})`}
          </button>
        )}

        {/* Tablo başlığı */}
        <div ref={headerRef} className="overflow-hidden flex no-scrollbar border-t bg-muted/20">
          <div className="min-w-max flex text-[10px] font-black uppercase tracking-wide text-muted-foreground">
            <div className="w-14 shrink-0 py-3 text-center border-r bg-card sticky left-0 z-30 text-foreground shadow-[2px_0_5px_rgba(0,0,0,0.02)]">
              GÜN
            </div>
            {columnWorkers.map((w: Worker) => (
              <button
                key={w.id}
                type="button"
                onClick={() => onWorkerClick?.(w)}
                aria-label={`${w.name} detayını aç`}
                className={`w-20 shrink-0 py-3 text-center border-r truncate px-1 cursor-pointer hover:bg-primary/5 active:bg-primary/10 transition-colors hover:text-primary font-black ${
                  w.is_active === false ? "text-muted-foreground italic" : "text-foreground"
                }`}
                style={{ fontSize: nameFontSize(w.name) }}
                title={w.is_active === false ? `${w.name} (arşivde)` : w.name}
              >
                {w.name.split(" ")[0]}
              </button>
            ))}
            <div className="w-24 shrink-0 py-3 text-center text-primary font-bold bg-primary/3">
              PALET
            </div>
          </div>
        </div>
      </div>

      {/* Tablo gövdesi */}
      <div ref={scrollRef} className="flex-1 overflow-auto no-scrollbar pb-safe-content">
        <div className="min-w-max">
          {daysInMonth.map((date: Date) => {
            const dateStr = format(date, "yyyy-MM-dd");
            return (
              <CalendarRow
                key={dateStr}
                dateStr={dateStr}
                dayName={format(date, "EEE", { locale: tr })}
                today={isToday(date)}
                metric={metricsMap[dateStr]}
                workers={columnWorkers}
                attendanceMap={attendanceMap}
                onDayClick={onDayClick}
                rowRef={
                  isToday(date)
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

/** Net kâr kartının ikonu — işaret durumuna göre renk alır. */
function Wallet2Icon({ negative }: { negative: boolean }) {
  return (
    <TrendingUp
      className={`w-3.5 h-3.5 mb-1 ${negative ? "text-rose-500 rotate-180" : "text-emerald-500"}`}
    />
  );
}
