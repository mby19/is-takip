import { useState, useEffect, useMemo, useCallback } from "react";
import { usePaymentStore } from "../stores/paymentStore";
import { useWorkerStore, RATE_HISTORY_EPOCH } from "../stores/workerStore";
import { useToastStore } from "../stores/toastStore";
import { attendanceRepository } from "../repositories/attendanceRepository";
import { metricsRepository } from "../repositories/metricsRepository";
import {
  ArrowLeft,
  Wallet,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  MinusCircle,
  XCircle,
  Palmtree,
  Plus,
  Edit2,
  Archive,
  DownloadCloud,
  Trash2,
} from "lucide-react";
import { format, parseISO, startOfMonth } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Payment, Attendance, DailyMetric } from "../types";
import { calculateWorkerStats } from "../utils/calculations";
import { exportWorkerReport } from "../lib/workerReport";
import { DetailSkeleton } from "./ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Button } from "./ui/button";

interface WorkerDetailViewProps {
  worker: Worker;
  onBack: () => void;
}

const todayStr = () => format(new Date(), "yyyy-MM-dd");

export function WorkerDetailView({ worker, onBack }: WorkerDetailViewProps) {
  const payments = usePaymentStore((s) => s.payments);
  const fetchWorkerPayments = usePaymentStore((s) => s.fetchWorkerPayments);
  const addPayment = usePaymentStore((s) => s.addPayment);
  const deletePayment = usePaymentStore((s) => s.deletePayment);
  const payLoading = usePaymentStore((s) => s.isLoading);

  const workers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);
  const fetchWorkers = useWorkerStore((s) => s.fetchWorkers);
  const archiveWorker = useWorkerStore((s) => s.archiveWorker);
  const updateWorker = useWorkerStore((s) => s.updateWorker);
  const updateWorkerStatus = useWorkerStore((s) => s.updateWorkerStatus);

  const addToast = useToastStore((s) => s.addToast);

  /**
   * Puantaj ve gün verisi burada YEREL tutulur.
   * Global store'lar takvim ekranının içinde bulunduğu ayı taşıyor; buradan
   * onları doldurmak iki ekranın birbirinin verisini ezmesine yol açıyordu.
   */
  const [allAttendance, setAllAttendance] = useState<Attendance[]>([]);
  const [allMetrics, setAllMetrics] = useState<DailyMetric[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [payAmount, setPayAmount] = useState("");
  const [payDesc, setPayDesc] = useState("");
  const [payDate, setPayDate] = useState(todayStr());
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState(worker.name);
  const [editWage, setEditWage] = useState(worker.daily_wage.toString());
  const [editType, setEditType] = useState(worker.worker_type);
  const [effectiveFrom, setEffectiveFrom] = useState(todayStr());

  useEffect(() => {
    setEditName(worker.name);
    setEditWage(worker.daily_wage.toString());
    setEditType(worker.worker_type);
  }, [worker]);

  const reloadData = useCallback(async () => {
    setDataLoading(true);
    try {
      const [attendance, metrics] = await Promise.all([
        attendanceRepository.findAll(),
        metricsRepository.findAll(),
      ]);
      setAllAttendance(attendance);
      setAllMetrics(metrics);
    } catch (err: unknown) {
      addToast(`Veriler yüklenemedi: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setDataLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    fetchWorkerPayments(worker.id);
    fetchWorkers();
    reloadData();
  }, [worker.id, fetchWorkerPayments, fetchWorkers, reloadData]);

  const stats = useMemo(
    () =>
      calculateWorkerStats(
        worker,
        currentMonth,
        allMetrics,
        allAttendance,
        workers,
        payments,
        rateHistory,
      ),
    [worker, currentMonth, allMetrics, allAttendance, workers, payments, rateHistory],
  );

  const monthPayments = useMemo(
    () => payments.filter((p) => String(p.date).startsWith(format(currentMonth, "yyyy-MM"))),
    [payments, currentMonth],
  );

  const isLoading = dataLoading || payLoading;

  const handleExportPDF = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const saved = await exportWorkerReport(worker, currentMonth, stats, payments);
      if (saved) addToast(`Rapor kaydedildi: ${saved}`, "success");
    } catch (e: unknown) {
      console.error("[PDF] Export error:", e);
      addToast(`Rapor oluşturulamadı: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setIsExporting(false);
    }
  };

  const wageOrTypeChanged =
    parseFloat(editWage || "0") !== worker.daily_wage || editType !== worker.worker_type;

  const monthLabel = format(currentMonth, "MMMM yyyy", { locale: tr });

  const maxDailyEarning = useMemo(
    () => Math.max(0, ...stats.dailyBreakdown.map((d) => d.earned)),
    [stats.dailyBreakdown],
  );

  const attendanceTotal = stats.fullDays + stats.halfDays + stats.absentDays + stats.holidayDays;

  /** Katılım oranı izinli günleri paydaya katmaz — izin devamsızlık değildir. */
  const attendanceRate = useMemo(() => {
    const base = stats.fullDays + stats.halfDays + stats.absentDays;
    if (base === 0) return 0;
    return Math.round(((stats.fullDays + stats.halfDays * 0.5) / base) * 100);
  }, [stats.fullDays, stats.halfDays, stats.absentDays]);

  if (isLoading && allAttendance.length === 0 && payments.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background">
        <DetailSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="px-4 pt-safe-header pb-4 border-b bg-card flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          aria-label="Geri"
          className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div
          className={`w-10 h-10 rounded-full grid place-items-center text-[15px] font-semibold text-white shrink-0 ${
            worker.worker_type === "ORTAK" ? "bg-warn" : "bg-primary"
          }`}
        >
          {worker.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-[17px] font-semibold tracking-tight truncate">
            {worker.name}{" "}
            {worker.is_active === false && <span className="text-rose-500 text-xs">(Arşivde)</span>}
          </h1>
          <p
            className={`text-[10px] font-bold   ${
              worker.worker_type === "ORTAK" ? "text-amber-600 dark:text-amber-500" : "text-primary"
            }`}
          >
            {worker.worker_type === "ORTAK" ? "Ortak" : "Günlük Personel"}
          </p>
        </div>
        <button
          onClick={() => {
            setEffectiveFrom(todayStr());
            setIsEditOpen(true);
          }}
          aria-label="Çalışanı düzenle"
          className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
        >
          <Edit2 className="w-4 h-4 text-muted-foreground" />
        </button>
      </header>

      {/* Düzenleme */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="rounded-2xl border-none shadow-2xl mx-4 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-black">Çalışan Bilgilerini Düzenle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-muted-foreground ml-1">
                İsim Soyisim
              </Label>
              <Input
                placeholder="Çalışan İsmi"
                className="h-12 rounded-xl border bg-muted/30 font-bold"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-muted-foreground ml-1">
                Günlük Yevmiye (₺)
              </Label>
              <Input
                type="number"
                inputMode="decimal"
                placeholder="Örn: 1500"
                className="h-12 rounded-xl border bg-muted/30 font-bold text-base"
                value={editWage}
                onChange={(e) => setEditWage(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-bold text-muted-foreground ml-1">
                Çalışan Tipi
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditType("GUNLUK")}
                  aria-pressed={editType === "GUNLUK"}
                  className={`flex-1 h-11 rounded-xl font-bold text-xs transition-all ${
                    editType === "GUNLUK"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Günlük Yevmiyeli
                </button>
                <button
                  type="button"
                  onClick={() => setEditType("ORTAK")}
                  aria-pressed={editType === "ORTAK"}
                  className={`flex-1 h-11 rounded-xl font-bold text-xs transition-all ${
                    editType === "ORTAK"
                      ? "bg-amber-500 text-white shadow-md shadow-amber-500/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Ortak
                </button>
              </div>
            </div>

            {/* Ücret/tip değişikliği tarih etkilidir — geçmiş aylar korunur. */}
            {wageOrTypeChanged && (
              <div className="space-y-1.5 animate-slide-up">
                <Label className="text-[11px] font-bold text-primary ml-1">
                  Bu tarihten itibaren geçerli
                </Label>
                <Input
                  type="date"
                  className="h-12 rounded-xl border bg-muted/30 font-bold"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEffectiveFrom(format(startOfMonth(new Date()), "yyyy-MM-dd"))}
                    className="flex-1 h-9 rounded-lg bg-muted/60 border text-[11px] font-bold hover:bg-muted"
                  >
                    Bu ayın başı
                  </button>
                  <button
                    type="button"
                    onClick={() => setEffectiveFrom(RATE_HISTORY_EPOCH)}
                    className="flex-1 h-9 rounded-lg bg-muted/60 border text-[11px] font-bold hover:bg-muted"
                  >
                    Tüm geçmiş
                  </button>
                </div>
                <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
                  Bu tarihten önceki günler eski yevmiyeyle hesaplanmaya devam eder. Geçmiş
                  hakedişleri de değiştirmek istiyorsanız «Tüm geçmiş» seçin.
                </p>
              </div>
            )}

            {worker.is_active === false && (
              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                  onClick={async () => {
                    try {
                      await updateWorkerStatus(worker.id, true);
                      setIsEditOpen(false);
                      addToast(`${worker.name} tekrar aktif`, "success");
                      onBack();
                    } catch (err: unknown) {
                      addToast(err instanceof Error ? err.message : String(err), "error");
                    }
                  }}
                >
                  Sahaya Geri Çıkar
                </Button>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              className="w-full h-12 rounded-xl font-black shadow-md"
              disabled={!editName.trim()}
              onClick={async () => {
                if (!editName.trim()) return;
                try {
                  await updateWorker(
                    worker.id,
                    editName.trim(),
                    parseFloat(editWage) || 0,
                    editType,
                    effectiveFrom,
                  );
                  setIsEditOpen(false);
                  addToast("Çalışan bilgileri güncellendi", "success");
                } catch (err: unknown) {
                  addToast(
                    `Güncellenemedi: ${err instanceof Error ? err.message : String(err)}`,
                    "error",
                  );
                }
              }}
            >
              Değişiklikleri Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-y-auto no-scrollbar touch-pan-y">
        <div className="p-4 space-y-4 pb-safe-content">
          {/* Ay seçici */}
          <div className="flex items-center justify-between rounded-control bg-muted/40 p-1">
            <button
              onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
              aria-label="Önceki ay"
              className="w-10 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background active:scale-90 transition-all"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-center">
              <span className="text-[11px] text-muted-foreground block">Dönem</span>
              <h3 className="text-[15px] font-semibold capitalize">{monthLabel}</h3>
            </div>
            <button
              onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
              aria-label="Sonraki ay"
              className="w-10 h-9 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background active:scale-90 transition-all"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Dönem özeti — ekranın tek baskın rakamı, gerisi ona bağlı */}
          <div className="rounded-card surface-raised p-4">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12px] text-muted-foreground capitalize">{monthLabel}</span>
              <span className="text-[11px] text-muted-foreground">
                {stats.periodBalance >= 0 ? "ödenecek" : "fazla ödeme"}
              </span>
            </div>
            <div
              className={`text-[34px] font-semibold tabular-nums tracking-tight leading-tight mt-0.5 ${
                stats.periodBalance >= 0 ? "text-foreground" : "text-bad"
              }`}
            >
              ₺{Math.abs(stats.periodBalance).toLocaleString("tr-TR")}
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <div className="text-[11px] text-muted-foreground mb-0.5">Hakediş</div>
                <div className="text-[15px] font-semibold tabular-nums">
                  ₺{stats.totalEarnedInMonth.toLocaleString("tr-TR")}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-muted-foreground mb-0.5">Ödenen</div>
                <div className="text-[15px] font-semibold tabular-nums">
                  ₺{stats.paidInMonth.toLocaleString("tr-TR")}
                </div>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-border/60 flex items-center justify-between text-[12px]">
              <span className="text-muted-foreground">
                Tüm dönemler · {stats.balance >= 0 ? "kalan borç" : "fazla ödeme"}
              </span>
              <span
                className={`font-semibold tabular-nums ${
                  stats.balance >= 0 ? "text-ok" : "text-bad"
                }`}
              >
                ₺{Math.abs(stats.balance).toLocaleString("tr-TR")}
              </span>
            </div>
          </div>

          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="w-full h-11 rounded-control bg-muted/60 text-[13px] font-medium text-foreground flex items-center justify-center gap-2 active:scale-[0.98] transition-all disabled:opacity-60"
          >
            <DownloadCloud className="w-4 h-4" />
            {isExporting ? "Hazırlanıyor..." : "Aylık raporu indir (PDF)"}
          </button>

          {/* Kazanç grafiği — taban çizgisi ve ölçek olmadan çubuklar okunmuyordu */}
          <div className="rounded-card surface-raised p-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-[13px] font-medium">Günlük kazanç</h3>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                en yüksek ₺{maxDailyEarning.toLocaleString("tr-TR")}
              </span>
            </div>

            {maxDailyEarning > 0 ? (
              <svg
                className="w-full text-primary"
                viewBox={`0 0 ${stats.dailyBreakdown.length * 10} 46`}
                preserveAspectRatio="none"
                role="img"
                aria-label={`${monthLabel} günlük kazanç grafiği, en yüksek ${maxDailyEarning} lira`}
                style={{ height: 88 }}
              >
                {stats.dailyBreakdown.map((entry, i) => {
                  const h = (Math.max(entry.earned, 0) / maxDailyEarning) * 36;
                  return (
                    <rect
                      key={entry.date}
                      x={i * 10 + 1.5}
                      y={38 - h}
                      width={7}
                      height={Math.max(h, 1)}
                      rx={1.5}
                      fill="currentColor"
                      fillOpacity={entry.earned > 0 ? 1 : 0.15}
                    />
                  );
                })}
                <line
                  x1={0}
                  y1={38.5}
                  x2={stats.dailyBreakdown.length * 10}
                  y2={38.5}
                  stroke="currentColor"
                  strokeOpacity={0.25}
                  strokeWidth={0.7}
                />
              </svg>
            ) : (
              <div className="h-22 flex items-center justify-center text-[12px] text-muted-foreground">
                Bu ay kazanç kaydı yok
              </div>
            )}

            {/* Gün etiketleri: her 5 günde bir, kalabalık yapmadan */}
            <div className="flex mt-1">
              {stats.dailyBreakdown.map((entry, i) => (
                <span
                  key={entry.date}
                  className="flex-1 text-center text-[9px] text-muted-foreground tabular-nums"
                >
                  {(i + 1) % 5 === 0 ? entry.dayNum : ""}
                </span>
              ))}
            </div>
          </div>

          {/* Katılım — donut yerine tek şeritte oran, altında sayılar */}
          <div className="rounded-card surface-raised p-4">
            <div className="flex items-baseline justify-between mb-3">
              <h3 className="text-[13px] font-medium">Katılım</h3>
              <span className="text-[11px] text-muted-foreground tabular-nums">
                {attendanceTotal > 0 ? `%${attendanceRate} · ${attendanceTotal} gün` : "kayıt yok"}
              </span>
            </div>

            <div className="flex h-2 rounded-full overflow-hidden bg-muted">
              {attendanceTotal > 0 &&
                (
                  [
                    { value: stats.fullDays, cls: "bg-ok" },
                    { value: stats.halfDays, cls: "bg-warn" },
                    { value: stats.absentDays, cls: "bg-bad" },
                    { value: stats.holidayDays, cls: "bg-info" },
                  ] as const
                ).map((seg, i) =>
                  seg.value > 0 ? (
                    <span
                      key={i}
                      className={seg.cls}
                      style={{ width: `${(seg.value / attendanceTotal) * 100}%` }}
                    />
                  ) : null,
                )}
            </div>

            <div className="mt-3 grid grid-cols-4 gap-2">
              {(
                [
                  { label: "Tam", value: stats.fullDays, dot: "bg-ok", text: "text-ok" },
                  { label: "Yarım", value: stats.halfDays, dot: "bg-warn", text: "text-warn" },
                  { label: "Yok", value: stats.absentDays, dot: "bg-bad", text: "text-bad" },
                  { label: "İzin", value: stats.holidayDays, dot: "bg-info", text: "text-info" },
                ] as const
              ).map((item) => (
                <div key={item.label}>
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className={`w-1.5 h-1.5 rounded-full ${item.dot}`} />
                    <span className="text-[11px] text-muted-foreground">{item.label}</span>
                  </div>
                  <div className={`text-[15px] font-semibold tabular-nums ${item.text}`}>
                    {item.value}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Günlük döküm */}
          <div>
            <h3 className="text-[13px] font-medium mb-2 ml-0.5">Günlük Döküm</h3>
            <div className="rounded-card surface-raised overflow-hidden">
              <div className="flex px-3.5 py-2 text-[11px] text-muted-foreground border-b border-border/60">
                <div className="w-12">Gün</div>
                <div className="flex-1 text-center">Durum</div>
                <div className="w-20 text-right">Hakediş</div>
              </div>
              <div className="divide-y max-h-62.5 overflow-y-auto no-scrollbar">
                {stats.dailyBreakdown.map((day) => (
                  <div
                    key={day.date}
                    className={`flex items-center px-3 py-2 transition-colors ${
                      day.status === "FULL"
                        ? "bg-emerald-50/40 dark:bg-emerald-500/5"
                        : day.status === "HALF"
                          ? "bg-amber-50/40 dark:bg-amber-500/5"
                          : day.status === "ABSENT"
                            ? "bg-rose-50/30 dark:bg-rose-500/5"
                            : day.status === "HOLIDAY"
                              ? "bg-sky-50/40 dark:bg-sky-500/5"
                              : ""
                    }`}
                  >
                    <div className="w-12">
                      <span className="text-xs font-black">{day.dayNum}</span>
                      <span className="text-[10px]  opacity-60 ml-0.5 font-bold">
                        {day.dayName}
                      </span>
                    </div>
                    <div className="flex-1 flex justify-center">
                      {day.status === "FULL" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-ok-soft text-ok text-[10px] font-bold">
                          <CheckCircle2 className="w-3 h-3" /> Tam
                        </span>
                      ) : day.status === "HALF" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-warn-soft text-warn text-[10px] font-bold">
                          <MinusCircle className="w-3 h-3" /> Yarım
                        </span>
                      ) : day.status === "ABSENT" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-bad-soft text-bad text-[10px] font-bold">
                          <XCircle className="w-3 h-3" /> Yok
                        </span>
                      ) : day.status === "HOLIDAY" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-info-soft text-info text-[10px] font-bold">
                          <Palmtree className="w-3 h-3" /> İzin
                        </span>
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/25" />
                      )}
                    </div>
                    <div
                      className={`w-20 text-right font-bold text-xs font-mono ${
                        day.earned > 0
                          ? "text-ok"
                          : day.earned < 0
                            ? "text-bad"
                            : "text-muted-foreground/50"
                      }`}
                    >
                      {day.earned !== 0 ? `₺${day.earned.toLocaleString("tr-TR")}` : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Ödeme ekle */}
          <Dialog
            open={isPayOpen}
            onOpenChange={(open) => {
              setIsPayOpen(open);
              if (open) setPayDate(todayStr());
            }}
          >
            <DialogTrigger asChild>
              <button className="w-full h-12 rounded-control bg-primary text-primary-foreground text-[14px] font-semibold flex items-center justify-center gap-2 shadow-sm active:scale-[0.97] transition-all">
                <Plus className="w-4 h-4" /> Ödeme Yap
              </button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl border-none shadow-2xl mx-4">
              <DialogHeader>
                <DialogTitle className="text-lg font-black">Ödeme Yap</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-muted-foreground ml-1">
                    Tutar (₺)
                  </Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    placeholder="Örn: 2000"
                    className="h-12 rounded-xl border bg-muted/30 font-bold text-base"
                    value={payAmount}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPayAmount(e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-muted-foreground ml-1">
                    Ödeme Tarihi
                  </Label>
                  <Input
                    type="date"
                    className="h-12 rounded-xl border bg-muted/30 font-bold"
                    value={payDate}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPayDate(e.target.value)
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold text-muted-foreground ml-1">
                    Açıklama (Opsiyonel)
                  </Label>
                  <Input
                    placeholder="Örn: Maaş ödemesi"
                    className="h-12 rounded-xl border bg-muted/30 font-bold"
                    value={payDesc}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPayDesc(e.target.value)
                    }
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  className="w-full h-12 rounded-xl font-black shadow-md"
                  disabled={!payAmount || !(parseFloat(payAmount) > 0) || !payDate}
                  onClick={async () => {
                    const amount = parseFloat(payAmount);
                    if (!(amount > 0) || !payDate) return;
                    try {
                      await addPayment(worker.id, amount, payDate, payDesc);
                      setIsPayOpen(false);
                      setPayAmount("");
                      setPayDesc("");
                      addToast("Ödeme kaydedildi", "success");
                    } catch (err: unknown) {
                      addToast(
                        `Ödeme kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`,
                        "error",
                      );
                    }
                  }}
                >
                  Kaydet
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Ödemeler */}
          <div>
            <h3 className="text-[13px] font-medium mb-2 ml-0.5">{monthLabel} ödemeleri</h3>
            <div className="space-y-2">
              {monthPayments.map((p: Payment) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center p-3 rounded-card surface-raised gap-2"
                >
                  <div className="flex gap-2.5 items-center min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs truncate">
                        {format(parseISO(p.date), "dd MMM yyyy", { locale: tr })}
                      </p>
                      <p className="text-[11px] text-muted-foreground truncate">
                        {p.description || "Nakit Ödeme"}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <span className="text-primary font-black text-sm font-mono">
                      ₺{p.amount.toLocaleString("tr-TR")}
                    </span>
                    <button
                      onClick={() => setPaymentToDelete(p)}
                      aria-label="Ödemeyi sil"
                      className="w-8 h-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 active:scale-90 transition-all"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
              {monthPayments.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center animate-screen-enter">
                  <Wallet className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-xs text-center text-muted-foreground font-medium">
                    {monthLabel} döneminde ödeme yok
                  </p>
                  <p className="text-[11px] text-muted-foreground/70 mt-1">
                    Yukarıdaki butondan avans/ödeme ekleyebilirsiniz
                  </p>
                </div>
              )}
              {payments.length > monthPayments.length && (
                <p className="text-[11px] text-muted-foreground/70 text-center pt-1">
                  Diğer dönemlerde {payments.length - monthPayments.length} ödeme daha var.
                </p>
              )}
            </div>
          </div>

          {/* Ödeme silme onayı */}
          <Dialog open={!!paymentToDelete} onOpenChange={(o) => !o && setPaymentToDelete(null)}>
            <DialogContent className="w-[90%] max-w-sm rounded-3xl p-6 border-none shadow-2xl">
              <DialogHeader className="mb-2">
                <DialogTitle className="text-lg font-black text-rose-600">Ödemeyi Sil</DialogTitle>
              </DialogHeader>
              {paymentToDelete && (
                <p className="text-sm text-muted-foreground font-medium py-2">
                  <span className="font-black text-foreground">
                    ₺{paymentToDelete.amount.toLocaleString("tr-TR")}
                  </span>{" "}
                  tutarındaki{" "}
                  {format(parseISO(paymentToDelete.date), "dd MMMM yyyy", { locale: tr })} tarihli
                  ödeme silinecek. Bu işlem Sistem Geçmişi'nden geri alınabilir.
                </p>
              )}
              <div className="flex gap-3 mt-4">
                <button
                  className="flex-1 h-12 rounded-xl border font-bold text-xs hover:bg-muted"
                  onClick={() => setPaymentToDelete(null)}
                >
                  Vazgeç
                </button>
                <button
                  className="flex-1 h-12 rounded-xl bg-rose-500 text-white font-bold text-xs shadow-md shadow-rose-500/20"
                  onClick={async () => {
                    if (!paymentToDelete) return;
                    try {
                      await deletePayment(paymentToDelete.id, worker.id);
                      addToast("Ödeme silindi", "success");
                    } catch (err: unknown) {
                      addToast(
                        `Silinemedi: ${err instanceof Error ? err.message : String(err)}`,
                        "error",
                      );
                    } finally {
                      setPaymentToDelete(null);
                    }
                  }}
                >
                  Evet, Sil
                </button>
              </div>
            </DialogContent>
          </Dialog>

          {/* Arşivle */}
          {worker.is_active !== false && (
            <div className="px-5 mt-6 mb-8 flex justify-center">
              <Dialog open={isDeleteOpen} onOpenChange={setIsDeleteOpen}>
                <DialogTrigger asChild>
                  <button className="flex items-center gap-2 px-4 py-3 text-rose-500 font-bold text-xs   hover:bg-rose-50 active:scale-95 transition-all rounded-xl">
                    <Archive className="w-4 h-4" /> Çalışanı Arşivle
                  </button>
                </DialogTrigger>
                <DialogContent className="w-[90%] max-w-sm rounded-3xl p-6 border-none shadow-2xl">
                  <DialogHeader className="mb-4">
                    <DialogTitle className="text-xl font-black text-rose-600">
                      Çalışanı Arşivle
                    </DialogTitle>
                  </DialogHeader>
                  <div className="py-2 text-sm text-muted-foreground font-medium">
                    <span className="font-bold text-foreground">{worker.name}</span> artık sahada
                    çalışmıyor mu? Arşive alınca listelerden gizlenir ama eski çalışma durumu ve
                    ödeme kayıtları <strong className="text-foreground">silinmez</strong>.
                  </div>
                  <DialogFooter className="mt-6 flex gap-3 sm:gap-3">
                    <Button
                      variant="outline"
                      className="flex-1 h-12 rounded-xl border-border/60 hover:bg-muted font-bold text-xs"
                      onClick={() => setIsDeleteOpen(false)}
                    >
                      Vazgeç
                    </Button>
                    <Button
                      className="flex-1 h-12 rounded-xl bg-rose-500 hover:bg-rose-600 text-white font-bold text-xs shadow-md shadow-rose-500/20"
                      onClick={async () => {
                        try {
                          await archiveWorker(worker.id);
                          setIsDeleteOpen(false);
                          addToast(`${worker.name} arşivlendi`, "success");
                          onBack();
                        } catch (err: unknown) {
                          addToast(err instanceof Error ? err.message : String(err), "error");
                        }
                      }}
                    >
                      Evet, Arşivle
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
