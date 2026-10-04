import { useEffect, useMemo, useRef, useState, useCallback, memo } from "react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval, isToday, getDay } from "date-fns";
import { tr } from "date-fns/locale";
import { Check, Minus, X, Users, Archive, Repeat, Rows3, Rows4, Undo2 } from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { TableSkeleton } from "./ui/skeleton";
import type { DailyMetric, Attendance, Worker, WorkerRate, AttendanceStatus } from "../types";
import { calculateDailyEarnings, rateResolverFor } from "../utils/earningsCalculator";
import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import {
  useCellFeedback,
  readCellFeedback,
  useCellFeedbackStore,
  type FeedbackTone,
} from "../hooks/useCellFeedback";
import { hapticError, hapticSuccess } from "../hooks/useHaptics";
import { periodOfDate } from "../lib/period";
import { readPref, writePref } from "../lib/prefs";
import { formatMoney } from "../lib/utils";
import { workerInitials } from "../utils/initials";
import { WorkerAvatar } from "./ui/worker-avatar";
import { EmptyState } from "./EmptyState";

interface CalendarViewProps {
  currentDate: Date;
  onDayClick: (date: string) => void;
  onWorkerClick?: (worker: Worker) => void;
  /** Boş durumdaki "Personel Ekle" düğmesi nereye gidecek. */
  onGoToWorkers?: () => void;
}

/** Lejant, hücreler ve gün sayfası aynı kaynaktan beslenir. */
const STATUS_STYLE: Record<
  AttendanceStatus,
  { label: string; chip: string; dot: string; icon: typeof Check }
> = {
  FULL: { label: "Tam", chip: "bg-ok-soft text-ok", dot: "bg-ok", icon: Check },
  HALF: { label: "Yarım", chip: "bg-warn-soft text-warn", dot: "bg-warn", icon: Minus },
  ABSENT: { label: "Yok", chip: "bg-bad-soft text-bad", dot: "bg-bad", icon: X },
};

/**
 * Hücreye dokununca izlenen sıra: Tam → Yarım → Yok → boş → Tam …
 *
 * Durum sayısı sabit üç; döngüye dördüncü bir seçenek eklemek "Yok"tan sonra
 * tekrar "Tam"a dönüşü bir dokunuş uzatıyordu.
 */
const CYCLE: (AttendanceStatus | null)[] = ["FULL", "HALF", "ABSENT", null];
const nextStatus = (current: AttendanceStatus | null): AttendanceStatus | null =>
  CYCLE[(CYCLE.indexOf(current) + 1) % CYCLE.length];

const STATUS_ORDER: AttendanceStatus[] = ["FULL", "HALF", "ABSENT"];

/** Sağ sütunun gösterebileceği ölçüler. */
const METRICS = [
  { key: "production", label: "Üretim" },
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

/**
 * Puantaj hücresi tabanı.
 *
 * 44px, `.tap-target` ile aynı sayı olmak ZORUNDA: taban 44'e çıktıktan sonra
 * "Sağda N kişi daha var" uyarısı da hücre genişliğinden bölmeli, yoksa
 * uyarı yanlış sayı gösterir. Tek kaynak: `CELL_PX`.
 */
const CELL_PX = 44;
const WORKER_CELL: React.CSSProperties = { flex: "1 0 2.75rem", minWidth: "2.75rem" };

/**
 * Roving tabindex (APG "ızgara" kalıbı) koordinat yardımcıları.
 *
 * Takvim ızgarasında tek Tab durağı vardır; gezinme ok tuşlarıyla yapılır.
 * Her hücre ayrı bir Tab durağı olsaydı (31 gün × ekip + gün/sağ sütun)
 * klavyeyle alt navigasyona ulaşmak binlerce Tab basışı sürerdi.
 *
 * Koordinat: satır 0 = başlık, 1..G = günler; sütun 0 = gün, 1..K = kişiler,
 * K+1 = sağ sütun. Odaklanabilir hücreler `data-cal-cell="satır-sütun"` taşır.
 */
type CellPos = [number, number];

const parseCalCell = (value: string | undefined): CellPos | null => {
  const match = /^(\d+)-(\d+)$/.exec(value ?? "");
  return match ? [Number(match[1]), Number(match[2])] : null;
};

/** Başlıkta "Gün" sütunu etkileşimli değil; kapanmış dönemde kişi hücreleri kapalı. */
const isFocusableCell = (
  row: number,
  col: number,
  workerCount: number,
  dayCount: number,
  readOnly: boolean,
): boolean => {
  if (row < 0 || row > dayCount || col < 0 || col > workerCount + 1) return false;
  if (row === 0 && col === 0) return false;
  if (row > 0 && col >= 1 && col <= workerCount && readOnly) return false;
  return true;
};

/**
 * Ok/Home/End için hedef hücreyi arar. Yol üstündeki devre dışı hücreler
 * (kapanmış dönemin puantaj hücreleri) atlanır; o yönde açık hücre yoksa
 * odak yerinde kalır ve kaydırma tarayıcıya bırakılır.
 */
const stepRoving = (
  from: CellPos,
  key: string,
  bounds: { workerCount: number; dayCount: number; readOnly: boolean },
): CellPos | null => {
  const { workerCount, dayCount, readOnly } = bounds;
  const open = (row: number, col: number) =>
    isFocusableCell(row, col, workerCount, dayCount, readOnly);
  switch (key) {
    case "ArrowLeft":
      for (let col = from[1] - 1; col >= 0; col--) if (open(from[0], col)) return [from[0], col];
      return null;
    case "ArrowRight":
      for (let col = from[1] + 1; col <= workerCount + 1; col++)
        if (open(from[0], col)) return [from[0], col];
      return null;
    case "ArrowUp":
      for (let row = from[0] - 1; row >= 0; row--) if (open(row, from[1])) return [row, from[1]];
      return null;
    case "ArrowDown":
      for (let row = from[0] + 1; row <= dayCount; row++)
        if (open(row, from[1])) return [row, from[1]];
      return null;
    case "Home":
      for (let col = 0; col <= workerCount + 1; col++)
        if (open(from[0], col)) return [from[0], col];
      return null;
    case "End":
      for (let col = workerCount + 1; col >= 0; col--)
        if (open(from[0], col)) return [from[0], col];
      return null;
    default:
      return null;
  }
};

const compactMoney = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 1000) return `${n < 0 ? "-" : ""}${Math.round(abs / 1000)}b`;
  return String(Math.round(n));
};

/** Bir güne ait puantajlar: çalışan id → kayıt. */
type DayAttendance = Record<string, Attendance>;

/**
 * Puantajları güne göre gruplar.
 *
 * İki işi birden yapar:
 *  1. `memo`lanmış satırlara yalnızca kendi gününü verir — bir hücreye
 *     dokunmak ayın 31 satırını değil, tek satırını geçersiz kılar.
 *  2. İçeriği değişmeyen günün referansını korur; aksi hâlde her puantaj
 *     dokunuşunda bütün gün nesneleri yeniden üretilir, `memo` yine tutmaz.
 */
function groupByDate(attendances: readonly Attendance[]): Map<string, DayAttendance> {
  const grouped = new Map<string, Map<string, Attendance>>();
  for (const a of attendances) {
    const date = String(a.date).trim();
    const workerId = String(a.worker_id).trim();
    let bucket = grouped.get(date);
    if (!bucket) {
      bucket = new Map();
      grouped.set(date, bucket);
    }
    bucket.set(workerId, a);
  }
  return new Map([...grouped].map(([date, bucket]) => [date, Object.fromEntries(bucket)]));
}

/** İki gün kaydı aynı mı? (aynı çalışan kümesi, aynı kayıt referansları) */
function sameDayAttendance(a: DayAttendance | undefined, b: DayAttendance): boolean {
  if (!a) return false;
  const aKeys = Object.keys(a);
  if (aKeys.length !== Object.keys(b).length) return false;
  return aKeys.every((k) => a[k] === b[k]);
}

/** Kaydı olmayan günler için paylaşılan boş nesne — referansı sabit kalmalı. */
const EMPTY_DAY: DayAttendance = {};

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
    <span
      key={status}
      className={`${density.chip} rounded-[0.6rem] grid place-items-center animate-status-pop ${style.chip}`}
    >
      <Icon className={density.icon} strokeWidth={2.75} />
    </span>
  );
}

/** Parlamanın rengi. `motion-reduce`'da da aynı sınıf kalır: statik renk değişimi. */
const TONE_FLASH: Record<FeedbackTone, string> = {
  success: "bg-ok/45",
  cleared: "bg-muted-foreground/35",
  error: "bg-bad/45",
};

/** `date|workerId` — bir hücreyi tüm ay boyunca tekil tanımlayan anahtar. */
const cellFeedbackKey = (dateStr: string, workerId: number) => `${dateStr}|${workerId}`;

/**
 * Tek puantaj hücresi.
 *
 * Geri bildirim `CalendarView`'un state'i değil, HÜCRE BAŞINA abonelikle gelen
 * ayrı bir store'dur (`useCellFeedback`). State burada olsaydı bir dokunuş ayın
 * 31 `memo`lanmış satırının hepsini geçersiz kılardı.
 *
 * `memo` BİLEREK yok: satır her çizildiğinde o günün tüm hücrelerinin
 * çizilmesi zaten beklenen davranış (`calendarViewRender.test.tsx` bunu
 * "bir hücreye dokununca yalnızca o günün hücreleri çizilir" diye ölçüyor).
 */
function WorkerCell({
  worker,
  dateStr,
  label,
  status,
  density,
  readOnly,
  tabbable,
  rowIndex,
  colIndex,
  onCellTap,
}: {
  worker: Worker;
  dateStr: string;
  label: string;
  status: AttendanceStatus | null;
  density: (typeof DENSITY)[DensityKey];
  readOnly: boolean;
  tabbable: boolean;
  rowIndex: number;
  colIndex: number;
  onCellTap: (worker: Worker, dateStr: string, current: AttendanceStatus | null) => void;
}) {
  const cellKey = cellFeedbackKey(dateStr, worker.id);
  const feedback = useCellFeedback(cellKey);
  const wrapRef = useRef<HTMLDivElement>(null);

  /**
   * Geri al düğmesi DOM'dan kalkınca odak hücreye döner: klavye kullanıcısı
   * sayfayı kaybetmez. Aynı hücreye yeniden dokunulabilir kalsın diye.
   */
  const runUndo = () => {
    const undo = feedback?.undo;
    if (!undo) return;
    useCellFeedbackStore.getState().clear(cellKey);
    void undo();
    wrapRef.current?.querySelector<HTMLElement>("[data-cal-cell]")?.focus();
  };

  return (
    <div ref={wrapRef} style={WORKER_CELL} className="relative shrink-0">
      <button
        type="button"
        disabled={readOnly}
        onClick={() => onCellTap(worker, dateStr, status)}
        aria-label={`${worker.name}, ${label}: ${status ? STATUS_STYLE[status].label : "kayıt yok"}`}
        tabIndex={tabbable ? 0 : -1}
        data-cal-cell={`${rowIndex}-${colIndex}`}
        className="tap-target relative w-full h-full flex items-center justify-center border-b border-border/40 active:scale-90 transition-transform disabled:active:scale-100 hover:bg-muted/40 disabled:hover:bg-transparent"
      >
        {feedback?.tone && (
          <span
            key={feedback.token}
            aria-hidden="true"
            className={`pointer-events-none absolute inset-0 rounded-[0.6rem] motion-safe:animate-cell-flash motion-reduce:animate-none ${TONE_FLASH[feedback.tone]}`}
          />
        )}
        <span className="relative">
          <StatusMark status={status} density={density} />
        </span>
      </button>

      {feedback?.undo && (
        <button
          type="button"
          onClick={runUndo}
          aria-label={`${worker.name}, ${label} değişikliğini geri al`}
          title="Geri al"
          className="absolute top-0 right-0 z-10 grid place-items-center w-6 h-6 rounded-full bg-background text-foreground shadow-sm ring-1 ring-border/70 after:absolute after:-inset-1 after:content-['']"
        >
          <Undo2 className="w-3 h-3" strokeWidth={2.5} />
        </button>
      )}
    </div>
  );
}

interface MonthStatsProps {
  production: number;
  revenue: number;
  netProfit: number;
}
const plainNumber = (n: number) => n.toLocaleString("tr-TR");

/**
 * Animasyonlu sayı.
 *
 * Kareler DOM'a yazılır; bileşen kare başına yeniden çizilmez. Düğüm
 * callback ref ile state'e alınır çünkü `useRef.current` ilk render'da hâlâ
 * `null`'dır — effect bu değere baksaydı animasyon hiç başlamazdı. Bu tek
 * ek render yalnızca bu kutuyu etkiler.
 */
function Counter({ target, format }: { target: number; format: (n: number) => string }) {
  const [node, setNode] = useState<HTMLSpanElement | null>(null);
  useAnimatedCounter(node, target, format);
  return (
    <span ref={setNode} className="block truncate">
      {format(target)}
    </span>
  );
}

/**
 * Ay özeti.
 *
 * Sayaç, takvim grid'inden iki katmanlı ayrıldı: kareler doğrudan DOM'a
 * yazılıyor ve bu bileşen yalnızca hedef değerler değiştiğinde çiziliyor.
 * Önceden sayaç `CalendarView`'in state'iydi; her karede `setValue` tüm takvimi
 * yeniden çiziyordu — bir puantaj dokunuşundan sonraki bir saniye boyunca
 * saniyede ~180 tam render.
 */
function MonthStats({ production, revenue, netProfit }: MonthStatsProps) {
  return (
    <div className="px-4 pb-3 bg-surface shrink-0 grid grid-cols-3 gap-3">
      <StatBox label="Üretim" tone="text-foreground">
        <Counter target={production} format={plainNumber} />
      </StatBox>
      <StatBox label="Ciro" tone="text-foreground">
        <Counter target={Math.round(revenue)} format={formatMoney} />
      </StatBox>
      <StatBox label="Net kâr" tone={netProfit < 0 ? "text-bad" : "text-ok"}>
        <Counter target={Math.round(netProfit)} format={formatMoney} />
      </StatBox>
    </div>
  );
}

function StatBox({
  label,
  tone,
  children,
}: {
  label: string;
  tone: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-w-0">
      <div className="text-[11px] text-muted-foreground leading-none mb-1">{label}</div>
      <div className={`text-[15px] font-semibold tabular-nums truncate ${tone}`}>{children}</div>
    </div>
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
  attendance,
  readOnly,
  density,
  onDayClick,
  onCellTap,
  rowIndex,
  tabbableCol,
  attachRowRef,
}: {
  dateStr: string;
  dayNum: string;
  dayName: string;
  label: string;
  isWeekend: boolean;
  today: boolean;
  sideValue: string | null;
  workers: readonly Worker[];
  /** Yalnızca BU güne ait kayıtlar; değişmeyen günlerde referans korunur. */
  attendance: Record<string, Attendance>;
  readOnly: boolean;
  density: (typeof DENSITY)[DensityKey];
  onDayClick: (date: string) => void;
  onCellTap: (worker: Worker, dateStr: string, current: AttendanceStatus | null) => void;
  /** Roving tabindex satır koordinatı; başlık satırı 0, günler 1..G. */
  rowIndex: number;
  /** Bu satırda Tab durağı olan sütun; odak başka satırdaysa `null`. */
  tabbableCol: number | null;
  /** Callback ref; yalnızca bugünün satırında verilir. */
  attachRowRef?: (el: HTMLDivElement | null) => void;
}) {
  // Satır ve sabit sütunlar AYNI katı zemini kullanır; böylece hiçbir durumda
  // iki tonlu görünmez ve yatay kaydırmada altları görünmez.
  const rowTone = today ? "bg-row-today" : isWeekend ? "bg-row-weekend" : "bg-background";

  return (
    <div
      ref={today ? attachRowRef : undefined}
      data-date={dateStr}
      className={`flex ${density.row} items-stretch ${rowTone}`}
    >
      <button
        type="button"
        onClick={() => onDayClick(dateStr)}
        aria-label={`${label} gününü aç`}
        tabIndex={tabbableCol === 0 ? 0 : -1}
        data-cal-cell={`${rowIndex}-0`}
        style={{ width: COL.day }}
        className={`tap-target shrink-0 sticky left-0 z-20 flex items-center justify-center gap-1 border-b border-r border-border/50 active:scale-95 transition-transform ${
          today ? "bg-primary text-primary-foreground" : rowTone
        }`}
      >
        <span className="text-[13px] font-semibold tabular-nums leading-none">{dayNum}</span>
        <span className={`text-[10px] leading-none ${today ? "opacity-80" : "opacity-55"}`}>
          {dayName}
        </span>
      </button>

      {workers.map((w, workerIndex) => (
        <WorkerCell
          key={w.id}
          worker={w}
          dateStr={dateStr}
          label={label}
          status={attendance[String(w.id)]?.status ?? null}
          density={density}
          readOnly={readOnly}
          tabbable={tabbableCol === workerIndex + 1}
          rowIndex={rowIndex}
          colIndex={workerIndex + 1}
          onCellTap={onCellTap}
        />
      ))}

      <button
        type="button"
        onClick={() => onDayClick(dateStr)}
        aria-label={`${label} gününün verilerini düzenle`}
        tabIndex={tabbableCol === workers.length + 1 ? 0 : -1}
        data-cal-cell={`${rowIndex}-${workers.length + 1}`}
        style={{ width: COL.side }}
        className={`tap-target shrink-0 sticky right-0 z-20 flex items-center justify-center border-b border-l border-border/50 active:scale-95 transition-transform ${rowTone}`}
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

export function CalendarView({
  currentDate,
  onDayClick,
  onWorkerClick,
  onGoToWorkers,
}: CalendarViewProps) {
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

  /**
   * `App.tsx` her render'da yeni bir arrow fonksiyon üretiyor. `CalendarRow`
   * `memo`landığı için bu referans her seferinde değişiyor ve memo hiç tutmuyor;
   * en pahalı render yolu (31 satır × 40 hücre) gereksizce yeniden çiziliyordu.
   * Ref ile sarıyoruz: dışarıdaki fonksiyon değişse bile satırların gördüğü
   * referans sabit kalır.
   */
  const onDayClickRef = useRef(onDayClick);
  onDayClickRef.current = onDayClick;
  const handleDayClick = useCallback((dateStr: string) => onDayClickRef.current(dateStr), []);

  /** Bugünün satırına callback ref — render'da yeni arrow üretmiyor. */
  const attachTodayRow = useCallback((el: HTMLDivElement | null) => {
    todayRowRef.current = el;
  }, []);

  const [density, setDensity] = useState<DensityKey>(() =>
    readPref("calendar-density") === "compact" ? "compact" : "normal",
  );

  const toggleDensity = () => {
    const next: DensityKey = density === "normal" ? "compact" : "normal";
    setDensity(next);
    writePref("calendar-density", next);
  };

  const [sideMetric, setSideMetric] = useState<MetricKey>(() => {
    const saved = readPref("calendar-side-metric");
    return METRICS.some((m) => m.key === saved) ? (saved as MetricKey) : "production";
  });

  const cycleSideMetric = () => {
    const next = METRICS[(METRICS.findIndex((m) => m.key === sideMetric) + 1) % METRICS.length].key;
    setSideMetric(next);
    writePref("calendar-side-metric", next);
  };

  const headerRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const todayRowRef = useRef<HTMLDivElement>(null);
  /** Önceki render'daki gün→kayıt haritası; değişmeyen gün referansını korumak için. */
  const dayAttendanceRef = useRef<Map<string, DayAttendance>>(new Map());
  /** Gün başına kâr önbelleği; bağımlılıkları değişmeyen günler yeniden hesaplanmaz. */
  const profitCacheRef = useRef(
    new Map<
      string,
      {
        day: DayAttendance | undefined;
        earned: number;
        extra: number;
        workers: readonly Worker[];
        rates: readonly WorkerRate[];
        value: number;
      }
    >(),
  );

  const daysInMonth = useMemo(
    () => eachDayOfInterval({ start: startOfMonth(currentDate), end: endOfMonth(currentDate) }),
    [currentDate],
  );

  const activeWorkers = useMemo(
    () => allWorkers.filter((w) => w.is_active !== false),
    [allWorkers],
  );

  /**
   * Roving tabindex durumu — bkz. `stepRoving` notu. Izgarada tek Tab durağı
   * vardır; `[satır, sütun]` o durağın koordinatını tutar.
   */
  const rootRef = useRef<HTMLDivElement>(null);
  const [rovingCell, setRovingCell] = useState<CellPos>([1, 0]);

  const workerCount = activeWorkers.length;
  const dayCount = daysInMonth.length;
  // Ay/ekip değişince hedef hücre yok olabilir; Tab durağı her zaman var olan
  // bir hücrede kalmalı. Başlık satırında "Gün" sütunu etkileşimli değil.
  const rovingRow = Math.min(Math.max(rovingCell[0], 0), dayCount);
  const clampedCol = Math.min(Math.max(rovingCell[1], 0), workerCount + 1);
  const rovingCol = rovingRow === 0 && clampedCol === 0 ? Math.min(1, workerCount + 1) : clampedCol;

  const focusCell = useCallback((cell: CellPos) => {
    rootRef.current?.querySelector<HTMLElement>(`[data-cal-cell="${cell[0]}-${cell[1]}"]`)?.focus();
  }, []);

  const handleGridKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const from = parseCalCell((event.target as HTMLElement).dataset.calCell);
      if (!from) return;
      const to = stepRoving(from, event.key, { workerCount, dayCount, readOnly: isClosed });
      // Ok tuşu hiçbir hücreye gitmiyorsa kaydırma tarayıcıda kalsın.
      if (!to) return;
      event.preventDefault();
      setRovingCell(to);
      focusCell(to);
    },
    [workerCount, dayCount, isClosed, focusCell],
  );

  /** Ok tuşuyla ya da tıkla gelinen hücre Tab durağı olur. */
  const handleGridFocus = useCallback((event: React.FocusEvent<HTMLDivElement>) => {
    const cell = parseCalCell((event.target as HTMLElement).dataset.calCell);
    if (!cell) return;
    setRovingCell((prev) => (prev[0] === cell[0] && prev[1] === cell[1] ? prev : cell));
  }, []);

  /** Bu ayda kaydı olan arşivlenmiş çalışanlar — hesaba girer, sütun almaz. */
  const archivedWithData = useMemo(() => {
    // Kayıt kimliklerinin tamamı yerine YALNIZCA arşivli çalışanlar bir kümeye
    // konur: 22 bin satırlık diziden `Set` kurmak her puantaj değişiminde
    // gereksizce tüm ayı tarıyordu. Arşivli çalışan yoksa hiç taranmaz.
    const archivedIds: Record<number, true> = {};
    let archivedCount = 0;
    for (const w of allWorkers) {
      if (w.is_active === false) {
        archivedIds[w.id] = true;
        archivedCount += 1;
      }
    }
    if (archivedCount === 0) return [];

    const found: Record<number, true> = {};
    let foundCount = 0;
    for (const a of attendances) {
      const id = Number(a.worker_id);
      if (archivedIds[id] && !found[id]) {
        found[id] = true;
        foundCount += 1;
        // Hepsi bulundu; kalan satırları taramanın anlamı yok.
        if (foundCount === archivedCount) break;
      }
    }
    return allWorkers.filter((w) => w.is_active === false && found[w.id]);
  }, [allWorkers, attendances]);

  /**
   * Güne göre gruplanmış puantajlar. Satırlar yalnızca kendi gününü alır;
   * değişmeyen günün referansı korunur, böylece `memo` gerçekten tutar.
   */
  const attendanceByDate = useMemo(() => {
    const grouped = groupByDate(attendances);
    const previous = dayAttendanceRef.current;
    const next = new Map<string, DayAttendance>();
    for (const [date, day] of grouped) {
      const before = previous.get(date);
      next.set(date, sameDayAttendance(before, day) ? (before as DayAttendance) : day);
    }
    dayAttendanceRef.current = next;
    return next;
  }, [attendances]);

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
      // `prefers-reduced-motion` isteyen kullanıcıya kayma animasyonu yapılmaz.
      // CSS'teki global kural JS'in `behavior: "smooth"` çağrısını susturmaz;
      // karar burada verilir.
      const reduced =
        typeof window.matchMedia === "function" &&
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      todayRowRef.current?.scrollIntoView({
        behavior: reduced ? "auto" : "smooth",
        block: "center",
      });
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
      // Taşma varken kişi sütunları tabana oturmuş olur; bölücü `CELL_PX`
      // olmalı, yoksa uyarı hücre genişliğinden sapar.
      const remaining = scrollView.scrollWidth - scrollView.clientWidth - scrollView.scrollLeft;
      const next = remaining > 4 ? Math.round(remaining / CELL_PX) : 0;
      // Dokunmatik kaydırmada bu olay kare başına gelir; aynı sayıyı tekrar
      // set etmek tüm takvimi yeniden çiziyordu. React aynı değerde çıkış yapar.
      setHiddenCount(next);
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

  const metricsMap = useMemo(() => {
    const map: Record<string, DailyMetric> = {};
    metrics.forEach((m) => {
      if (m.date) map[String(m.date).trim()] = m;
    });
    return map;
  }, [metrics]);

  /**
   * Gün başına net kâr — sağ sütun ve hafta toplamları için.
   *
   * Bir hücreye dokunmak artık ayın 31 gününü yeniden hesaplamıyor: her günün
   * sonucu, o günün puantaj/ölçüm/ekip referansları değişmediyse önbellekten
   * gelir. Tek değişen gün yeniden hesaplanır, kalan 30 gün atlanır.
   */
  const profitByDate = useMemo(() => {
    const cache = profitCacheRef.current;
    const map: Record<string, number> = {};

    for (const metric of metrics) {
      const dateStr = String(metric.date).trim();
      const day = attendanceByDate.get(dateStr);
      const earned = metric.total_earned || 0;
      const extra = metric.extra_expenses || 0;

      const cached = cache.get(dateStr);
      if (
        cached &&
        cached.day === day &&
        cached.earned === earned &&
        cached.extra === extra &&
        cached.workers === calcWorkers &&
        cached.rates === rateHistory
      ) {
        map[dateStr] = cached.value;
        continue;
      }

      const statusMap: Record<number, AttendanceStatus | null> = {};
      if (day) {
        for (const [workerId, a] of Object.entries(day)) statusMap[Number(workerId)] = a.status;
      }

      const value = calculateDailyEarnings(
        calcWorkers,
        statusMap,
        earned,
        extra,
        rateResolverFor(dateStr, rateHistory),
      ).netProfit;

      cache.set(dateStr, { day, earned, extra, workers: calcWorkers, rates: rateHistory, value });
      map[dateStr] = value;
    }

    // Ay değiştiyse eski günlerin önbelleği boşta yer kaplamasın.
    if (cache.size !== Object.keys(map).length) {
      for (const date of cache.keys()) {
        if (!(date in map)) cache.delete(date);
      }
    }
    return map;
  }, [metrics, attendanceByDate, calcWorkers, rateHistory]);

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

  // Sayaç animasyonu bilinçli olarak AYRI bir bileşende yaşıyor: sayaç her
  // karede değer değiştirir, state burada olsaydı saniyede ~180 kez tüm
  // takvim yeniden çizilirdi. `MonthStats` yalnızca kendi üç hanesini render
  // eder; grid bu render'lardan habersiz kalır.

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
   * Kâğıt puantajdaki "kutuyu işaretle" hareketinin karşılığı.
   *
   * Bildirim artık ekranı kapatan toast DEĞİL: dokunulan cihazda kısa bir
   * titreşim + hücrede kısa bir parlama. 50 kişiye arka arkaya dokunan
   * kullanıcının ekranı birbiriyle binen bildirimlerle kapanıyordu.
   *
   * Geri alma korunur: değişiklik hücrenin köşesinde 3 saniye duran bir
   * düğmeyle geri alınabilir. Aynı hücreye art arda dokunulduğunda geri alma
   * ZİNCİRİN İLK durumuna döner — iki ayrı toast'un işi tek düğmeye sığmıyor.
   */
  const handleCellTap = useCallback(
    async (worker: Worker, dateStr: string, current: AttendanceStatus | null) => {
      const key = cellFeedbackKey(dateStr, worker.id);
      const next = nextStatus(current);
      const base = readCellFeedback(key)?.base ?? current;
      const { pulse } = useCellFeedbackStore.getState();

      try {
        await markAttendance(worker.id, dateStr, next);
        pulse(key, next ? "success" : "cleared", {
          base,
          undo: async () => {
            try {
              await markAttendance(worker.id, dateStr, base as AttendanceStatus | null);
              hapticSuccess();
            } catch (err: unknown) {
              hapticError();
              addToast(err instanceof Error ? err.message : String(err), "error");
            }
          },
        });
        hapticSuccess();
      } catch (err: unknown) {
        // Hata nadir ve açıklamaya muhtaç: yine toast, ama ek olarak kırmızı
        // parlama + titreşim. Mevcut geri alma düğmesi silinmez.
        hapticError();
        pulse(key, "error");
        addToast(err instanceof Error ? err.message : String(err), "error");
      }
    },
    [markAttendance, addToast],
  );

  /**
   * Hafta özetleri: yevmiye zaten haftalık hesaplandığı için doğal ayraç.
   *
   * Anahtar, ayın içindeki o haftanın İLK günü — render da hafta bandını
   * aynı koşulla (`index === 0 || getDay === 1`) açıyor. Önceki kod her gün
   * için `daysInMonth.find(isSameWeek)` ile diziyi yeniden tarıyordu (O(n²));
   * günler zaten sıralı olduğu için tek geçişte bulunur.
   */
  const weekSummaries = useMemo(() => {
    const result: Record<string, { days: number; production: number; revenue: number }> = {};
    let weekKey = "";
    daysInMonth.forEach((day, index) => {
      const dateStr = format(day, "yyyy-MM-dd");
      if (index === 0 || getDay(day) === 1) weekKey = dateStr;

      const metric = metricsMap[dateStr];
      if (!metric) return;

      const bucket = (result[weekKey] ??= { days: 0, production: 0, revenue: 0 });
      bucket.days += 1;
      bucket.production += metric.production_amount || 0;
      bucket.revenue += metric.total_earned || 0;
    });
    return result;
  }, [daysInMonth, metricsMap]);

  if (activeWorkers.length === 0) {
    if (isLoading) return <TableSkeleton rows={6} cols={4} />;
    // Navigasyon callback'i verilmemişse (bileşen testte tek başına
    // çiziliyor) eski davranışa düşer: metin yönlendirme yeterli.
    if (!onGoToWorkers) {
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
    return <EmptyState onGoToWorkers={onGoToWorkers} />;
  }

  const activeMetricLabel = METRICS.find((m) => m.key === sideMetric)!.label;

  return (
    <div
      ref={rootRef}
      onKeyDown={handleGridKeyDown}
      onFocus={handleGridFocus}
      className="flex-1 flex flex-col w-full min-h-0 overflow-hidden"
    >
      {/* Ay özeti — sayaç animasyonu bu bileşenin içinde kalır */}
      <MonthStats
        production={stats.production}
        revenue={stats.revenue}
        netProfit={stats.netProfit}
      />

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
          className="tap-target shrink-0 w-7 h-7 rounded-lg grid place-items-center hover:bg-muted hover:text-foreground active:scale-90 transition-all"
        >
          {density === "normal" ? <Rows3 className="w-4 h-4" /> : <Rows4 className="w-4 h-4" />}
        </button>
      </div>

      {/* Tablo başlığı — isim yerine baş harf, yer kazandırır */}
      <div
        ref={headerRef}
        className="h-scroll-touch overflow-hidden flex no-scrollbar bg-surface shrink-0"
      >
        <div className="min-w-full flex text-[11px] text-muted-foreground border-y border-border/60">
          <div
            style={{ width: COL.day }}
            className="shrink-0 py-2 text-center sticky left-0 z-20 bg-surface border-r border-border/50"
          >
            Gün
          </div>
          {activeWorkers.map((w, workerIndex) => (
            <button
              key={w.id}
              type="button"
              onClick={() => onWorkerClick?.(w)}
              aria-label={`${w.name} detayını aç`}
              title={w.name}
              tabIndex={rovingRow === 0 && rovingCol === workerIndex + 1 ? 0 : -1}
              data-cal-cell={`0-${workerIndex + 1}`}
              style={WORKER_CELL}
              className="tap-target py-1.5 grid place-items-center active:scale-90 transition-transform"
            >
              <WorkerAvatar worker={w} size="xs" label={initials.get(w.id)} />
            </button>
          ))}
          <button
            type="button"
            onClick={cycleSideMetric}
            aria-label={`Sağ sütun: ${activeMetricLabel}. Değiştirmek için dokunun.`}
            tabIndex={rovingRow === 0 && rovingCol === activeWorkers.length + 1 ? 0 : -1}
            data-cal-cell={`0-${activeWorkers.length + 1}`}
            style={{ width: COL.side }}
            className="tap-target shrink-0 py-2 sticky right-0 z-20 bg-surface border-l border-border/50 text-primary flex items-center justify-center gap-1 active:scale-95 transition-transform"
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
      <div
        ref={scrollRef}
        className="h-scroll-touch flex-1 overflow-auto no-scrollbar pb-safe-content"
      >
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
                  attendance={attendanceByDate.get(dateStr) ?? EMPTY_DAY}
                  readOnly={isClosed}
                  density={DENSITY[density]}
                  onDayClick={handleDayClick}
                  onCellTap={handleCellTap}
                  rowIndex={index + 1}
                  tabbableCol={rovingRow === index + 1 ? rovingCol : null}
                  attachRowRef={isToday(date) ? attachTodayRow : undefined}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
