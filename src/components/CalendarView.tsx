import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import {
  format,
  startOfMonth,
  endOfMonth,
  eachDayOfInterval,
  isToday,
  getDay,
  isSameWeek,
} from "date-fns";
import { tr } from "date-fns/locale";
import { Check, Minus, X, Palmtree, Users, Archive, Repeat, Rows3, Rows4 } from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { TableSkeleton } from "./ui/skeleton";
import type { DailyMetric, Attendance, Worker, AttendanceStatus } from "../types";
import { calculateDailyEarnings, rateResolverFor } from "../utils/earningsCalculator";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { periodOfDate } from "../lib/period";
import { workerInitials } from "../utils/initials";
import { WorkerAvatar } from "./ui/worker-avatar";

interface CalendarViewProps {
  currentDate: Date;
  onDayClick: (date: string) => void;
  onWorkerClick?: (worker: Worker) => void;
}

/** Lejant, hücreler ve gün sayfası aynı kaynaktan beslenir. */
const STATUS_STYLE: Record<
  AttendanceStatus,
  { label: string; chip: string; dot: string; icon: typeof Check }
> = {
  FULL: { label: "Tam", chip: "bg-ok-soft text-ok", dot: "bg-ok", icon: Check },
  HALF: { label: "Yarım", chip: "bg-warn-soft text-warn", dot: "bg-warn", icon: Minus },
  ABSENT: { label: "Yok", chip: "bg-bad-soft text-bad", dot: "bg-bad", icon: X },
  HOLIDAY: { label: "İzin", chip: "bg-info-soft text-info", dot: "bg-info", icon: Palmtree },
};

/**
 * Hücreye dokununca izlenen sıra. Doğal azalan düzende: tam gün tek dokunuş
 * uzakta (vakaların çoğu), son dokunuş kaydı temizler.
 */
const CYCLE: (AttendanceStatus | null)[] = ["FULL", "HALF", "ABSENT", "HOLIDAY", null];
const nextStatus = (current: AttendanceStatus | null): AttendanceStatus | null =>
  CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];

const STATUS_ORDER: AttendanceStatus[] = ["FULL", "HALF", "ABSENT", "HOLIDAY"];

/** Sağ sütunun gösterebileceği ölçüler. */
const METRICS = [
  { key: "production", label: "Palet" },
  { key: "revenue", label: "Ciro" },
  { key: "profit", label: "Net kâr" },
] as const;
type MetricKey = (typeof METRICS)[number]["key"];

/**
 * Satır yoğunluğu. Asıl kıt kaynak yatay değil dikey yer: 6 kişilik ekipte
 * sütunlar rahat sığıyor ama ekrana ayın yarısı bile girmiyor.
 */
const DENSITY = {
  normal: { row: "h-11", chip: "w-7 h-7", icon: "w-4 h-4", label: "Normal", icon_: Rows3 },
  compact: {
    row: "h-[34px]",
    chip: "w-6 h-6",
    icon: "w-3.5 h-3.5",
    label: "Sıkışık",
    icon_: Rows4,
  },
} as const;
type DensityKey = keyof typeof DENSITY;

/** Gün ve sağ sütun sabit; kişi sütunları kalan yeri paylaşır. */
const COL = { day: "3.25rem", side: "4.5rem" };
const WORKER_CELL: React.CSSProperties = { flex: "1 0 2.5rem", minWidth: "2.5rem" };

const compactMoney = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${n < 0 ? "-" : ""}${Math.round(abs / 1000)}b`;
  return String(Math.round(n));
};

function StatusMark({
  status,
  density,
}: {
  status?: AttendanceStatus | null;
  density: (typeof DENSITY)[DensityKey];
}) {
  const style = status ? STATUS_STYLE[status] : undefined;

  // Boş gün gürültü yapmasın: ince bir nokta yeter.
  if (!style) return <span className="w-1.5 h-1.5 rounded-full bg-muted-foreground/25" />;

  const Icon = style.icon;
  return (
    <span className={`${density.chip} rounded-[0.6rem] grid place-items-center ${style.chip}`}>
      <Icon className={density.icon} strokeWidth={2.75} />
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
  sideValue,
  workers,
  attendanceMap,
  readOnly,
  density,
  onDayClick,
  onCellTap,
  rowRef,
}: {
  dateStr: string;
  dayNum: string;
  dayName: string;
  label: string;
  isWeekend: boolean;
  today: boolean;
  sideValue: string | null;
  workers: readonly Worker[];
  attendanceMap: Record<string, Attendance>;
  readOnly: boolean;
  density: (typeof DENSITY)[DensityKey];
  onDayClick: (date: string) => void;
  onCellTap: (worker: Worker, dateStr: string, current: AttendanceStatus | null) => void;
  rowRef?: (el: HTMLDivElement | null) => void;
}) {
  // Satır ve sabit sütunlar AYNI katı zemini kullanır; böylece hiçbir durumda
  // iki tonlu görünmez ve yatay kaydırmada altları görünmez.
  const rowTone = today ? "bg-row-today" : isWeekend ? "bg-row-weekend" : "bg-background";

  return (
    <div
      ref={rowRef}
      data-date={dateStr}
      className={`flex ${density.row} items-stretch ${rowTone}`}
    >
      <button
        type="button"
        onClick={() => onDayClick(dateStr)}
        aria-label={`${label} gününü aç`}
        style={{ width: COL.day }}
        className={`shrink-0 sticky left-0 z-20 flex items-center justify-center gap-1 border-b border-r border-border/50 active:scale-95 transition-transform ${
          today ? "bg-primary text-primary-foreground" : rowTone
        }`}
      >
        <span className="text-[13px] font-semibold tabular-nums leading-none">{dayNum}</span>
        <span className={`text-[10px] leading-none ${today ? "opacity-80" : "opacity-55"}`}>
          {dayName}
        </span>
      </button>

      {workers.map((w) => {
        const status = attendanceMap[`${dateStr}-${w.id}`]?.status ?? null;
        return (
          <button
            key={w.id}
            type="button"
            disabled={readOnly}
            onClick={() => onCellTap(w, dateStr, status)}
            aria-label={`${w.name}, ${label}: ${status ? STATUS_STYLE[status].label : "kayıt yok"}`}
            style={WORKER_CELL}
            className="flex items-center justify-center border-b border-border/40 active:scale-90 transition-transform disabled:active:scale-100 hover:bg-muted/40 disabled:hover:bg-transparent"
          >
            <StatusMark status={status} density={density} />
          </button>
        );
      })}

      <button
        type="button"
        onClick={() => onDayClick(dateStr)}
        aria-label={`${label} gününün verilerini düzenle`}
        style={{ width: COL.side }}
        className={`shrink-0 sticky right-0 z-20 flex items-center justify-center border-b border-l border-border/50 active:scale-95 transition-transform ${rowTone}`}
      >
        {sideValue ? (
          <span className="text-[13px] font-semibold tabular-nums text-primary">{sideValue}</span>
        ) : (
          <span className="text-base text-muted-foreground/40 leading-none">+</span>
        )}
      </button>
    </div>
  );
});

export function CalendarView({ currentDate, onDayClick, onWorkerClick }: CalendarViewProps) {
  const allWorkers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);
  const workersLoading = useWorkerStore((s) => s.isLoading);
  const attendances = useAttendanceStore((s) => s.attendances);
  const fetchAttendanceByDateRange = useAttendanceStore((s) => s.fetchAttendanceByDateRange);
  const markAttendance = useAttendanceStore((s) => s.markAttendance);
  const attLoading = useAttendanceStore((s) => s.isLoading);
  const metrics = useMetricsStore((s) => s.metrics);
  const fetchMetricsByDateRange = useMetricsStore((s) => s.fetchMetricsByDateRange);
  const metricsLoading = useMetricsStore((s) => s.isLoading);
  const closedPeriods = usePeriodStore((s) => s.closed);
  const addToast = useToastStore((s) => s.addToast);

  const isLoading = workersLoading || attLoading || metricsLoading;
  const isClosed = closedPeriods.some((c) => c.period === periodOfDate(currentDate));

  const [density, setDensity] = useState<DensityKey>(() =>
    localStorage.getItem("calendar-density") === "compact" ? "compact" : "normal",
  );

  const toggleDensity = () => {
    const next: DensityKey = density === "normal" ? "compact" : "normal";
    setDensity(next);
    localStorage.setItem("calendar-density", next);
  };

  const [sideMetric, setSideMetric] = useState<MetricKey>(() => {
    const saved = localStorage.getItem("calendar-side-metric");
    return METRICS.some((m) => m.key === saved) ? (saved as MetricKey) : "production";
  });

  const cycleSideMetric = () => {
    const next = METRICS[(METRICS.findIndex((m) => m.key === sideMetric) + 1) % METRICS.length].key;
    setSideMetric(next);
    localStorage.setItem("calendar-side-metric", next);
  };

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

  // Sütun başlıkları isim değil baş harf gösteriyor; aynı harfle başlayan
  // iki kişide sütunlar ayırt edilemez olmasın diye küme içinde benzersizleşir.
  const initials = useMemo(() => workerInitials(activeWorkers), [activeWorkers]);

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

  /**
   * Kaç kişi sütunu ekranın sağında kalıyor.
   * Ekip büyüdüğünde sütunlar sabit palet sütununun arkasında sessizce
   * kayboluyordu; kullanıcı birinin eksik olduğunu fark etmiyordu.
   */
  const [hiddenCount, setHiddenCount] = useState(0);

  // Başlık satırı gövdeyle birlikte yatay kayar (kalabalık ekipte gerekir).
  useEffect(() => {
    const scrollView = scrollRef.current;
    const headerView = headerRef.current;
    if (!scrollView || !headerView) return;

    const sync = () => {
      headerView.scrollLeft = scrollView.scrollLeft;
      // Taşma varken kişi sütunları tabana (40px) oturmuş olur.
      const remaining = scrollView.scrollWidth - scrollView.clientWidth - scrollView.scrollLeft;
      setHiddenCount(remaining > 4 ? Math.round(remaining / 40) : 0);
    };
    sync();

    scrollView.addEventListener("scroll", sync, { passive: true });
    const observer = new ResizeObserver(sync);
    observer.observe(scrollView);
    return () => {
      scrollView.removeEventListener("scroll", sync);
      observer.disconnect();
    };
  }, [activeWorkers.length]);

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

  /** Gün başına net kâr — sağ sütun ve hafta toplamları için. */
  const profitByDate = useMemo(() => {
    const byDate = new Map<string, Attendance[]>();
    for (const a of attendances) {
      const key = String(a.date).trim();
      const bucket = byDate.get(key);
      if (bucket) bucket.push(a);
      else byDate.set(key, [a]);
    }

    const map: Record<string, number> = {};
    for (const metric of metrics) {
      const dateStr = String(metric.date).trim();
      const statusMap: Record<number, AttendanceStatus | null> = {};
      for (const a of byDate.get(dateStr) ?? []) statusMap[Number(a.worker_id)] = a.status;

      map[dateStr] = calculateDailyEarnings(
        calcWorkers,
        statusMap,
        metric.total_earned || 0,
        metric.extra_expenses || 0,
        rateResolverFor(dateStr, rateHistory),
      ).netProfit;
    }
    return map;
  }, [metrics, attendances, calcWorkers, rateHistory]);

  const stats = useMemo(() => {
    let production = 0;
    let revenue = 0;
    for (const m of metrics) {
      production += m.production_amount || 0;
      revenue += m.total_earned || 0;
    }
    const netProfit = Object.values(profitByDate).reduce((sum, v) => sum + v, 0);
    return { production, revenue, netProfit };
  }, [metrics, profitByDate]);

  const animProduction = useAnimatedCounter(stats.production, "palet");
  const animRevenue = useAnimatedCounter(Math.round(stats.revenue), "revenue");
  const animProfit = useAnimatedCounter(Math.round(stats.netProfit), "profit");

  const sideValueFor = useCallback(
    (dateStr: string): string | null => {
      const metric = metricsMap[dateStr];
      if (!metric) return null;
      if (sideMetric === "production")
        return metric.production_amount > 0 ? String(metric.production_amount) : null;
      if (sideMetric === "revenue")
        return metric.total_earned > 0 ? compactMoney(metric.total_earned) : null;
      const profit = profitByDate[dateStr];
      return profit ? compactMoney(profit) : null;
    },
    [metricsMap, sideMetric, profitByDate],
  );

  /**
   * Hücreye dokunulduğunda durum bir sonrakine geçer ve ANINDA yazılır.
   * Kâğıt puantajdaki "kutuyu işaretle" hareketinin karşılığı; bordro kaydı
   * olduğu için her değişiklik geri alınabilir bir bildirimle bildirilir.
   */
  const handleCellTap = useCallback(
    async (worker: Worker, dateStr: string, current: AttendanceStatus | null) => {
      const next = nextStatus(current);
      try {
        await markAttendance(worker.id, dateStr, next);
        const label = next ? STATUS_STYLE[next].label.toLocaleLowerCase("tr-TR") : "temizlendi";
        addToast(
          `${worker.name.split(" ")[0]} · ${format(new Date(dateStr), "d MMM", { locale: tr })} · ${label}`,
          {
            type: "success",
            action: {
              label: "Geri al",
              onClick: () => markAttendance(worker.id, dateStr, current),
            },
          },
        );
      } catch (err: unknown) {
        addToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [markAttendance, addToast],
  );

  /** Hafta özetleri: yevmiye zaten haftalık hesaplandığı için doğal ayraç. */
  const weekSummaries = useMemo(() => {
    const result: Record<string, { days: number; production: number; revenue: number }> = {};
    for (const day of daysInMonth) {
      const dateStr = format(day, "yyyy-MM-dd");
      const metric = metricsMap[dateStr];
      if (!metric) continue;
      const weekKey = daysInMonth.find((d) => isSameWeek(d, day, { weekStartsOn: 1 }))!;
      const key = format(weekKey, "yyyy-MM-dd");
      const bucket = (result[key] ??= { days: 0, production: 0, revenue: 0 });
      bucket.days += 1;
      bucket.production += metric.production_amount || 0;
      bucket.revenue += metric.total_earned || 0;
    }
    return result;
  }, [daysInMonth, metricsMap]);

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

  const activeMetricLabel = METRICS.find((m) => m.key === sideMetric)!.label;

  return (
    <div className="flex-1 flex flex-col w-full min-h-0 overflow-hidden">
      {/* Ay özeti */}
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

      <div className="flex items-center gap-4 px-3 py-1 bg-surface text-[11px] text-muted-foreground shrink-0">
        <div className="flex-1 flex justify-center gap-4">
          {STATUS_ORDER.map((s) => (
            <span key={s} className="flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${STATUS_STYLE[s].dot}`} />
              {STATUS_STYLE[s].label}
            </span>
          ))}
        </div>
        <button
          type="button"
          onClick={toggleDensity}
          aria-label={`Satır yüksekliği: ${DENSITY[density].label}. Değiştirmek için dokunun.`}
          title={`Satır yüksekliği: ${DENSITY[density].label}`}
          className="shrink-0 w-7 h-7 rounded-lg grid place-items-center hover:bg-muted hover:text-foreground active:scale-90 transition-all"
        >
          {density === "normal" ? <Rows3 className="w-4 h-4" /> : <Rows4 className="w-4 h-4" />}
        </button>
      </div>

      {/* Tablo başlığı — isim yerine baş harf, yer kazandırır */}
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
              className="py-1.5 grid place-items-center active:scale-90 transition-transform"
            >
              <WorkerAvatar worker={w} size="xs" label={initials.get(w.id)} />
            </button>
          ))}
          <button
            type="button"
            onClick={cycleSideMetric}
            aria-label={`Sağ sütun: ${activeMetricLabel}. Değiştirmek için dokunun.`}
            style={{ width: COL.side }}
            className="shrink-0 py-2 sticky right-0 z-20 bg-surface border-l border-border/50 text-primary flex items-center justify-center gap-1 active:scale-95 transition-transform"
          >
            {activeMetricLabel}
            <Repeat className="w-2.5 h-2.5 opacity-60" />
          </button>
        </div>
      </div>

      {hiddenCount > 0 && (
        <div className="px-4 py-1 bg-warn-soft text-warn text-[11px] font-medium flex items-center justify-center gap-1.5 shrink-0">
          Sağda {hiddenCount} kişi daha var — tabloyu yana kaydırın
        </div>
      )}

      {archivedWithData.length > 0 && (
        <div className="px-4 py-1 bg-surface text-[11px] text-muted-foreground flex items-center justify-center gap-1.5 shrink-0 border-b border-border/60">
          <Archive className="w-3 h-3" />
          {archivedWithData.length} arşivlenmiş kişi hesaba dahil
        </div>
      )}

      {/* Gövde */}
      <div ref={scrollRef} className="flex-1 overflow-auto no-scrollbar pb-safe-content">
        <div className="min-w-full">
          {daysInMonth.map((date, index) => {
            const dateStr = format(date, "yyyy-MM-dd");
            const weekday = getDay(date);
            const startsWeek = index === 0 || weekday === 1;
            const summary = startsWeek ? weekSummaries[dateStr] : undefined;

            return (
              <div key={dateStr}>
                {startsWeek && (
                  <div className="flex items-center gap-2 px-3 py-1 bg-muted/30 border-b border-border/50 text-[10px] text-muted-foreground sticky top-0 z-10">
                    <span className="shrink-0">
                      {format(date, "d MMM", { locale: tr })} haftası
                    </span>
                    {summary ? (
                      <span className="ml-auto tabular-nums shrink-0">
                        {summary.days} gün · {summary.production} palet · ₺
                        {summary.revenue.toLocaleString("tr-TR")}
                      </span>
                    ) : (
                      <span className="ml-auto shrink-0 opacity-60">kayıt yok</span>
                    )}
                  </div>
                )}
                <CalendarRow
                  dateStr={dateStr}
                  dayNum={format(date, "dd")}
                  dayName={format(date, "EEEEEE", { locale: tr })}
                  label={format(date, "d MMMM EEEE", { locale: tr })}
                  isWeekend={weekday === 0 || weekday === 6}
                  today={isToday(date)}
                  sideValue={sideValueFor(dateStr)}
                  workers={activeWorkers}
                  attendanceMap={attendanceMap}
                  readOnly={isClosed}
                  density={DENSITY[density]}
                  onDayClick={onDayClick}
                  onCellTap={handleCellTap}
                  rowRef={
                    isToday(date)
                      ? (el) => {
                          (todayRowRef as React.MutableRefObject<HTMLDivElement | null>).current =
                            el;
                        }
                      : undefined
                  }
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
