import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { WorkerAvatar } from "./ui/worker-avatar";
import { Check, X, Minus, CopyPlus, Eraser, Archive, Lock, CheckCheck } from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { useToastStore } from "../stores/toastStore";
import { usePeriodStore } from "../stores/periodStore";
import { periodOf, formatPeriod } from "../lib/period";
import { formatMoney } from "../lib/utils";

import { format, parseISO, subDays } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Attendance, AttendanceStatus } from "../types";
import { calculateDailyEarnings, rateResolverFor } from "../utils/earningsCalculator";
import type { AttendanceUpsertEntry } from "../repositories/attendanceRepository";
import { DetailSkeleton } from "./ui/skeleton";

interface DayDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string | null;
}

type EditMap = Record<number, AttendanceStatus | null>;

/** Finansal alanlar — yalnızca bunlar değiştiyse `daily_metrics`'e yazılır. */
type FinancialField = "production" | "totalEarned" | "extraExpenses";
interface FinancialDraft {
  production: number;
  totalEarned: number;
  extraExpenses: number;
}

const EMPTY_FINANCIAL: FinancialDraft = {
  production: 0,
  totalEarned: 0,
  extraExpenses: 0,
};

const toFinancial = (draft: FinancialDraft): FinancialDraft => ({
  production: Number(draft.production) || 0,
  totalEarned: Number(draft.totalEarned) || 0,
  extraExpenses: Number(draft.extraExpenses) || 0,
});

/** İki finansal taslak arasındaki fark; boşsa hiçbir şey yazılmaz. */
const financialDiff = (before: FinancialDraft, after: FinancialDraft): FinancialField[] => {
  const left = toFinancial(before);
  const right = toFinancial(after);
  return (Object.keys(left) as FinancialField[]).filter((key) => left[key] !== right[key]);
};

/** Üç durum tek bir segment denetiminde toplanır — üç ayrı çerçeve yerine. */
const SEGMENTS: {
  status: AttendanceStatus;
  label: string;
  icon: typeof Check;
  active: string;
}[] = [
  { status: "FULL", label: "Tam", icon: Check, active: "bg-ok text-on-ok" },
  { status: "HALF", label: "Yarım", icon: Minus, active: "bg-warn text-on-warn" },
  { status: "ABSENT", label: "Yok", icon: X, active: "bg-bad text-on-bad" },
];

export function DayDetailSheet({ isOpen, onClose, dateStr }: DayDetailSheetProps) {
  const allWorkers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);
  const attendances = useAttendanceStore((s) => s.attendances);
  const markAttendanceMany = useAttendanceStore((s) => s.markAttendanceMany);
  const attLoading = useAttendanceStore((s) => s.isLoading);
  const fetchAttendanceByDate = useAttendanceStore((s) => s.fetchAttendanceByDate);
  const metrics = useMetricsStore((s) => s.metrics);
  const updateMetrics = useMetricsStore((s) => s.updateMetrics);
  const fetchMetricsByDate = useMetricsStore((s) => s.fetchMetricsByDate);
  const metricsLoading = useMetricsStore((s) => s.isLoading);
  const addToast = useToastStore((s) => s.addToast);
  const closedPeriods = usePeriodStore((s) => s.closed);

  // `dateStr` null iken `String(null)` = "null" ile karşılaştırmak, o güne
  // ait olmayan kayıtları eşleştiriyordu. Tek tipte bir anahtar türetilir.
  const dayKey = dateStr ? String(dateStr).trim() : "";

  const isLoading = attLoading || metricsLoading;

  const isClosed = useMemo(
    () => (dateStr ? closedPeriods.some((c) => c.period === periodOf(dateStr)) : false),
    [closedPeriods, dateStr],
  );

  const displayWorkers = useMemo(
    () => allWorkers.filter((w) => w.is_active !== false),
    [allWorkers],
  );

  /** O gün kaydı olan arşivlenmiş çalışanlar — hesaba girdikleri için gösterilir. */
  const archivedWithData = useMemo(() => {
    if (!dayKey) return [];
    const ids = new Set(
      attendances.filter((a) => String(a.date).trim() === dayKey).map((a) => Number(a.worker_id)),
    );
    return allWorkers.filter((w) => w.is_active === false && ids.has(w.id));
  }, [allWorkers, attendances, dayKey]);

  const calcWorkers = useMemo(
    () => [...displayWorkers, ...archivedWithData],
    [displayWorkers, archivedWithData],
  );

  const [financial, setFinancial] = useState<FinancialDraft>(EMPTY_FINANCIAL);
  const [edits, setEdits] = useState<EditMap>({});
  const [isSaving, setIsSaving] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  /**
   * Formun açılışta yüklendiği finansal değerler.
   *
   * "Kaydet"e hiç dokunmadan basmak, bu tabanla karşılaştırıldığında fark
   * çıkmaz — dolayısıyla o günün gerçek ciro/gider/üretimi 0'a ezilmez.
   */
  const [baseline, setBaseline] = useState<FinancialDraft>(EMPTY_FINANCIAL);
  /** Kullanıcı bir şeye dokundu mu? Dokunduysa sessiz tazeleme taslağı ezmez. */
  const touchedRef = useRef(false);

  const updateFinancial = useCallback((key: FinancialField, value: number) => {
    touchedRef.current = true;
    setFinancial((prev) => ({ ...prev, [key]: value }));
  }, []);

  const markAttendanceEdit = useCallback((workerId: number, status: AttendanceStatus | null) => {
    touchedRef.current = true;
    setEdits((prev) => ({ ...prev, [workerId]: status }));
  }, []);

  // Açılışta ve gün değiştiğinde formu doldur. Sessiz tazeleme: kullanıcı
  // alana dokunmuşsa (store önbelleği bayattır) taslak korunur.
  useEffect(() => {
    if (!dayKey) return;
    if (touchedRef.current) return;
    const dayMetric = metrics.find((m) => String(m.date).trim() === dayKey);
    const next: FinancialDraft = {
      production: dayMetric?.production_amount || 0,
      totalEarned: dayMetric?.total_earned || 0,
      extraExpenses: dayMetric?.extra_expenses || 0,
    };
    setFinancial(next);
    setBaseline(next);
  }, [metrics, dayKey]);

  // Gün değiştiğinde taslak sıfırlanır. Önceki günden otomatik kopyalama
  // BİLEREK yok: sadece bakmak için açılan günde "Kaydet"e basınca dünün
  // puantajı o güne yazılıyordu. Kopyalama artık açık bir düğmeyle yapılır.
  const prevDateRef = useRef(dateStr);
  useEffect(() => {
    if (!dateStr || prevDateRef.current === dateStr) return;
    setEdits({});
    setConfirmDiscard(false);
    touchedRef.current = false;
    prevDateRef.current = dateStr;
  }, [dateStr]);

  /**
   * Store önbelleği ayın yüklenmesinden geliyor ve bayat olabilir: sheet
   * açılışında ve pencere odağa döndüğünde günün güncel verisi tazelenir.
   */
  useEffect(() => {
    if (!isOpen || !dayKey) return;
    void fetchAttendanceByDate(dayKey, { silent: true });
    void fetchMetricsByDate(dayKey, { silent: true });

    const onFocus = () => {
      if (touchedRef.current) return;
      void fetchAttendanceByDate(dayKey, { silent: true });
      void fetchMetricsByDate(dayKey, { silent: true });
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [isOpen, dayKey, fetchAttendanceByDate, fetchMetricsByDate]);

  const savedStatusOf = useCallback(
    (workerId: number): AttendanceStatus | null =>
      attendances.find(
        (att: Attendance) =>
          Number(att.worker_id) === Number(workerId) && String(att.date).trim() === dayKey,
      )?.status ?? null,
    [attendances, dayKey],
  );

  const getWorkerStatus = useCallback(
    (workerId: number): AttendanceStatus | null =>
      workerId in edits ? edits[workerId] : savedStatusOf(workerId),
    [edits, savedStatusOf],
  );

  /** Yalnız bu güne ait kayıt sayısı — `dayKey` boşken yanlış eşleşme olmaz. */
  const savedAttendanceCount = useMemo(
    () => (dayKey ? attendances.filter((a) => String(a.date).trim() === dayKey).length : 0),
    [attendances, dayKey],
  );

  const hasSavedAttendance = savedAttendanceCount > 0;

  /** Bu kayıttan önce veritabanında duran finansal değerlerle farkı. */
  const changedFinancialFields = useMemo(
    () => financialDiff(baseline, financial),
    [baseline, financial],
  );

  /** Kaydedilmesi gereken puantaj farkları — değişiklik yoksa boş. */
  const pendingAttendance = useMemo<AttendanceUpsertEntry[]>(() => {
    if (!dayKey) return [];
    return displayWorkers
      .map((w) => ({ workerId: w.id, date: dayKey, status: getWorkerStatus(w.id) }))
      .filter((entry) => entry.status !== savedStatusOf(entry.workerId));
  }, [displayWorkers, dayKey, getWorkerStatus, savedStatusOf]);

  const hasUnsavedChanges = changedFinancialFields.length > 0 || pendingAttendance.length > 0;

  /** Bir önceki günün puantajını taslağa kopyalar (kaydedilene kadar uygulanmaz). */
  const copyPreviousDay = () => {
    if (!dateStr) return;
    const prevDateStr = format(subDays(parseISO(dateStr), 1), "yyyy-MM-dd");
    const copied: EditMap = {};

    for (const w of displayWorkers) {
      const prev = attendances.find(
        (a: Attendance) =>
          Number(a.worker_id) === Number(w.id) && String(a.date).trim() === prevDateStr,
      );
      if (prev?.status) copied[w.id] = prev.status;
    }

    if (Object.keys(copied).length === 0) {
      addToast("Önceki güne ait puantaj kaydı yok", "info");
      return;
    }

    setEdits(copied);
    touchedRef.current = true;
    addToast("Dünkü puantaj forma dolduruldu — kaydetmeyi unutmayın", "info");
  };

  const setAllTo = (status: AttendanceStatus | null) => {
    const next: EditMap = {};
    displayWorkers.forEach((w) => {
      next[w.id] = status;
    });
    setEdits(next);
    touchedRef.current = true;
  };

  const calculations = useMemo(() => {
    if (!dateStr) {
      return {
        totalWorkerCosts: 0,
        netProfit: 0,
        undistributed: 0,
        partnerShare: 0,
        individualEarnings: {},
      };
    }
    const attMap: Record<number, AttendanceStatus | null> = {};
    calcWorkers.forEach((w) => {
      attMap[w.id] = getWorkerStatus(w.id);
    });
    return calculateDailyEarnings(
      calcWorkers,
      attMap,
      Number(financial.totalEarned) || 0,
      Number(financial.extraExpenses) || 0,
      rateResolverFor(dateStr, rateHistory),
    );
  }, [calcWorkers, getWorkerStatus, dateStr, financial, rateHistory]);

  /**
   * Gün kaydı.
   *
   * Finansal alanlara yalnızca GERÇEKTEN değiştikleri yazılır; hiçbir şeye
   * dokunulmadan basılan «Kaydet» günün ciro/gider/üretimini 0'a ezmez.
   *
   * Puantajların tamamı TEK transaction'da yazılır (`markAttendanceMany`):
   * sıralı tekil yazmalarda hata ortasında oluştuğunda gün yarım kayıtlı
   * kalıyor, o günün hakedişi eksik hesaplanıyordu.
   */
  const handleSave = async () => {
    if (!dateStr || isSaving) return;
    setIsSaving(true);
    // Finansal veri ve puantaj iki AYRI transaction'da yazılır
    // (`updateMetrics` autocommit UPSERT, `markAttendanceMany` kendi
    // transaction'ı). İkincisi patlarsa gün YARI kayıtlı kalır: ciro kayıtlı,
    // puantaj yazılmamış. Bu iki kaydı tek transaction'da birleştirmek iki
    // store'un ve repository'nin değişmesini gerektirir (parametreli UPSERT,
    // iyimser UI geri alma, dönem kilidi kontrolü) — bu dosyanın işi değil.
    // O yüzden yarı kayıt olursa kullanıcıya AÇIKÇA söyleniyor; hata mesajı
    // "kaydedilemedi" deyip ciroyun kaydolduğunu saklamak daha kötüdür.
    let financialSaved = false;
    try {
      if (changedFinancialFields.length > 0) {
        // `is_holiday` kolonu duruyor ama artık UI'da karşılığı yok. Değeri
        // AYNEN geçiriyoruz: `false` göndermek, o güne ait bayrağı her
        // finansal kayıtta sessizce silerdi.
        const storedHoliday = Boolean(
          metrics.find((m) => String(m.date).trim() === dateStr)?.is_holiday,
        );
        await updateMetrics(
          dateStr,
          Number(financial.production) || 0,
          Number(financial.totalEarned) || 0,
          Number(financial.extraExpenses) || 0,
          storedHoliday,
        );
        financialSaved = true;
      }

      if (pendingAttendance.length > 0) {
        await markAttendanceMany(pendingAttendance);
      }

      if (changedFinancialFields.length === 0 && pendingAttendance.length === 0) {
        addToast("Değişiklik yok", "info");
      } else {
        addToast("Gün kaydedildi", "success");
      }
      setBaseline(financial);
      setEdits({});
      touchedRef.current = false;
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[DayDetailSheet] Save error:", err);
      if (financialSaved) {
        // Ciro kaydedildi, puantaj kaydedilemedi. Sessizce yutmak, günün
        // hakedişinin puantajsız hesaplanmasına yol açar.
        addToast(
          `Ciro kaydedildi ama puantaj kaydedilemedi: ${msg}. ` +
            "Günü yeniden açıp puantajı tekrar girin.",
          "error",
        );
        // Ciro artık kalıcı; formu "kaydedilmemiş" gibi bırakmamak için
        // tabanı günceller ki kullanıcı yalnız puantajı yeniden göndersin.
        setBaseline(financial);
        setEdits({});
        touchedRef.current = false;
      } else {
        addToast(`Kaydedilemedi: ${msg}`, "error");
      }
    } finally {
      setIsSaving(false);
    }
  };

  const requestClose = () => {
    if (hasUnsavedChanges && !isSaving) {
      setConfirmDiscard(true);
      return;
    }
    onClose();
  };

  if (!dateStr) return null;

  const fieldClass =
    "h-12 w-full rounded-control bg-muted/50 px-3.5 text-[15px] font-semibold tabular-nums " +
    "border border-transparent outline-none transition-colors " +
    "focus:border-primary focus:bg-background disabled:opacity-60";

  return (
    <>
      <Sheet open={isOpen} onOpenChange={(open) => !open && requestClose()}>
        <SheetContent
          side="bottom"
          showCloseButton={false}
          onInteractOutside={(e) => {
            if (hasUnsavedChanges) e.preventDefault();
          }}
          className="mx-auto w-full max-w-md h-[92vh] h-[92dvh] rounded-t-sheet border-t-0 p-0 gap-0 bg-background"
        >
          {/* Tutamak + başlık */}
          <SheetHeader className="p-0 gap-0 shrink-0">
            <div className="flex justify-center pt-2.5 pb-1">
              <div className="w-9 h-1 rounded-full bg-muted-foreground/25" />
            </div>
            <div className="px-5 pb-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <SheetTitle className="text-[17px] font-semibold tracking-tight truncate text-left">
                  {format(parseISO(dateStr), "d MMMM yyyy", { locale: tr })}
                </SheetTitle>
                {hasUnsavedChanges ? (
                  <p className="text-[11px] text-warn mt-0.5">Kaydedilmemiş değişiklik var</p>
                ) : isClosed ? (
                  <p className="text-[11px] text-info flex items-center gap-1 mt-0.5">
                    <Lock className="w-3 h-3" />
                    {formatPeriod(periodOf(dateStr))} kapalı — salt okunur
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                    {format(parseISO(dateStr), "EEEE", { locale: tr })}
                  </p>
                )}
              </div>
            </div>
          </SheetHeader>

          {/* Kilitli dönemde ön-uyarı: düğmeler yalnız soluklaşıyordu, nedenini
              kullanıcı ancak «Kaydet»e basınca öğreniyordu. */}
          {isClosed && (
            <div
              role="status"
              className="mx-5 mb-3 shrink-0 flex items-start gap-2 p-2.5 rounded-control bg-warn-soft border border-amber-200 dark:border-amber-500/20"
            >
              <Lock className="w-3.5 h-3.5 text-warn shrink-0 mt-0.5" />
              <p className="text-[11px] font-medium text-warn leading-relaxed">
                {formatPeriod(periodOf(dateStr))} dönemi kapatılmış. Bu gün salt okunur — değişiklik
                yapmak için Ayarlar → Dönem Kilidi&apos;den bu dönemi yeniden açın.
              </p>
            </div>
          )}

          {isLoading ? (
            <DetailSkeleton />
          ) : (
            <div className="flex-1 overflow-y-auto no-scrollbar px-5 pb-6">
              {/* Günün rakamları — iç içe kart yok, doğrudan alanlar */}
              <div className="grid grid-cols-2 gap-3">
                <label className="col-span-2 block">
                  <span className="text-[12px] text-muted-foreground mb-1.5 block">
                    Üretim (palet)
                  </span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    disabled={isClosed}
                    value={Number(financial.production) || ""}
                    onChange={(e) =>
                      updateFinancial("production", Math.max(parseFloat(e.target.value) || 0, 0))
                    }
                    className={fieldClass}
                    placeholder="0"
                  />
                </label>
                <label className="block">
                  <span className="text-[12px] text-muted-foreground mb-1.5 block">Ciro ₺</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    disabled={isClosed}
                    value={Number(financial.totalEarned) || ""}
                    onChange={(e) =>
                      updateFinancial("totalEarned", Math.max(parseFloat(e.target.value) || 0, 0))
                    }
                    className={fieldClass}
                    placeholder="0"
                  />
                </label>

                <label className="block">
                  <span className="text-[12px] text-muted-foreground mb-1.5 block">Gider ₺</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    disabled={isClosed}
                    value={Number(financial.extraExpenses) || ""}
                    onChange={(e) =>
                      updateFinancial("extraExpenses", Math.max(parseFloat(e.target.value) || 0, 0))
                    }
                    className={fieldClass}
                    placeholder="0"
                  />
                </label>
              </div>

              {/* Hesaplanan özet — çerçevesiz, sadece ayraçla */}
              <div className="mt-4 py-3 border-y border-border/60 flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Yevmiye gideri</span>
                <span className="font-semibold tabular-nums">
                  {formatMoney(calculations.totalWorkerCosts)}
                </span>
                <span className="w-px h-4 bg-border" />
                <span className="text-muted-foreground">Net kâr</span>
                <span
                  className={`font-semibold tabular-nums ${
                    calculations.netProfit < 0 ? "text-bad" : "text-ok"
                  }`}
                >
                  {formatMoney(calculations.netProfit)}
                </span>
              </div>

              {/* Dağıtılmayan tutar (ADR-0009): zararlı gün ortak payı
                  dağıtılmaz; kârlı gün aktif ortak yoksa kâr da dağıtılmaz.
                  Bu satır olmadan ortaklar neden 0 aldığını anlamıyor ve para
                  ekranda kaybolmuş görünüyor. */}
              {calculations.undistributed !== 0 && (
                <div
                  className={`mt-2 flex items-center justify-between gap-2 text-[12px] ${
                    calculations.undistributed < 0 ? "text-bad" : "text-muted-foreground"
                  }`}
                >
                  <span>
                    {calculations.undistributed < 0
                      ? "Bu gün zarar edildi — ortak payı dağıtılmadı"
                      : "Bu gün kâr gerçekleşti — dağıtılacak aktif ortak yoktu"}
                  </span>
                  <span className="font-semibold tabular-nums">
                    {formatMoney(calculations.undistributed)}
                  </span>
                </div>
              )}

              {/* Puantaj */}
              <div className="mt-5 flex items-center justify-between gap-2">
                <h3 className="text-[13px] font-medium text-muted-foreground">Puantaj</h3>
                <div className="flex gap-1.5">
                  <button
                    onClick={copyPreviousDay}
                    disabled={hasSavedAttendance || isClosed}
                    title={
                      hasSavedAttendance
                        ? "Bu güne ait kayıt zaten var"
                        : "Bir önceki günün puantajını kopyala"
                    }
                    className="tap-target px-2.5 rounded-lg bg-muted/60 text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-40"
                  >
                    <CopyPlus className="w-3.5 h-3.5" /> Dünü kopyala
                  </button>
                  <button
                    onClick={() => setAllTo("FULL")}
                    disabled={isClosed}
                    title="Tümünü tam gün yap"
                    aria-label="Tümünü tam gün yap"
                    className="tap-target rounded-lg bg-muted/60 text-muted-foreground hover:text-ok flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setAllTo(null)}
                    disabled={isClosed}
                    title="Seçimleri temizle"
                    aria-label="Tüm seçimleri temizle"
                    className="tap-target rounded-lg bg-muted/60 text-muted-foreground hover:text-foreground flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                  >
                    <Eraser className="w-4 h-4" />
                  </button>
                </div>
              </div>

              <div className="mt-2.5 space-y-2.5">
                {calcWorkers.map((worker: Worker) => {
                  const status = getWorkerStatus(worker.id);
                  const earnings = calculations.individualEarnings[worker.id] || 0;
                  const isArchived = worker.is_active === false;

                  return (
                    <div
                      key={worker.id}
                      className={`rounded-card surface-raised p-3 ${isArchived ? "opacity-70" : ""}`}
                    >
                      <div className="flex items-center justify-between gap-2 mb-2.5">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <WorkerAvatar worker={worker} />
                          <div className="min-w-0">
                            <p className="text-[14px] font-medium leading-tight truncate">
                              {worker.name}
                            </p>
                            <p className="text-[11px] text-muted-foreground flex items-center gap-1">
                              {worker.worker_type === "ORTAK" ? "Ortak" : "Yevmiyeli"}
                              {isArchived && (
                                <span className="inline-flex items-center gap-0.5">
                                  <Archive className="w-2.5 h-2.5" /> arşivde
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <p
                            className={`text-[15px] font-semibold tabular-nums ${
                              earnings < 0 ? "text-bad" : ""
                            }`}
                          >
                            {formatMoney(earnings)}
                          </p>
                        </div>
                      </div>

                      {isArchived ? (
                        <p className="text-[11px] text-muted-foreground">
                          Arşivlenmiş çalışan — bu günün kaydı olduğu için hesaba dahil, buradan
                          değiştirilemez.
                        </p>
                      ) : (
                        <div className="flex gap-1 p-1 rounded-control bg-muted/50">
                          {SEGMENTS.map(({ status: s, label, icon: Icon, active }) => {
                            const on = status === s;
                            return (
                              <button
                                key={s}
                                type="button"
                                aria-pressed={on}
                                disabled={isClosed}
                                aria-label={`${worker.name}: ${label}`}
                                onClick={() => markAttendanceEdit(worker.id, on ? null : s)}
                                className={`tap-target flex-1 rounded-[0.6rem] flex items-center justify-center gap-1 text-[12px] font-medium transition-all active:scale-95 disabled:opacity-50 ${
                                  on
                                    ? `${active} shadow-sm`
                                    : "text-foreground/65 hover:text-foreground hover:bg-background/60"
                                }`}
                              >
                                <Icon className="w-3.5 h-3.5" strokeWidth={2.5} />
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Eylemler */}
          <div className="shrink-0 px-5 py-3 border-t bg-background flex gap-3 pb-safe-nav">
            <button
              className="w-1/3 h-12 rounded-control bg-muted/60 text-[14px] font-medium text-muted-foreground hover:text-foreground active:scale-[0.97] transition-all"
              onClick={requestClose}
            >
              İptal
            </button>
            <button
              disabled={isSaving || isClosed}
              className="w-2/3 h-12 rounded-control bg-primary text-primary-foreground text-[14px] font-semibold shadow-sm active:scale-[0.97] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSave}
            >
              {isClosed ? "Dönem kapalı" : isSaving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Kaydedilmemiş değişiklik uyarısı */}
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="w-[90%] max-w-sm rounded-sheet p-6 border-none shadow-2xl">
          <DialogHeader className="mb-1">
            <DialogTitle className="text-base font-semibold">
              Değişiklikler kaydedilmedi
            </DialogTitle>
          </DialogHeader>
          <p className="text-[13px] text-muted-foreground leading-relaxed py-1">
            Bu günde kaydedilmemiş düzenlemeler var. Çıkarsanız bu düzenlemeler kaybolur.
          </p>
          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-11 rounded-control bg-muted/60 text-[13px] font-medium hover:bg-muted"
              onClick={() => setConfirmDiscard(false)}
            >
              Düzenlemeye dön
            </button>
            <button
              className="flex-1 h-11 rounded-control bg-bad text-on-bad text-[13px] font-medium"
              onClick={() => {
                setConfirmDiscard(false);
                setEdits({});
                touchedRef.current = false;
                onClose();
              }}
            >
              Yine de çık
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
