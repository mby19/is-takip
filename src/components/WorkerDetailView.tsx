import { useState, useEffect, useMemo, useCallback } from "react";
import { usePaymentStore } from "../stores/paymentStore";
import { useWorkerStore, RATE_HISTORY_EPOCH } from "../stores/workerStore";
import { useToastStore } from "../stores/toastStore";
import { attendanceRepository } from "../repositories/attendanceRepository";
import { metricsRepository } from "../repositories/metricsRepository";
import {
  ArrowLeft,
  Wallet,
  Calendar as History,
  ChevronLeft,
  ChevronRight,
  TrendingUp,
  CheckCircle2,
  MinusCircle,
  XCircle,
  Palmtree,
  Plus,
  Edit2,
  Archive,
  DownloadCloud,
  Trash2,
  Scale,
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

  if (isLoading && allAttendance.length === 0 && payments.length === 0) {
    return (
      <div className="flex flex-col h-full bg-background">
        <DetailSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background stagger-children">
      <header className="px-4 pt-safe-header pb-4 border-b bg-card flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
          aria-label="Geri"
          className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div
          className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm text-white shadow-md shrink-0 ${
            worker.worker_type === "ORTAK"
              ? "bg-linear-to-br from-amber-400 to-orange-500"
              : "bg-linear-to-br from-blue-400 to-indigo-500"
          }`}
        >
          {worker.name.charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-black tracking-tight truncate">
            {worker.name}{" "}
            {worker.is_active === false && <span className="text-rose-500 text-xs">(Arşivde)</span>}
          </h1>
          <p
            className={`text-[10px] font-bold uppercase tracking-wider ${
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
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
              <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
                <Label className="text-[11px] font-bold uppercase tracking-wider text-primary ml-1">
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
          <div className="flex items-center justify-between bg-card p-2 rounded-xl border">
            <button
              onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
              aria-label="Önceki ay"
              className="w-10 h-10 rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-muted"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-center">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground block">
                Dönem
              </span>
              <h3 className="text-sm font-black capitalize">{monthLabel}</h3>
            </div>
            <button
              onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
              aria-label="Sonraki ay"
              className="w-10 h-10 rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-muted"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Dönem özeti */}
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1">
              {monthLabel} dönemi
            </h3>
            <div className="grid grid-cols-3 gap-2">
              <div className="bg-linear-to-br from-primary/5 to-primary/10 border border-primary/10 dark:border-primary/20 p-3 rounded-xl text-center">
                <TrendingUp className="w-4 h-4 text-primary mx-auto mb-1" />
                <p className="text-[10px] font-bold text-primary/70 dark:text-primary/80 uppercase tracking-wider">
                  Hakediş
                </p>
                <p className="text-base font-black font-mono tracking-tight text-primary mt-0.5">
                  ₺{stats.totalEarnedInMonth.toLocaleString("tr-TR")}
                </p>
              </div>
              <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 p-3 rounded-xl text-center">
                <History className="w-4 h-4 text-blue-500 mx-auto mb-1" />
                <p className="text-[10px] font-bold text-blue-600/70 dark:text-blue-400/80 uppercase tracking-wider">
                  Ödenen
                </p>
                <p className="text-base font-black font-mono tracking-tight text-blue-700 dark:text-blue-400 mt-0.5">
                  ₺{stats.paidInMonth.toLocaleString("tr-TR")}
                </p>
              </div>
              <div className="bg-muted/40 border p-3 rounded-xl text-center">
                <Scale className="w-4 h-4 text-muted-foreground mx-auto mb-1" />
                <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                  Fark
                </p>
                <p
                  className={`text-base font-black font-mono tracking-tight mt-0.5 ${
                    stats.periodBalance >= 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  ₺{stats.periodBalance.toLocaleString("tr-TR")}
                </p>
              </div>
            </div>
          </div>

          {/* Genel bakiye — tüm dönemler */}
          <div className="bg-card border rounded-xl p-3.5 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                Tüm dönemler
              </h3>
              <span className="text-[10px] font-bold text-muted-foreground/70">
                hakediş − ödenen
              </span>
            </div>
            <div className="flex items-end justify-between gap-3">
              <div className="text-[11px] font-semibold text-muted-foreground leading-relaxed">
                <div>
                  Toplam hakediş:{" "}
                  <span className="font-mono font-black text-foreground">
                    ₺{stats.totalEarnedAllTime.toLocaleString("tr-TR")}
                  </span>
                </div>
                <div>
                  Toplam ödenen:{" "}
                  <span className="font-mono font-black text-foreground">
                    ₺{stats.totalPaid.toLocaleString("tr-TR")}
                  </span>
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  {stats.balance >= 0 ? "Kalan borç" : "Fazla ödeme"}
                </div>
                <div
                  className={`text-xl font-black font-mono tracking-tight ${
                    stats.balance >= 0
                      ? "text-emerald-700 dark:text-emerald-400"
                      : "text-rose-600 dark:text-rose-400"
                  }`}
                >
                  ₺{Math.abs(stats.balance).toLocaleString("tr-TR")}
                </div>
              </div>
            </div>
          </div>

          <button
            onClick={handleExportPDF}
            disabled={isExporting}
            className="w-full h-12 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-xl flex items-center justify-center gap-2 font-black transition-all active:scale-95 disabled:opacity-60"
          >
            <DownloadCloud className="w-5 h-5" />
            {isExporting ? "Hazırlanıyor..." : "Aylık Raporu İndir (PDF)"}
          </button>

          {/* Kazanç grafiği */}
          <div className="bg-card border rounded-xl p-3 h-45 flex flex-col">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1">
              Günlük Kazanç Trendi
            </h3>
            <div className="flex-1 w-full min-h-0">
              {stats.dailyBreakdown.length > 0 ? (
                <svg
                  className="w-full h-full"
                  preserveAspectRatio="xMidYMid meet"
                  viewBox={`0 0 ${Math.max(stats.dailyBreakdown.length * 24, 60)} 130`}
                  role="img"
                  aria-label={`${monthLabel} günlük kazanç grafiği`}
                >
                  {(() => {
                    const maxE = Math.max(...stats.dailyBreakdown.map((d) => d.earned), 1);
                    return stats.dailyBreakdown.map((entry, i) => {
                      const barH = (Math.max(entry.earned, 0) / maxE) * 100;
                      const x = i * 24 + 2;
                      return (
                        <g key={entry.date}>
                          <rect
                            x={x}
                            y={118 - barH}
                            width={18}
                            height={Math.max(barH, 1.5)}
                            rx={3}
                            fill={entry.earned > 0 ? "#10b981" : "currentColor"}
                            fillOpacity={entry.earned > 0 ? 1 : 0.1}
                          />
                          <text
                            x={x + 9}
                            y={126}
                            textAnchor="middle"
                            fontSize={8}
                            fill="currentColor"
                            fillOpacity={0.5}
                            fontWeight="bold"
                          >
                            {entry.dayNum}
                          </text>
                        </g>
                      );
                    });
                  })()}
                </svg>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <span className="text-[11px] text-muted-foreground/60 font-bold">
                    Henüz veri yok
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Katılım özeti */}
          <div className="bg-card border rounded-xl p-3 flex gap-4 items-center shadow-sm">
            <div className="w-21 h-21 relative shrink-0">
              <svg viewBox="0 0 84 84" className="w-full h-full" aria-hidden="true">
                {(() => {
                  const { fullDays: full, halfDays: half, absentDays: absent } = stats;
                  const total = full + half + absent;
                  if (total === 0) {
                    return (
                      <circle
                        cx="42"
                        cy="42"
                        r="34"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="8"
                        strokeOpacity={0.1}
                      />
                    );
                  }
                  const r = 34;
                  const c = 2 * Math.PI * r;
                  let offset = 0;
                  return [
                    { value: full, color: "#10b981" },
                    { value: half, color: "#f59e0b" },
                    { value: absent, color: "#f43f5e" },
                  ].map((seg, i) => {
                    const length = (seg.value / total) * c;
                    const el = (
                      <circle
                        key={i}
                        cx="42"
                        cy="42"
                        r={r}
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="10"
                        strokeDasharray={`${Math.max(length, 0)} ${c - length}`}
                        strokeDashoffset={-offset}
                        transform="rotate(-90 42 42)"
                      />
                    );
                    offset += length;
                    return el;
                  });
                })()}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-sm font-black leading-none mt-1">
                  {stats.fullDays + stats.halfDays + stats.absentDays > 0
                    ? Math.round(
                        ((stats.fullDays + stats.halfDays * 0.5) /
                          (stats.fullDays + stats.halfDays + stats.absentDays)) *
                          100,
                      )
                    : 0}
                  %
                </span>
                <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest mt-0.5">
                  Katılım
                </span>
              </div>
            </div>

            <div className="flex-1 grid grid-cols-2 gap-1.5">
              {/*
                Sınıf adları statik yazılır — Tailwind derleme sırasında
                şablon değişkenli sınıf adlarını (`bg-${x}-50`) göremez.
              */}
              {[
                {
                  icon: CheckCircle2,
                  label: "Tam",
                  value: stats.fullDays,
                  box: "bg-emerald-50 dark:bg-emerald-500/10 border-emerald-100 dark:border-emerald-500/20",
                  icon_: "text-emerald-500",
                  text: "text-emerald-700 dark:text-emerald-400",
                },
                {
                  icon: MinusCircle,
                  label: "Yarım",
                  value: stats.halfDays,
                  box: "bg-amber-50 dark:bg-amber-500/10 border-amber-100 dark:border-amber-500/20",
                  icon_: "text-amber-500",
                  text: "text-amber-700 dark:text-amber-400",
                },
                {
                  icon: XCircle,
                  label: "Yok",
                  value: stats.absentDays,
                  box: "bg-rose-50 dark:bg-rose-500/10 border-rose-100 dark:border-rose-500/20",
                  icon_: "text-rose-500",
                  text: "text-rose-700 dark:text-rose-400",
                },
                {
                  icon: Palmtree,
                  label: "İzin",
                  value: stats.holidayDays,
                  box: "bg-sky-50 dark:bg-sky-500/10 border-sky-100 dark:border-sky-500/20",
                  icon_: "text-sky-500",
                  text: "text-sky-700 dark:text-sky-400",
                },
              ].map(({ icon: Icon, label, value, box, icon_, text }) => (
                <div
                  key={label}
                  className={`flex items-center justify-between px-2 py-1.5 rounded-lg border ${box}`}
                >
                  <div className="flex items-center gap-1">
                    <Icon className={`w-3.5 h-3.5 ${icon_}`} />
                    <span className={`text-[10px] font-bold uppercase tracking-wider ${text}`}>
                      {label}
                    </span>
                  </div>
                  <span className={`text-xs font-black ${text}`}>{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Günlük döküm */}
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1">
              Günlük Döküm
            </h3>
            <div className="rounded-xl border bg-card overflow-hidden">
              <div className="flex bg-muted/50 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground border-b">
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
                      <span className="text-[10px] uppercase opacity-60 ml-0.5 font-bold">
                        {day.dayName}
                      </span>
                    </div>
                    <div className="flex-1 flex justify-center">
                      {day.status === "FULL" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[10px] font-bold">
                          <CheckCircle2 className="w-3 h-3" /> Tam
                        </span>
                      ) : day.status === "HALF" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[10px] font-bold">
                          <MinusCircle className="w-3 h-3" /> Yarım
                        </span>
                      ) : day.status === "ABSENT" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-[10px] font-bold">
                          <XCircle className="w-3 h-3" /> Yok
                        </span>
                      ) : day.status === "HOLIDAY" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-sky-100 dark:bg-sky-500/20 text-sky-700 dark:text-sky-400 text-[10px] font-bold">
                          <Palmtree className="w-3 h-3" /> İzin
                        </span>
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/25" />
                      )}
                    </div>
                    <div
                      className={`w-20 text-right font-bold text-xs font-mono ${
                        day.earned > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : day.earned < 0
                            ? "text-rose-600 dark:text-rose-400"
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
              <button className="w-full h-12 rounded-xl bg-foreground text-background font-bold flex items-center justify-center gap-2 shadow-md active:scale-95 transition-all text-sm">
                <Plus className="w-4 h-4" /> Ödeme Yap
              </button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl border-none shadow-2xl mx-4">
              <DialogHeader>
                <DialogTitle className="text-lg font-black">Ödeme Yap</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-3">
                <div className="space-y-1.5">
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
                  <Label className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1">
              {monthLabel} ödemeleri
            </h3>
            <div className="space-y-2">
              {monthPayments.map((p: Payment) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center p-3 rounded-xl bg-card border shadow-sm gap-2"
                >
                  <div className="flex gap-2.5 items-center min-w-0">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4 text-blue-500 dark:text-blue-400" />
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
                    <span className="text-blue-600 dark:text-blue-400 font-black text-sm font-mono">
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
                <div className="flex flex-col items-center justify-center py-8 text-center animate-scale-in">
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
                  <button className="flex items-center gap-2 px-4 py-3 text-rose-500 font-bold text-xs uppercase tracking-widest hover:bg-rose-50 active:scale-95 transition-all rounded-xl">
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
