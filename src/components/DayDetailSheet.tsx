import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "./ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { WorkerAvatar } from "./ui/worker-avatar";
import {
  Check,
  X,
  Minus,
  Palmtree,
  CopyPlus,
  Eraser,
  Archive,
  Lock,
  CheckCheck,
} from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { useToastStore } from "../stores/toastStore";
import { usePeriodStore } from "../stores/periodStore";
import { periodOf, formatPeriod } from "../lib/period";

import { format, parseISO, subDays } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Attendance, AttendanceStatus } from "../types";
import { calculateDailyEarnings, rateResolverFor } from "../utils/earningsCalculator";
import { DetailSkeleton } from "./ui/skeleton";

interface DayDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string | null;
}

type EditMap = Record<number, AttendanceStatus | null>;

/** Dört durum tek bir segment denetiminde toplanır — dört ayrı çerçeve yerine. */
const SEGMENTS: {
  status: AttendanceStatus;
  label: string;
  icon: typeof Check;
  active: string;
}[] = [
  { status: "FULL", label: "Tam", icon: Check, active: "bg-ok text-on-ok" },
  { status: "HALF", label: "Yarım", icon: Minus, active: "bg-warn text-on-warn" },
  { status: "ABSENT", label: "Yok", icon: X, active: "bg-bad text-on-bad" },
  { status: "HOLIDAY", label: "İzin", icon: Palmtree, active: "bg-info text-on-info" },
];

const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

export function DayDetailSheet({ isOpen, onClose, dateStr }: DayDetailSheetProps) {
  const allWorkers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);
  const attendances = useAttendanceStore((s) => s.attendances);
  const markAttendance = useAttendanceStore((s) => s.markAttendance);
  const attLoading = useAttendanceStore((s) => s.isLoading);
  const metrics = useMetricsStore((s) => s.metrics);
  const updateMetrics = useMetricsStore((s) => s.updateMetrics);
  const metricsLoading = useMetricsStore((s) => s.isLoading);
  const addToast = useToastStore((s) => s.addToast);
  const closedPeriods = usePeriodStore((s) => s.closed);

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
    if (!dateStr) return [];
    const ids = new Set(
      attendances
        .filter((a) => String(a.date).trim() === String(dateStr).trim())
        .map((a) => Number(a.worker_id)),
    );
    return allWorkers.filter((w) => w.is_active === false && ids.has(w.id));
  }, [allWorkers, attendances, dateStr]);

  const calcWorkers = useMemo(
    () => [...displayWorkers, ...archivedWithData],
    [displayWorkers, archivedWithData],
  );

  const [production, setProduction] = useState(0);
  const [totalEarned, setTotalEarned] = useState(0);
  const [extraExpenses, setExtraExpenses] = useState(0);
  const [isHoliday, setIsHoliday] = useState(false);
  const [edits, setEdits] = useState<EditMap>({});
  const [isSaving, setIsSaving] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);

  const markDirty = useCallback(() => setIsDirty(true), []);

  useEffect(() => {
    if (!dateStr) return;
    const dayMetric = metrics.find((m) => String(m.date).trim() === String(dateStr).trim());
    setProduction(dayMetric?.production_amount || 0);
    setTotalEarned(dayMetric?.total_earned || 0);
    setExtraExpenses(dayMetric?.extra_expenses || 0);
    setIsHoliday(Boolean(dayMetric?.is_holiday));
  }, [metrics, dateStr]);

  // Gün değiştiğinde taslak sıfırlanır. Önceki günden otomatik kopyalama
  // BİLEREK yok: sadece bakmak için açılan günde "Kaydet"e basınca dünün
  // puantajı o güne yazılıyordu. Kopyalama artık açık bir düğmeyle yapılır.
  const prevDateRef = useRef(dateStr);
  useEffect(() => {
    if (!dateStr || prevDateRef.current === dateStr) return;
    setEdits({});
    setIsDirty(false);
    setConfirmDiscard(false);
    prevDateRef.current = dateStr;
  }, [dateStr]);

  const savedStatusOf = useCallback(
    (workerId: number): AttendanceStatus | null =>
      attendances.find(
        (att: Attendance) =>
          Number(att.worker_id) === Number(workerId) &&
          String(att.date).trim() === String(dateStr).trim(),
      )?.status ?? null,
    [attendances, dateStr],
  );

  const getWorkerStatus = useCallback(
    (workerId: number): AttendanceStatus | null =>
      workerId in edits ? edits[workerId] : savedStatusOf(workerId),
    [edits, savedStatusOf],
  );

  const hasSavedAttendance = useMemo(
    () => displayWorkers.some((w) => savedStatusOf(w.id) !== null),
    [displayWorkers, savedStatusOf],
  );

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
    markDirty();
    addToast("Dünkü puantaj forma dolduruldu — kaydetmeyi unutmayın", "info");
  };

  const setAllTo = (status: AttendanceStatus | null) => {
    const next: EditMap = {};
    displayWorkers.forEach((w) => {
      next[w.id] = status;
    });
    setEdits(next);
    markDirty();
  };

  const calculations = useMemo(() => {
    if (!dateStr) {
      return { totalWorkerCosts: 0, netProfit: 0, partnerShare: 0, individualEarnings: {} };
    }
    const attMap: Record<number, AttendanceStatus | null> = {};
    calcWorkers.forEach((w) => {
      attMap[w.id] = getWorkerStatus(w.id);
    });
    return calculateDailyEarnings(
      calcWorkers,
      attMap,
      totalEarned,
      extraExpenses,
      rateResolverFor(dateStr, rateHistory),
    );
  }, [calcWorkers, getWorkerStatus, dateStr, totalEarned, extraExpenses, rateHistory]);

  const handleSave = async () => {
    if (!dateStr || isSaving) return;
    setIsSaving(true);
    try {
      // Önce günün finansal verisi, sonra puantaj. Herhangi biri patlarsa hata
      // yukarı çıkar, sayfa KAPANMAZ ve kullanıcı durumu görür.
      await updateMetrics(
        dateStr,
        Number(production),
        Number(totalEarned),
        Number(extraExpenses),
        isHoliday,
      );

      for (const w of displayWorkers) {
        const newStatus = getWorkerStatus(w.id);
        if (newStatus !== savedStatusOf(w.id)) {
          await markAttendance(w.id, dateStr, newStatus);
        }
      }

      setIsDirty(false);
      addToast("Gün kaydedildi", "success");
      onClose();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[DayDetailSheet] Save error:", err);
      addToast(`Kaydedilemedi: ${msg}`, "error");
    } finally {
      setIsSaving(false);
    }
  };

  const requestClose = () => {
    if (isDirty && !isSaving) {
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
            if (isDirty) e.preventDefault();
          }}
          className="mx-auto w-full max-w-md h-[92vh] rounded-t-sheet border-t-0 p-0 gap-0 bg-background"
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
                {isClosed ? (
                  <p className="text-[11px] text-info flex items-center gap-1 mt-0.5">
                    <Lock className="w-3 h-3" />
                    {formatPeriod(periodOf(dateStr))} kapalı — salt okunur
                  </p>
                ) : isDirty ? (
                  <p className="text-[11px] text-warn mt-0.5">Kaydedilmemiş değişiklik var</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground mt-0.5 capitalize">
                    {format(parseISO(dateStr), "EEEE", { locale: tr })}
                  </p>
                )}
              </div>

              <button
                type="button"
                onClick={() => {
                  setIsHoliday((v) => !v);
                  markDirty();
                }}
                aria-pressed={isHoliday}
                disabled={isClosed}
                className={`shrink-0 h-9 px-3 rounded-control text-[12px] font-medium flex items-center gap-1.5 transition-all active:scale-95 disabled:opacity-50 ${
                  isHoliday
                    ? "bg-info text-on-info"
                    : "bg-muted/60 text-muted-foreground hover:text-foreground"
                }`}
              >
                <Palmtree className="w-3.5 h-3.5" />
                Tatil
              </button>
            </div>
          </SheetHeader>

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
                    value={production || ""}
                    onChange={(e) => {
                      setProduction(Math.max(parseFloat(e.target.value) || 0, 0));
                      markDirty();
                    }}
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
                    value={totalEarned || ""}
                    onChange={(e) => {
                      setTotalEarned(Math.max(parseFloat(e.target.value) || 0, 0));
                      markDirty();
                    }}
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
                    value={extraExpenses || ""}
                    onChange={(e) => {
                      setExtraExpenses(Math.max(parseFloat(e.target.value) || 0, 0));
                      markDirty();
                    }}
                    className={fieldClass}
                    placeholder="0"
                  />
                </label>
              </div>

              {/* Hesaplanan özet — çerçevesiz, sadece ayraçla */}
              <div className="mt-4 py-3 border-y border-border/60 flex items-center justify-between text-[13px]">
                <span className="text-muted-foreground">Yevmiye gideri</span>
                <span className="font-semibold tabular-nums">
                  {money(calculations.totalWorkerCosts)}
                </span>
                <span className="w-px h-4 bg-border" />
                <span className="text-muted-foreground">Net kâr</span>
                <span
                  className={`font-semibold tabular-nums ${
                    calculations.netProfit < 0 ? "text-bad" : "text-ok"
                  }`}
                >
                  {money(calculations.netProfit)}
                </span>
              </div>

              {calculations.netProfit < 0 && (
                <p className="mt-2 text-[12px] text-bad leading-relaxed">
                  Bu gün zararda. Zarar, çalışan ortaklar arasında gün ağırlığına göre
                  paylaştırılıyor.
                </p>
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
                    className="h-8 px-2.5 rounded-lg bg-muted/60 text-[12px] text-muted-foreground hover:text-foreground flex items-center gap-1.5 active:scale-95 transition-all disabled:opacity-40"
                  >
                    <CopyPlus className="w-3.5 h-3.5" /> Dünü kopyala
                  </button>
                  <button
                    onClick={() => setAllTo("FULL")}
                    disabled={isClosed}
                    title="Tümünü tam gün yap"
                    aria-label="Tümünü tam gün yap"
                    className="h-8 w-8 rounded-lg bg-muted/60 text-muted-foreground hover:text-ok flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
                  >
                    <CheckCheck className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => setAllTo(null)}
                    disabled={isClosed}
                    title="Seçimleri temizle"
                    aria-label="Tüm seçimleri temizle"
                    className="h-8 w-8 rounded-lg bg-muted/60 text-muted-foreground hover:text-foreground flex items-center justify-center active:scale-95 transition-all disabled:opacity-40"
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
                          <WorkerAvatar name={worker.name} type={worker.worker_type} />
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
                            {money(earnings)}
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
                                onClick={() => {
                                  setEdits((prev) => ({ ...prev, [worker.id]: on ? null : s }));
                                  markDirty();
                                }}
                                className={`flex-1 h-10 rounded-[0.6rem] flex items-center justify-center gap-1 text-[12px] font-medium transition-all active:scale-95 disabled:opacity-50 ${
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
                setIsDirty(false);
                setEdits({});
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
