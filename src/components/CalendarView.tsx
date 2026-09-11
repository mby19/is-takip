import { useEffect, useMemo, useRef, memo } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, getDay } from "date-fns";
import { tr } from "date-fns/locale";
import { Check, Minus, X, Palmtree, Users, Archive } from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { TableSkeleton } from "./ui/skeleton";
import type { DailyMetric, Attendance, Worker, AttendanceStatus } from "../types";
import { calculateDailyEarnings, rateResolverFor } from "../utils/earningsCalculator";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { periodOfDate } from "../lib/period";

interface CalendarViewProps {
  currentDate: Date;
  onDayClick: (date: string) => void;
  onWorkerClick?: (worker: Worker) => void;
}

/** Lejant ile hücreler aynı kaynaktan beslenir — renkler ayrışamaz. */
const STATUS_STYLE: Record<
  AttendanceStatus,
  { label: string; chip: string; dot: string; icon: typeof Check }
> = {
  FULL: { label: "Tam", chip: "bg-ok-soft text-ok", dot: "bg-ok", icon: Check },
  HALF: { label: "Yarım", chip: "bg-warn-soft text-warn", dot: "bg-warn", icon: Minus },
  ABSENT: { label: "Yok", chip: "bg-bad-soft text-bad", dot: "bg-bad", icon: X },
  HOLIDAY: { label: "İzin", chip: "bg-info-soft text-info", dot: "bg-info", icon: Palmtree },
};

const STATUS_ORDER: AttendanceStatus[] = ["FULL", "HALF", "ABSENT", "HOLIDAY"];

/**
 * Sütun ölçüleri tek yerde. Kişi sütunları boş alanı paylaşır (az kişide
 * genişler), kalabalık ekipte minimumda kalıp yatay kaydırmaya bırakır.
 * Gün ve palet sütunları kenarlara sabitlenir.
 */
const COL = { day: "3.25rem", prod: "4.25rem" };
const WORKER_CELL: React.CSSProperties = { flex: "1 0 3.5rem", minWidth: "3.5rem" };

function StatusCell({ status }: { status?: AttendanceStatus }) {
  const style = status ? STATUS_STYLE[status] : undefined;

  // Boş gün gürültü yapmasın: ince bir nokta yeter.
  if (!style) return <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />;

  const Icon = style.icon;
  return (
    <span
      className={`w-7 h-7 rounded-[0.6rem] flex items-center justify-center ${style.chip}`}
      title={style.label}
    >
      <Icon className="w-4 h-4" strokeWidth={2.75} />
    </span>
  );
}

const CalendarRow = memo(function CalendarRow({
  dateStr,
  dayNum,
  dayName,
  label,
  isWeekend,
  today,
  metric,
  workers,
  attendanceMap,
  onDayClick,
  rowRef,
}: {
  dateStr: string;
  dayNum: string;
  dayName: string;
  label: string;
  isWeekend: boolean;
  today: boolean;
  metric: DailyMetric | undefined;
  workers: readonly Worker[];
  attendanceMap: Record<string, Attendance>;
  onDayClick: (date: string) => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  const production = metric?.production_amount ?? 0;

  return (
    <div
      ref={rowRef}
      role="button"
      tabIndex={0}
      data-date={dateStr}
      aria-label={label}
      onClick={() => onDayClick(dateStr)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onDayClick(dateStr);
        }
      }}
      className={`group flex h-11 items-stretch cursor-pointer transition-colors focus-visible:outline-2 focus-visible:outline-primary focus-visible:-outline-offset-2 ${
        today ? "bg-primary/10" : isWeekend ? "bg-muted/40" : "hover:bg-muted/30"
      }`}
    >
      {/* Gün — sola sabit */}
      <div
        style={{ width: COL.day }}
        className={`shrink-0 sticky left-0 z-20 flex items-center justify-center gap-1 border-b border-r border-border/50 ${
          today ? "bg-primary text-primary-foreground" : isWeekend ? "bg-muted/60" : "bg-surface"
        }`}
      >
        <span className="text-[13px] font-semibold tabular-nums leading-none">{dayNum}</span>
        <span className={`text-[10px] leading-none ${today ? "opacity-80" : "opacity-55"}`}>
          {dayName}
        </span>
      </div>

      {workers.map((w) => (
        <div
          key={w.id}
          style={WORKER_CELL}
          className="flex items-center justify-center border-b border-border/40"
        >
          <StatusCell status={attendanceMap[`${dateStr}-${w.id}`]?.status} />
        </div>
      ))}

      {/* Palet — sağa sabit, hiçbir zaman ekran dışında kalmaz */}
      <div
        style={{ width: COL.prod }}
        className={`shrink-0 sticky right-0 z-20 ml-auto flex items-center justify-center border-b border-l border-border/50 ${
          today ? "bg-primary/10" : isWeekend ? "bg-muted/60" : "bg-surface"
        }`}
      >
        {production > 0 ? (
          <span className="text-[13px] font-semibold tabular-nums text-primary">{production}</span>
        ) : (
          <span className="text-base text-muted-foreground/40 leading-none group-hover:text-primary transition-colors">
            +
          </span>
        )}
      </div>
    </div>
  );
});

export function CalendarView({ currentDate, onDayClick, onWorkerClick }: CalendarViewProps) {
  const allWorkers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);
  const workersLoading = useWorkerStore((s) => s.isLoading);
  const attendances = useAttendanceStore((s) => s.attendances);
  const fetchAttendanceByDateRange = useAttendanceStore((s) => s.fetchAttendanceByDateRange);
  const attLoading = useAttendanceStore((s) => s.isLoading);
  const metrics = useMetricsStore((s) => s.metrics);
  const fetchMetricsByDateRange = useMetricsStore((s) => s.fetchMetricsByDateRange);
  const metricsLoading = useMetricsStore((s) => s.isLoading);
  const closedPeriods = usePeriodStore((s) => s.closed);

  const isLoading = workersLoading || attLoading || metricsLoading;
  const isClosed = closedPeriods.some((c) => c.period === periodOfDate(currentDate));

  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLDivElement>(null);

  const daysInMonth = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) }),
    [currentDate],
  );

  const activeWorkers = useMemo(
    () => allWorkers.filter((w) => w.is_active !== false),
    [allWorkers],
  );

  /** Bu ayda kaydı olan arşivlenmiş çalışanlar — hesaba girer, sütun almaz. */
  const archivedWithData = useMemo(() => {
    const ids = new Set(attendances.map((a) => Number(a.worker_id)));
    return allWorkers.filter((w) => w.is_active === false && ids.has(w.id));
  }, [allWorkers, attendances]);

  const calcWorkers = useMemo(
    () => [...activeWorkers, ...archivedWithData],
    [activeWorkers, archivedWithData],
  );

  useEffect(() => {
    // Aralık burada hesaplanır: startOfMonth/endOfMonth her render'da yeni Date
    // nesnesi üretir, bağımlılık listesine konulursa effect sonsuz döngüye girer.
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
    }, 250);
    return () => clearTimeout(timer);
  }, [currentDate, daysInMonth.length, activeWorkers.length]);

  // Başlık satırı gövdeyle birlikte yatay kayar.
  useEffect(() => {
    const scrollView = scrollRef.current;
    const headerView = headerRef.current;
    if (!scrollView || !headerView) return;

    const sync = () => {
      headerView.scrollLeft = scrollView.scrollLeft;
    };
    scrollView.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(scrollView);
    return () => {
      scrollView.removeEventListener("scroll", sync);
      observer.disconnect();
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

  /** Ay özeti: ciro ham gelir, net kâr gider ve yevmiyeler düşülmüş hâli. */
  const stats = useMemo(() => {
    const byDate = new Map<string, Attendance[]>();
    for (const a of attendances) {
      const key = String(a.date).trim();
      const bucket = byDate.get(key);
      if (bucket) bucket.push(a);
      else byDate.set(key, [a]);
    }

    let production = 0;
    let revenue = 0;
    let netProfit = 0;

    for (const metric of metrics) {
      const dateStr = String(metric.date).trim();
      production += metric.production_amount || 0;
      revenue += metric.total_earned || 0;

      const statusMap: Record<number, AttendanceStatus | null> = {};
      for (const a of byDate.get(dateStr) ?? []) statusMap[Number(a.worker_id)] = a.status;

      netProfit += calculateDailyEarnings(
        calcWorkers,
        statusMap,
        metric.total_earned || 0,
        metric.extra_expenses || 0,
        rateResolverFor(dateStr, rateHistory),
      ).netProfit;
    }

    return { production, revenue, netProfit };
  }, [metrics, attendances, calcWorkers, rateHistory]);

  const animProduction = useAnimatedCounter(stats.production, "palet");
  const animRevenue = useAnimatedCounter(Math.round(stats.revenue), "revenue");
  const animProfit = useAnimatedCounter(Math.round(stats.netProfit), "profit");

  if (activeWorkers.length === 0) {
    if (isLoading) return <TableSkeleton rows={6} cols={4} />;
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-8 text-center gap-4">
        <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
          <Users className="w-9 h-9 text-primary/60" />
        </div>
        <div className="space-y-1.5">
          <h2 className="text-lg font-semibold tracking-tight">Henüz çalışan yok</h2>
          <p className="text-sm text-muted-foreground leading-relaxed max-w-64">
            Puantaj tutmaya başlamak için <span className="text-foreground">Kişiler</span>{" "}
            sekmesinden ekibinizi ekleyin.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
      {/* Ay özeti — kart değil, başlığın devamı niteliğinde ince bir şerit */}
      <div className="px-4 pb-3 bg-surface shrink-0 grid grid-cols-3 gap-3">
        {[
          {
            label: "Palet",
            value: animProduction.toLocaleString("tr-TR"),
            tone: "text-foreground",
          },
          {
            label: "Ciro",
            value: `₺${animRevenue.toLocaleString("tr-TR")}`,
            tone: "text-foreground",
          },
          {
            label: "Net kâr",
            value: `₺${animProfit.toLocaleString("tr-TR")}`,
            tone: stats.netProfit < 0 ? "text-bad" : "text-ok",
          },
        ].map((stat) => (
          <div key={stat.label} className="min-w-0">
            <div className="text-[11px] text-muted-foreground leading-none mb-1">{stat.label}</div>
            <div className={`text-[15px] font-semibold tabular-nums truncate ${stat.tone}`}>
              {stat.value}
            </div>
          </div>
        ))}
      </div>

      {isClosed && (
        <div className="px-4 py-1.5 bg-info-soft text-info text-[11px] font-medium text-center shrink-0">
          Bu dönem kapatıldı — kayıtlar salt okunur
        </div>
      )}

      {/* Lejant */}
      <div className="flex justify-center gap-4 py-1.5 bg-surface text-[11px] text-muted-foreground shrink-0">
        {STATUS_ORDER.map((s) => (
          <span key={s} className="flex items-center gap-1.5">
            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s].dot}`} />
            {STATUS_STYLE[s].label}
          </span>
        ))}
      </div>

      {/* Tablo başlığı */}
      <div ref={headerRef} className="overflow-hidden flex no-scrollbar bg-surface shrink-0">
        <div className="min-w-full flex text-[11px] text-muted-foreground border-y border-border/60">
          <div
            style={{ width: COL.day }}
            className="shrink-0 py-2 text-center sticky left-0 z-20 bg-surface border-r border-border/50"
          >
            Gün
          </div>
          {activeWorkers.map((w) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onWorkerClick?.(w)}
              aria-label={`${w.name} detayını aç`}
              title={w.name}
              style={WORKER_CELL}
              className="py-2 px-0.5 truncate text-foreground/80 hover:text-primary active:scale-95 transition-all"
            >
              {w.name.split(" ")[0]}
            </button>
          ))}
          <div
            style={{ width: COL.prod }}
            className="shrink-0 ml-auto py-2 text-center sticky right-0 z-20 bg-surface border-l border-border/50 text-primary"
          >
            Palet
          </div>
        </div>
      </div>

      {archivedWithData.length > 0 && (
        <div className="px-4 py-1 bg-surface text-[11px] text-muted-foreground flex items-center justify-center gap-1.5 shrink-0 border-b border-border/60">
          <Archive className="w-3 h-3" />
          {archivedWithData.length} arşivlenmiş kişi hesaba dahil
        </div>
      )}

      {/* Gövde */}
      <div ref={scrollRef} className="flex-1 overflow-auto no-scrollbar pb-safe-content">
        <div className="min-w-full">
          {daysInMonth.map((date) => {
            const dateStr = format(date, "yyyy-MM-dd");
            const weekday = getDay(date);
            return (
              <CalendarRow
                key={dateStr}
                dateStr={dateStr}
                dayNum={format(date, "dd")}
                dayName={format(date, "EEEEEE", { locale: tr })}
                label={format(date, "d MMMM EEEE", { locale: tr })}
                isWeekend={weekday === 0 || weekday === 6}
                today={isToday(date)}
                metric={metricsMap[dateStr]}
                workers={activeWorkers}
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
