import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import {
  CheckCircle2,
  XCircle,
  MinusCircle,
  ReceiptText,
  Wallet,
  Palmtree,
  CopyPlus,
  Eraser,
  Archive,
} from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { useToastStore } from "../stores/toastStore";

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

const STATUS_BUTTONS: {
  status: AttendanceStatus;
  label: string;
  icon: typeof CheckCircle2;
  activeClass: string;
  idleClass: string;
}[] = [
  {
    status: "FULL",
    label: "Tam",
    icon: CheckCircle2,
    activeClass: "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20",
    idleClass: "bg-transparent text-emerald-600 border-emerald-200 hover:bg-emerald-50",
  },
  {
    status: "HALF",
    label: "Yarım",
    icon: MinusCircle,
    activeClass: "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/20",
    idleClass: "bg-transparent text-amber-600 border-amber-200 hover:bg-amber-50",
  },
  {
    status: "ABSENT",
    label: "Yok",
    icon: XCircle,
    activeClass: "bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/20",
    idleClass: "bg-transparent text-rose-600 border-rose-200 hover:bg-rose-50",
  },
  {
    status: "HOLIDAY",
    label: "İzin",
    icon: Palmtree,
    activeClass: "bg-sky-500 text-white border-sky-500 shadow-md shadow-sky-500/20",
    idleClass: "bg-transparent text-sky-600 border-sky-200 hover:bg-sky-50",
  },
];

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

  const isLoading = attLoading || metricsLoading;

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

  const [production, setProduction] = useState<number>(0);
  const [totalEarned, setTotalEarned] = useState<number>(0);
  const [extraExpenses, setExtraExpenses] = useState<number>(0);
  const [isHoliday, setIsHoliday] = useState<boolean>(false);
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

  // Gün değiştiğinde taslak düzenlemeler sıfırlanır.
  // Önceki günden otomatik kopyalama BİLEREK kaldırıldı: kullanıcı sadece
  // bakmak için açtığı bir günde "Kaydet"e bastığında dünün puantajı o güne
  // yazılıyordu. Artık kopyalama açık bir düğmeyle yapılır.
  const prevDateRef = useRef(dateStr);
  useEffect(() => {
    if (!dateStr || prevDateRef.current === dateStr) return;
    setEdits({});
    setIsDirty(false);
    setConfirmDiscard(false);
    prevDateRef.current = dateStr;
  }, [dateStr]);

  const savedStatusOf = useCallback(
    (workerId: number): AttendanceStatus | null => {
      const a = attendances.find(
        (att: Attendance) =>
          Number(att.worker_id) === Number(workerId) &&
          String(att.date).trim() === String(dateStr).trim(),
      );
      return a?.status ?? null;
    },
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
      return {
        totalWorkerCosts: 0,
        netProfit: 0,
        partnerShare: 0,
        individualEarnings: {} as Record<number, number>,
      };
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
      // Önce günün finansal verisi, sonra puantaj. Herhangi biri patlarsa
      // hata yukarı çıkar, pencere KAPANMAZ ve kullanıcı durumu görür.
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

  const numberInput =
    "flex h-12 w-full rounded-xl border border-border bg-muted/30 px-4 text-base font-bold font-mono tracking-tight transition-all focus:bg-background focus:border-primary focus:ring-0 outline-none";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && requestClose()}>
      <DialogContent
        className="max-w-md w-[95vw] max-h-[90vh] flex flex-col rounded-3xl p-0 gap-0 border-none shadow-2xl bg-background animate-scale-in"
        onInteractOutside={(e) => {
          if (isDirty) e.preventDefault();
        }}
      >
        <div className="px-5 pt-6 flex flex-col flex-1 min-h-0">
          <DialogHeader className="mb-3 shrink-0 text-left">
            <div className="flex justify-between items-center gap-3">
              <div className="flex-1 min-w-0">
                <DialogTitle className="text-lg font-black tracking-tight truncate">
                  {format(parseISO(dateStr), "dd MMMM yyyy, EEEE", { locale: tr })}
                </DialogTitle>
                {isDirty && (
                  <p className="text-[10px] font-bold text-amber-600 dark:text-amber-500 uppercase tracking-wider mt-0.5">
                    Kaydedilmemiş değişiklik var
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
                className={`shrink-0 h-9 px-3 rounded-xl border text-[10px] font-black uppercase tracking-wider flex items-center gap-1.5 transition-all active:scale-95 ${
                  isHoliday
                    ? "bg-sky-500 text-white border-sky-500 shadow-md shadow-sky-500/20"
                    : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                <Palmtree className="w-3.5 h-3.5" />
                Resmî Tatil
              </button>
            </div>
          </DialogHeader>

          {isLoading ? (
            <DetailSkeleton />
          ) : (
            <div className="flex-1 overflow-y-auto no-scrollbar touch-pan-y -mx-5 px-5">
              <div className="space-y-4 pb-28">
                {/* Üretim ve finansal veriler */}
                <div className="p-4 rounded-2xl border bg-card border-border shadow-sm">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10 text-primary dark:bg-primary/20">
                      <ReceiptText className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">Günlük Performans</h3>
                      <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">
                        Veri & Finans
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label
                        htmlFor="day-production"
                        className="text-[11px] font-bold text-muted-foreground ml-1 mb-1.5 block uppercase tracking-wider"
                      >
                        Toplam Palet
                      </label>
                      <input
                        id="day-production"
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={production || ""}
                        onChange={(e) => {
                          setProduction(Math.max(parseFloat(e.target.value) || 0, 0));
                          markDirty();
                        }}
                        className={numberInput}
                        placeholder="0"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label
                          htmlFor="day-earned"
                          className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 ml-1 mb-1.5 block uppercase tracking-wider"
                        >
                          Ciro (₺)
                        </label>
                        <div className="relative">
                          <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400 dark:text-emerald-500" />
                          <input
                            id="day-earned"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={totalEarned || ""}
                            onChange={(e) => {
                              setTotalEarned(Math.max(parseFloat(e.target.value) || 0, 0));
                              markDirty();
                            }}
                            className={`${numberInput} pl-10 pr-3 focus:border-emerald-500`}
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div>
                        <label
                          htmlFor="day-expenses"
                          className="text-[11px] font-bold text-rose-600 dark:text-rose-400 ml-1 mb-1.5 block uppercase tracking-wider"
                        >
                          Gider (₺)
                        </label>
                        <div className="relative">
                          <ReceiptText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400 dark:text-rose-500" />
                          <input
                            id="day-expenses"
                            type="number"
                            inputMode="decimal"
                            min={0}
                            value={extraExpenses || ""}
                            onChange={(e) => {
                              setExtraExpenses(Math.max(parseFloat(e.target.value) || 0, 0));
                              markDirty();
                            }}
                            className={`${numberInput} pl-10 pr-3 focus:border-rose-500`}
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Günün özeti */}
                    <div className="grid grid-cols-2 gap-2.5 pt-1">
                      <div className="rounded-xl bg-muted/40 border px-3 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Yevmiye Gideri
                        </div>
                        <div className="text-sm font-black font-mono">
                          ₺{Math.round(calculations.totalWorkerCosts).toLocaleString("tr-TR")}
                        </div>
                      </div>
                      <div className="rounded-xl bg-muted/40 border px-3 py-2">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                          Net Kâr
                        </div>
                        <div
                          className={`text-sm font-black font-mono ${
                            calculations.netProfit < 0
                              ? "text-rose-600 dark:text-rose-400"
                              : "text-emerald-600 dark:text-emerald-400"
                          }`}
                        >
                          ₺{Math.round(calculations.netProfit).toLocaleString("tr-TR")}
                        </div>
                      </div>
                    </div>

                    {calculations.netProfit < 0 && (
                      <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold leading-relaxed">
                        Bu gün zararda. Zarar, çalışan ortaklar arasında gün ağırlığına göre
                        paylaştırılıyor.
                      </p>
                    )}
                  </div>
                </div>

                {/* Puantaj */}
                <div>
                  <div className="flex items-center justify-between mb-3 ml-1 pr-1 gap-2">
                    <h3 className="font-bold text-[11px] text-muted-foreground uppercase tracking-wider">
                      Çalışma Durumu
                    </h3>
                    <div className="flex gap-1.5">
                      <button
                        onClick={copyPreviousDay}
                        disabled={hasSavedAttendance}
                        className="px-2.5 py-1.5 bg-muted/60 text-foreground border rounded-lg text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform flex items-center gap-1 disabled:opacity-40"
                        title={
                          hasSavedAttendance
                            ? "Bu güne ait kayıt zaten var"
                            : "Bir önceki günün puantajını kopyala"
                        }
                      >
                        <CopyPlus className="w-3 h-3" /> Dünü Kopyala
                      </button>
                      <button
                        onClick={() => setAllTo("FULL")}
                        className="px-2.5 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400 rounded-lg text-[10px] font-black uppercase tracking-wider active:scale-95 transition-transform"
                      >
                        Tümü Tam
                      </button>
                      <button
                        onClick={() => setAllTo(null)}
                        aria-label="Tüm seçimleri temizle"
                        className="px-2 py-1.5 bg-muted/60 text-muted-foreground border rounded-lg active:scale-95 transition-transform"
                        title="Seçimleri temizle"
                      >
                        <Eraser className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="space-y-2.5">
                    {calcWorkers.map((worker: Worker) => {
                      const status = getWorkerStatus(worker.id);
                      const earnings = calculations.individualEarnings[worker.id] || 0;
                      const isArchived = worker.is_active === false;

                      return (
                        <div
                          key={worker.id}
                          className={`p-3.5 rounded-2xl border bg-card shadow-sm ${isArchived ? "opacity-70 border-dashed" : ""}`}
                        >
                          <div className="flex items-center justify-between mb-2.5 gap-2">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-white shrink-0 ${
                                  worker.worker_type === "ORTAK"
                                    ? "bg-linear-to-br from-amber-400 to-orange-500"
                                    : "bg-linear-to-br from-blue-400 to-indigo-500"
                                }`}
                              >
                                {worker.name.charAt(0).toUpperCase()}
                              </div>
                              <div className="min-w-0">
                                <p className="font-bold text-[13px] leading-tight truncate">
                                  {worker.name}
                                </p>
                                <p
                                  className={`text-[10px] font-bold uppercase flex items-center gap-1 ${
                                    worker.worker_type === "ORTAK"
                                      ? "text-amber-600 dark:text-amber-500"
                                      : "text-primary"
                                  }`}
                                >
                                  {worker.worker_type === "ORTAK" ? "Ortak" : "Günlük"}
                                  {isArchived && (
                                    <span className="text-muted-foreground inline-flex items-center gap-0.5">
                                      <Archive className="w-2.5 h-2.5" /> arşivde
                                    </span>
                                  )}
                                </p>
                              </div>
                            </div>
                            <div className="text-right shrink-0">
                              <p
                                className={`text-sm font-black font-mono tracking-tight ${earnings >= 0 ? "text-foreground" : "text-rose-600"}`}
                              >
                                ₺{Math.round(earnings).toLocaleString("tr-TR")}
                              </p>
                              <p className="text-[10px] text-muted-foreground font-bold uppercase tracking-wider">
                                Hakediş
                              </p>
                            </div>
                          </div>

                          {isArchived ? (
                            <p className="text-[11px] text-muted-foreground font-medium">
                              Arşivlenmiş çalışan — bu günün kaydı olduğu için hesaba dahil, ancak
                              buradan değiştirilemez.
                            </p>
                          ) : (
                            <div className="grid grid-cols-4 gap-1.5">
                              {STATUS_BUTTONS.map(
                                ({ status: s, label, icon: Icon, activeClass, idleClass }) => {
                                  const active = status === s;
                                  return (
                                    <button
                                      key={s}
                                      type="button"
                                      aria-pressed={active}
                                      aria-label={`${worker.name}: ${label}`}
                                      className={`h-11 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-black uppercase border transition-all active:scale-95 ${active ? activeClass : idleClass}`}
                                      onClick={() => {
                                        setEdits((prev) => ({
                                          ...prev,
                                          [worker.id]: active ? null : s,
                                        }));
                                        markDirty();
                                      }}
                                    >
                                      <Icon className="w-4 h-4" />
                                      {label}
                                    </button>
                                  );
                                },
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="py-4 border-t mt-auto bg-background shrink-0 flex gap-3 px-5 rounded-b-3xl">
            <button
              className="w-1/3 rounded-2xl h-12 font-bold text-muted-foreground bg-muted/50 hover:bg-muted transition-all active:scale-[0.97] text-sm"
              onClick={requestClose}
            >
              İptal
            </button>
            <button
              disabled={isSaving}
              className={`w-2/3 rounded-2xl h-12 font-black text-white bg-linear-to-r from-primary to-purple-600 shadow-lg shadow-primary/20 transition-all active:scale-[0.97] text-sm ${isSaving ? "opacity-60 cursor-not-allowed" : ""}`}
              onClick={handleSave}
            >
              {isSaving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </div>
      </DialogContent>

      {/* Kaydedilmemiş değişiklik uyarısı */}
      <Dialog open={confirmDiscard} onOpenChange={setConfirmDiscard}>
        <DialogContent className="w-[90%] max-w-sm rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-lg font-black">Değişiklikler kaydedilmedi</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-medium py-2">
            Bu günde kaydedilmemiş düzenlemeler var. Çıkarsanız bu düzenlemeler kaybolur.
          </p>
          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-12 rounded-xl border font-bold text-xs hover:bg-muted"
              onClick={() => setConfirmDiscard(false)}
            >
              Düzenlemeye Dön
            </button>
            <button
              className="flex-1 h-12 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20"
              onClick={() => {
                setConfirmDiscard(false);
                setIsDirty(false);
                setEdits({});
                onClose();
              }}
            >
              Yine de Çık
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}
