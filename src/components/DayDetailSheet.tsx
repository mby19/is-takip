import { useState, useEffect, useMemo, useRef } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { CheckCircle2, XCircle, MinusCircle, ReceiptText, Wallet } from "lucide-react";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { useToastStore } from "../stores/toastStore";
import { fetchQuery, executeQuery } from "../lib/db";
import { format, parseISO, subDays } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Attendance } from "../types";
import { calculateDailyEarnings } from "../utils/earningsCalculator";
import { DetailSkeleton } from "./ui/skeleton";

interface DayDetailSheetProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string | null;
}

export function DayDetailSheet({ isOpen, onClose, dateStr }: DayDetailSheetProps) {
  const allWorkers = useWorkerStore((s) => s.workers);
  const attendances = useAttendanceStore((s) => s.attendances);
  const markAttendance = useAttendanceStore((s) => s.markAttendance);
  const attLoading = useAttendanceStore((s) => s.isLoading);
  const metrics = useMetricsStore((s) => s.metrics);
  const updateMetrics = useMetricsStore((s) => s.updateMetrics);
  const metricsLoading = useMetricsStore((s) => s.isLoading);

  const isLoading = attLoading || metricsLoading;

  // Arşivlenmiş çalışanları gizle
  const workers = useMemo(() => allWorkers.filter((w) => w.is_active !== false), [allWorkers]);

  const [production, setProduction] = useState<number>(0);
  const [totalEarned, setTotalEarned] = useState<number>(0);
  const [extraExpenses, setExtraExpenses] = useState<number>(0);
  const [isHoliday, setIsHoliday] = useState<boolean>(false);
  const [edits, setEdits] = useState<Record<number, "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null>>(
    {},
  );
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (dateStr) {
      const dayMetric = metrics.find((m) => String(m.date).trim() === String(dateStr).trim());
      if (dayMetric) {
        setProduction(dayMetric.production_amount || 0);
        setTotalEarned(dayMetric.total_earned || 0);
        setExtraExpenses(dayMetric.extra_expenses || 0);
        setIsHoliday(Boolean(dayMetric.is_holiday));
      } else {
        setProduction(0);
        setTotalEarned(0);
        setExtraExpenses(0);
        setIsHoliday(false);
      }
    }
  }, [metrics, dateStr]);

  const prevDateRef = useRef(dateStr);
  useEffect(() => {
    if (!dateStr || prevDateRef.current === dateStr) return;
    const prevDateStr = format(subDays(parseISO(dateStr), 1), "yyyy-MM-dd");

    const hasExistingData = workers.some((w) =>
      attendances.some(
        (a: Attendance) =>
          Number(a.worker_id) === Number(w.id) && String(a.date).trim() === String(dateStr).trim(),
      ),
    );

    if (!hasExistingData) {
      const prevDateEdits: Record<number, "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null> = {};
      workers.forEach((w) => {
        const prevDayAtt = attendances.find(
          (a: Attendance) =>
            Number(a.worker_id) === Number(w.id) && String(a.date).trim() === prevDateStr,
        );
        if (prevDayAtt?.status) {
          prevDateEdits[w.id] = prevDayAtt.status as "FULL" | "HALF" | "ABSENT" | "HOLIDAY";
        }
      });
      setEdits(prevDateEdits);
    } else {
      setEdits({});
    }

    prevDateRef.current = dateStr;
  }, [dateStr, workers, attendances]);

  const getWorkerStatus = (workerId: number) => {
    if (workerId in edits) return edits[workerId];
    const a = attendances.find(
      (att: Attendance) =>
        Number(att.worker_id) === Number(workerId) &&
        String(att.date).trim() === String(dateStr).trim(),
    );
    return a?.status || null;
  };

  const calculations = useMemo(() => {
    if (!dateStr)
      return {
        totalWorkerCosts: 0,
        netProfit: 0,
        partnerShare: 0,
        individualEarnings: {} as Record<number, number>,
      };

    const attMap: Record<number, "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null> = {};
    workers.forEach((w) => {
      if (w.id in edits) {
        attMap[w.id] = edits[w.id];
      } else {
        const a = attendances.find(
          (att: Attendance) =>
            Number(att.worker_id) === Number(w.id) &&
            String(att.date).trim() === String(dateStr).trim(),
        );
        attMap[w.id] = a?.status || null;
      }
    });

    return calculateDailyEarnings(workers, attMap, totalEarned, extraExpenses);
  }, [workers, edits, attendances, dateStr, totalEarned, extraExpenses]);

  const handleSaveProduction = async () => {
    if (!dateStr || isSaving) return;
    setIsSaving(true);
    try {
      // 1. Önceki Durumları Yakala (Loglama için)
      const dayMetric = metrics.find((m) => String(m.date).trim() === String(dateStr).trim());
      const oldProd = dayMetric?.production_amount || 0;
      const oldEarned = dayMetric?.total_earned || 0;
      const oldExpenses = dayMetric?.extra_expenses || 0;
      const oldHoliday = dayMetric?.is_holiday ? 1 : 0;

      const oldAttsParts = workers.map((w) => {
        const a = attendances.find(
          (att: Attendance) =>
            Number(att.worker_id) === Number(w.id) &&
            String(att.date).trim() === String(dateStr).trim(),
        );
        const status = a?.status || "YOK";
        return `${w.id}:${w.name}:${status}`;
      });
      const oldAttsStr = oldAttsParts.join(", ");
      const oldDataStr = `date=${dateStr}|production=${oldProd}|earned=${oldEarned}|expenses=${oldExpenses}|holiday=${oldHoliday}|atts=${oldAttsStr}`;

      // 2. Çalışma durumunu güncelle (Tetikleyici tetiklenmeyecek)
      for (const w of workers) {
        const newStatus = getWorkerStatus(w.id);
        const oldStatus =
          attendances.find(
            (a) =>
              Number(a.worker_id) === Number(w.id) &&
              String(a.date).trim() === String(dateStr).trim(),
          )?.status || null;

        if (newStatus !== oldStatus) {
          await markAttendance(w.id, dateStr, newStatus, w.name);
        }
      }

      // 3. Metrikleri güncelle (Tetikleyici tetiklenmeyecek)
      await updateMetrics(
        dateStr,
        Number(production),
        Number(totalEarned),
        Number(extraExpenses),
        isHoliday,
      );

      // 4. Sonraki Durumları Yakala (Loglama için)
      const newProd = Number(production) || 0;
      const newEarned = Number(totalEarned) || 0;
      const newExpenses = Number(extraExpenses) || 0;
      const newHoliday = isHoliday ? 1 : 0;

      const newAttsParts = workers.map((w) => {
        const status = getWorkerStatus(w.id) || "YOK";
        return `${w.id}:${w.name}:${status}`;
      });
      const newAttsStr = newAttsParts.join(", ");
      const newDataStr = `date=${dateStr}|production=${newProd}|earned=${newEarned}|expenses=${newExpenses}|holiday=${newHoliday}|atts=${newAttsStr}`;

      // 5. Birleştirilmiş Tek Bir Geçmiş Kaydı Ekle (Audit Log)
      try {
        const actionType = dayMetric ? "UPDATE" : "INSERT";

        type IdResult = { id: number };
        const metricRow = await fetchQuery<IdResult>(
          "SELECT id FROM daily_metrics WHERE date = ?",
          [dateStr],
        );
        const recordId = metricRow.length > 0 ? metricRow[0].id : 0;

        if (recordId > 0) {
          await executeQuery(
            "INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data) VALUES (?, ?, ?, ?, ?)",
            [
              actionType,
              "daily_metrics",
              recordId,
              actionType === "UPDATE" ? oldDataStr : null,
              newDataStr,
            ],
          );
          console.log("[DayDetailSheet] Consolidated daily audit log created successfully!");
        }
      } catch (err) {
        console.error("[DayDetailSheet] Manual audit log error:", err);
      }

      onClose();
    } catch (err) {
      console.error("[DayDetailSheet] Save error:", err);
      useToastStore.getState().addToast("Kayıt sırasında bir hata oluştu", "error");
    } finally {
      setIsSaving(false);
    }
  };

  if (!dateStr) return null;

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        className="max-w-md w-[95vw] max-h-[90vh] flex flex-col rounded-3xl p-0 gap-0 border-none shadow-2xl bg-background animate-scale-in"
      >
        <div className="px-5 pt-6 flex flex-col flex-1 min-h-0">
          {/* Header */}
          <DialogHeader className="mb-3 flex-shrink-0 text-left">
            <div className="flex justify-between items-center">
              <div className="flex-1 min-w-0 pr-3">
                <DialogTitle className="text-lg font-black tracking-tight truncate">
                  {format(parseISO(dateStr), "dd MMMM yyyy, EEEE", { locale: tr })}
                </DialogTitle>
              </div>
            </div>
          </DialogHeader>

          {isLoading ? (
            <DetailSkeleton />
          ) : (
            <div className="flex-1 overflow-y-auto no-scrollbar touch-pan-y -mx-5 px-5">
              <div className="space-y-4 pb-28">
                {/* Üretim ve Finansal */}
                <div className="p-4 rounded-2xl border bg-card border-border shadow-sm">
                  <div className="flex items-center gap-2.5 mb-4">
                    <div className="w-9 h-9 rounded-xl flex items-center justify-center bg-primary/10 text-primary dark:bg-primary/20">
                      <ReceiptText className="w-4.5 h-4.5" />
                    </div>
                    <div>
                      <h3 className="font-bold text-sm">Günlük Performans</h3>
                      <p className="text-[9px] text-muted-foreground font-medium uppercase tracking-wider">
                        Veri & Finans
                      </p>
                    </div>
                  </div>

                  <div className="space-y-3">
                    <div>
                      <label className="text-[10px] font-bold text-muted-foreground ml-1 mb-1.5 block uppercase tracking-wider">
                        Toplam Palet
                      </label>
                      <input
                        type="number"
                        inputMode="decimal"
                        value={production || ""}
                        onChange={(e) => setProduction(parseFloat(e.target.value) || 0)}
                        className="flex h-12 w-full rounded-xl border border-border bg-muted/30 px-4 text-base font-bold transition-all focus:bg-background focus:border-primary focus:ring-0 outline-none"
                        placeholder="Miktar"
                      />
                    </div>

                    <div className="grid grid-cols-2 gap-2.5">
                      <div>
                        <label className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 ml-1 mb-1.5 block uppercase tracking-wider">
                          Toplam Kazanç (₺)
                        </label>
                        <div className="relative">
                          <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-emerald-400 dark:text-emerald-500" />
                          <input
                            type="number"
                            inputMode="decimal"
                            value={totalEarned || ""}
                            onChange={(e) => setTotalEarned(parseFloat(e.target.value) || 0)}
                            className="flex h-12 w-full rounded-xl border border-border bg-muted/30 pl-10 pr-3 text-base font-bold transition-all focus:bg-background focus:border-emerald-500 focus:ring-0 outline-none"
                            placeholder="0"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-[10px] font-bold text-rose-600 dark:text-rose-400 ml-1 mb-1.5 block uppercase tracking-wider">
                          Gider (₺)
                        </label>
                        <div className="relative">
                          <ReceiptText className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-rose-400 dark:text-rose-500" />
                          <input
                            type="number"
                            inputMode="decimal"
                            value={extraExpenses || ""}
                            onChange={(e) => setExtraExpenses(parseFloat(e.target.value) || 0)}
                            className="flex h-12 w-full rounded-xl border border-border bg-muted/30 pl-10 pr-3 text-base font-bold transition-all focus:bg-background focus:border-rose-500 focus:ring-0 outline-none"
                            placeholder="0"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Çalışanlar Çalışma Durumu */}
                <div>
                  <div className="flex items-center justify-between mb-3 ml-1 pr-1">
                    <h3 className="font-bold text-[10px] text-muted-foreground uppercase tracking-wider">
                      Çalışma Durumu
                    </h3>
                    <div className="flex gap-1.5">
                      <button
                        onClick={() => {
                          const newEdits: Record<
                            number,
                            "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null
                          > = {};
                          workers.forEach((w) => {
                            newEdits[w.id] = "FULL";
                          });
                          setEdits(newEdits);
                        }}
                        className="px-2.5 py-1.5 bg-emerald-50 text-emerald-600 border border-emerald-200 dark:bg-emerald-500/10 dark:border-emerald-500/20 dark:text-emerald-400 rounded-lg text-[9px] font-black uppercase tracking-wider active:scale-95 transition-transform"
                      >
                        Tümünü Tam
                      </button>
                      <button
                        onClick={() => {
                          const newEdits: Record<
                            number,
                            "FULL" | "HALF" | "ABSENT" | "HOLIDAY" | null
                          > = {};
                          workers.forEach((w) => {
                            newEdits[w.id] = "ABSENT";
                          });
                          setEdits(newEdits);
                        }}
                        className="px-2.5 py-1.5 bg-rose-50 text-rose-600 border border-rose-200 dark:bg-rose-500/10 dark:border-rose-500/20 dark:text-rose-400 rounded-lg text-[9px] font-black uppercase tracking-wider active:scale-95 transition-transform"
                      >
                        Tümünü Yok
                      </button>
                    </div>
                  </div>
                  <div className="space-y-2.5">
                    {workers.map((worker: Worker) => {
                      const status = getWorkerStatus(worker.id);
                      const earnings = calculations.individualEarnings[worker.id] || 0;
                      return (
                        <div key={worker.id} className="p-3.5 rounded-2xl border bg-card shadow-sm">
                          {/* İsim ve Hakediş */}
                          <div className="flex items-center justify-between mb-2.5">
                            <div className="flex items-center gap-2.5">
                              <div
                                className={`w-8 h-8 rounded-lg flex items-center justify-center font-bold text-xs text-white ${
                                  worker.worker_type === "ORTAK"
                                    ? "bg-gradient-to-br from-amber-400 to-orange-500"
                                    : "bg-gradient-to-br from-blue-400 to-indigo-500"
                                }`}
                              >
                                {worker.name.charAt(0).toUpperCase()}
                              </div>
                              <div>
                                <p className="font-bold text-[13px] leading-tight">{worker.name}</p>
                                <p
                                  className={`text-[9px] font-bold uppercase ${
                                    worker.worker_type === "ORTAK"
                                      ? "text-amber-600 dark:text-amber-500"
                                      : "text-primary"
                                  }`}
                                >
                                  {worker.worker_type === "ORTAK" ? "Ortak" : "Günlük"}
                                </p>
                              </div>
                            </div>
                            <div className="text-right">
                              <p
                                className={`text-sm font-black ${earnings >= 0 ? "text-foreground" : "text-rose-600"}`}
                              >
                                ₺{Math.floor(earnings).toLocaleString("tr-TR")}
                              </p>
                              <p className="text-[8px] text-muted-foreground font-bold uppercase tracking-wider">
                                Hakediş
                              </p>
                            </div>
                          </div>

                          {/* Durum Butonları — 44px minimum dokunma alanı */}
                          <div className="flex gap-2">
                            <button
                              className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[10px] font-black uppercase border transition-all active:scale-95 ${
                                status === "FULL"
                                  ? "bg-emerald-500 text-white border-emerald-500 shadow-md shadow-emerald-500/20"
                                  : "bg-transparent text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                              }`}
                              onClick={() => {
                                setEdits((prev) => ({
                                  ...prev,
                                  [worker.id]: status === "FULL" ? null : "FULL",
                                }));
                              }}
                            >
                              <CheckCircle2 className="w-4 h-4" />
                              Tam
                            </button>
                            <button
                              className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[10px] font-black uppercase border transition-all active:scale-95 ${
                                status === "HALF"
                                  ? "bg-amber-500 text-white border-amber-500 shadow-md shadow-amber-500/20"
                                  : "bg-transparent text-amber-600 border-amber-200 hover:bg-amber-50"
                              }`}
                              onClick={() => {
                                setEdits((prev) => ({
                                  ...prev,
                                  [worker.id]: status === "HALF" ? null : "HALF",
                                }));
                              }}
                            >
                              <MinusCircle className="w-4 h-4" />
                              Yarım
                            </button>
                            <button
                              className={`flex-1 h-11 rounded-xl flex items-center justify-center gap-1.5 text-[10px] font-black uppercase border transition-all active:scale-95 ${
                                status === "ABSENT"
                                  ? "bg-rose-500 text-white border-rose-500 shadow-md shadow-rose-500/20"
                                  : "bg-transparent text-rose-600 border-rose-200 hover:bg-rose-50"
                              }`}
                              onClick={() => {
                                setEdits((prev) => ({
                                  ...prev,
                                  [worker.id]: status === "ABSENT" ? null : "ABSENT",
                                }));
                              }}
                            >
                              <XCircle className="w-4 h-4" />
                              Yok
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Kaydet ve İptal Butonları — sabit altta */}
          <div className="py-4 border-t mt-auto bg-background flex-shrink-0 flex gap-3 px-5 rounded-b-3xl">
            <button
              className="w-1/3 rounded-2xl h-12 font-bold text-muted-foreground bg-muted/50 hover:bg-muted transition-all active:scale-[0.97] text-sm"
              onClick={onClose}
            >
              İptal
            </button>
            <button
              disabled={isSaving}
              className={`w-2/3 rounded-2xl h-12 font-black text-white bg-gradient-to-r from-primary to-purple-600 shadow-lg shadow-primary/20 transition-all active:scale-[0.97] text-sm ${isSaving ? "opacity-60 cursor-not-allowed" : ""}`}
              onClick={handleSaveProduction}
            >
              {isSaving ? "Kaydediliyor..." : "Kaydet"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
