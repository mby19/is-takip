import { useState, useEffect, useMemo } from "react";
import { usePaymentStore } from "../stores/paymentStore";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
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
  Plus,
  Edit2,
  Archive,
  DownloadCloud,
} from "lucide-react";
import jsPDF from "jspdf";
import "jspdf-autotable";
import { registerTurkishFont } from "../lib/pdfFont";

type JsPDFWithTable = jsPDF & {
  autoTable: (options: Record<string, unknown>) => void;
  lastAutoTable?: { finalY: number };
};
import { format, parseISO, startOfMonth, endOfMonth } from "date-fns";
import { tr } from "date-fns/locale";
import type { Worker, Payment } from "../types";
import { calculateWorkerStats } from "../utils/calculations";
import { DetailSkeleton } from "./ui/skeleton";
import { isTauri, saveFileToDownloads } from "../lib/tauri";
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

export function WorkerDetailView({ worker, onBack }: WorkerDetailViewProps) {
  const payments = usePaymentStore((s) => s.payments);
  const fetchWorkerPayments = usePaymentStore((s) => s.fetchWorkerPayments);
  const addPayment = usePaymentStore((s) => s.addPayment);
  const payLoading = usePaymentStore((s) => s.isLoading);
  const workers = useWorkerStore((s) => s.workers);
  const fetchWorkers = useWorkerStore((s) => s.fetchWorkers);
  const archiveWorker = useWorkerStore((s) => s.archiveWorker);
  const updateWorker = useWorkerStore((s) => s.updateWorker);
  const updateWorkerStatus = useWorkerStore((s) => s.updateWorkerStatus);
  const workersLoading = useWorkerStore((s) => s.isLoading);
  const attendances = useAttendanceStore((s) => s.attendances);
  const fetchAttendanceByDateRange = useAttendanceStore((s) => s.fetchAttendanceByDateRange);
  const attLoading = useAttendanceStore((s) => s.isLoading);
  const metrics = useMetricsStore((s) => s.metrics);
  const fetchMetricsByDateRange = useMetricsStore((s) => s.fetchMetricsByDateRange);
  const metricsLoading = useMetricsStore((s) => s.isLoading);

  const isLoading = payLoading || workersLoading || attLoading || metricsLoading;

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [payAmount, setPayAmount] = useState("");
  const [payDesc, setPayDesc] = useState("");
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);

  // Edit States
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState(worker.name);
  const [editWage, setEditWage] = useState(worker.daily_wage.toString());
  const [editType, setEditType] = useState(worker.worker_type);

  useEffect(() => {
    setEditName(worker.name);
    setEditWage(worker.daily_wage.toString());
    setEditType(worker.worker_type);
  }, [worker]);

  useEffect(() => {
    const startStr = format(startOfMonth(currentMonth), "yyyy-MM-dd");
    const endStr = format(endOfMonth(currentMonth), "yyyy-MM-dd");

    fetchWorkerPayments(worker.id);
    fetchWorkers();
    fetchAttendanceByDateRange(startStr, endStr);
    fetchMetricsByDateRange(startStr, endStr);
  }, [worker.id, currentMonth]);

  const stats = useMemo(() => {
    return calculateWorkerStats(worker, currentMonth, metrics, attendances, workers, payments);
  }, [currentMonth, metrics, attendances, workers, worker, payments]);

  const handleExportPDF = async () => {
    try {
      const doc = new jsPDF();
      await registerTurkishFont(doc);
      doc.setFont("Inter");

      const monthStr = format(currentMonth, "MMMM yyyy", { locale: tr });

      // Header
      doc.setFontSize(20);
      doc.setFont("Inter", "black");
      doc.text("Aylık Çalışma Durumu ve Hakediş Dökümü", 14, 22);

      doc.setFontSize(11);
      doc.setFont("Inter", "normal");
      doc.text(`Çalışan: ${worker.name}`, 14, 32);
      doc.text(`Dönem: ${monthStr}`, 14, 38);
      doc.text(`Aylık Toplam Kazanç: ${stats.totalEarnedInMonth} TL`, 14, 44);
      doc.text(`Ödenen: ${stats.totalPaid} TL | Kalan Bakiye: ${stats.balance} TL`, 14, 50);

      // Table Data
      const tableBody = stats.dailyBreakdown.map((day) => [
        day.dayNum + " " + day.dayName,
        day.status === "FULL"
          ? "Tam"
          : day.status === "HALF"
            ? "Yarım"
            : day.status === "ABSENT"
              ? "Yok"
              : "-",
        day.earned > 0 ? `${day.earned} TL` : "-",
      ]);

      if (tableBody.length > 0) {
        (doc as JsPDFWithTable).autoTable({
          startY: 55,
          head: [["Tarih", "Durum", "Kazanç"]],
          body: tableBody,
          theme: "grid",
          headStyles: { fillColor: [59, 130, 246] },
          styles: { font: "Inter" },
        });
      }

      const finalY = (doc as JsPDFWithTable).lastAutoTable?.finalY || 55;

      const monthPrefix = format(currentMonth, "yyyy-MM");
      const monthlyPayments = payments.filter(
        (p: Payment) => p.date.startsWith(monthPrefix) && p.worker_id === worker.id,
      );

      if (monthlyPayments.length > 0) {
        doc.setFont("Inter", "bold");
        doc.text("Bu Ay Yapılan Ödemeler / Avanslar", 14, finalY + 15);
        const paymentsBody = monthlyPayments.map((p: Payment) => [
          format(parseISO(p.date), "dd MMM yyyy", { locale: tr }),
          p.description || "Nakit Ödeme",
          `${p.amount} TL`,
        ]);

        (doc as JsPDFWithTable).autoTable({
          startY: finalY + 20,
          head: [["Tarih", "Açıklama", "Tutar"]],
          body: paymentsBody,
          theme: "striped",
          headStyles: { fillColor: [16, 185, 129] },
          styles: { font: "Inter" },
        });
      }

      const fileName = `${worker.name.replace(/\s+/g, "_")}_${monthStr.replace(/\s+/g, "_")}_Raporu.pdf`;

      if (isTauri()) {
        const pdfArrayBuffer = doc.output("arraybuffer");
        await saveFileToDownloads(fileName, new Uint8Array(pdfArrayBuffer));
      } else {
        doc.save(fileName);
      }
    } catch (e: unknown) {
      console.error("[PDF] Export error:", e);
    }
  };

  const handlePrevMonth = () =>
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() - 1, 1));
  const handleNextMonth = () =>
    setCurrentMonth((prev) => new Date(prev.getFullYear(), prev.getMonth() + 1, 1));

  if (isLoading && !payments.length && !attendances.length) {
    return (
      <div className="flex flex-col h-full bg-background">
        <DetailSkeleton />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-background stagger-children">
      {/* Header */}
      <header className="px-4 pt-14 pb-4 border-b bg-card flex items-center gap-3 shrink-0">
        <button
          onClick={onBack}
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
            className={`text-[9px] font-bold uppercase tracking-wider ${
              worker.worker_type === "ORTAK" ? "text-amber-600 dark:text-amber-500" : "text-primary"
            }`}
          >
            {worker.worker_type === "ORTAK" ? "Stratejik Ortak" : "Günlük Personel"}
          </p>
        </div>
        <button
          onClick={() => setIsEditOpen(true)}
          className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
        >
          <Edit2 className="w-4 h-4 text-muted-foreground" />
        </button>
      </header>

      {/* Edit Modal */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="rounded-2xl border-none shadow-2xl mx-4 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-black">Çalışan Bilgilerini Düzenle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
              <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
                Çalışan Tipi
              </Label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditType("GUNLUK")}
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
            {worker.is_active === false && (
              <div className="pt-2">
                <Button
                  variant="outline"
                  className="w-full h-12 rounded-xl font-bold border-emerald-200 text-emerald-600 hover:bg-emerald-50"
                  onClick={async () => {
                    await updateWorkerStatus(worker.id, true);
                    setIsEditOpen(false);
                    onBack();
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
              onClick={async () => {
                if (!editName || !editWage) return;
                await updateWorker(worker.id, editName, parseFloat(editWage), editType);
                setIsEditOpen(false);
              }}
            >
              Değişiklikleri Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto no-scrollbar touch-pan-y">
        <div className="p-4 space-y-4 pb-24">
          {/* Ay Seçici */}
          <div className="flex items-center justify-between bg-card p-2 rounded-xl border">
            <button
              onClick={handlePrevMonth}
              className="w-10 h-10 rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-muted"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-center">
              <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground block">
                Dönem
              </span>
              <h3 className="text-sm font-black capitalize">
                {format(currentMonth, "MMMM yyyy", { locale: tr })}
              </h3>
            </div>
            <button
              onClick={handleNextMonth}
              className="w-10 h-10 rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-muted"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </div>

          {/* Finansal Özet — 3 kart yan yana */}
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-linear-to-br from-primary/5 to-primary/10 border border-primary/10 dark:border-primary/20 p-3 rounded-xl text-center">
              <TrendingUp className="w-4 h-4 text-primary mx-auto mb-1" />
              <p className="text-[8px] font-bold text-primary/60 dark:text-primary/80 uppercase tracking-wider">
                Top. Kazanç
              </p>
              <p className="text-base font-black font-mono tracking-tight text-primary mt-0.5">
                ₺{stats.totalEarnedInMonth.toLocaleString("tr-TR")}
              </p>
            </div>
            <div className="bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20 p-3 rounded-xl text-center">
              <Wallet className="w-4 h-4 text-emerald-500 mx-auto mb-1" />
              <p className="text-[8px] font-bold text-emerald-600/60 dark:text-emerald-400/80 uppercase tracking-wider">
                Ödenmeyen
              </p>
              <p
                className={`text-base font-black font-mono tracking-tight mt-0.5 ${stats.balance >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}`}
              >
                ₺{stats.balance.toLocaleString("tr-TR")}
              </p>
            </div>
            <div className="bg-blue-50 dark:bg-blue-500/10 border border-blue-100 dark:border-blue-500/20 p-3 rounded-xl text-center">
              <History className="w-4 h-4 text-blue-500 mx-auto mb-1" />
              <p className="text-[8px] font-bold text-blue-600/60 dark:text-blue-400/80 uppercase tracking-wider">
                Ödenen
              </p>
              <p className="text-base font-black font-mono tracking-tight text-blue-700 dark:text-blue-400 mt-0.5">
                ₺{stats.totalPaid.toLocaleString("tr-TR")}
              </p>
            </div>
          </div>

          {/* İndir Butonu */}
          <button
            onClick={handleExportPDF}
            className="w-full h-12 bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 rounded-xl flex items-center justify-center gap-2 font-black transition-all active:scale-95"
          >
            <DownloadCloud className="w-5 h-5" /> Aylık Raporu İndir (PDF)
          </button>

          {/* Kazanç Grafiği */}
          <div className="bg-card border rounded-xl p-3 h-45 flex flex-col">
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1">
              Günlük Kazanç Trendi
            </h3>
            <div className="flex-1 w-full min-h-0">
              {stats.dailyBreakdown?.length > 0 ? (
                <svg
                  className="w-full h-full"
                  preserveAspectRatio="xMidYMid meet"
                  viewBox={`0 0 ${Math.max((stats.dailyBreakdown?.length ?? 0) * 24, 60)} 130`}
                >
                  {stats.dailyBreakdown.map((entry, i) => {
                    const maxE = Math.max(...stats.dailyBreakdown.map((d) => d.earned), 1);
                    const barH = (entry.earned / maxE) * 100;
                    const x = i * 24 + 2;
                    return (
                      <g key={i}>
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
                          fillOpacity={0.4}
                          fontWeight="bold"
                        >
                          {entry.dayNum}
                        </text>
                      </g>
                    );
                  })}
                </svg>
              ) : (
                <div className="h-full flex items-center justify-center">
                  <span className="text-[10px] text-muted-foreground/40 font-bold">
                    Henüz veri yok
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Katılım Oranı & Çalışma Durumu Özeti */}
          <div className="bg-card border rounded-xl p-3 flex gap-4 items-center shadow-sm">
            <div className="w-21 h-21 relative shrink-0">
              <svg viewBox="0 0 84 84" className="w-full h-full">
                {(() => {
                  const full = stats.fullDays;
                  const half = stats.halfDays;
                  const absent = stats.absentDays;
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
                  const segments = [
                    { value: full, color: "#10b981" },
                    { value: half, color: "#f59e0b" },
                    { value: absent, color: "#f43f5e" },
                  ];
                  let offset = 0;
                  return segments.map((seg, i) => {
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
                        strokeDasharray={`${Math.max(length, 1)} ${c - length}`}
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
                <span className="text-[7px] font-bold uppercase text-muted-foreground tracking-widest mt-0.5">
                  Katılım
                </span>
              </div>
            </div>

            <div className="flex-1 flex flex-col gap-1.5 justify-center">
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-100 dark:border-emerald-500/20">
                <div className="flex items-center gap-1.5">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                  <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-400 uppercase tracking-wider">
                    Tam
                  </span>
                </div>
                <span className="text-xs font-black text-emerald-700 dark:text-emerald-400">
                  {stats.fullDays}
                </span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-500/10 border border-amber-100 dark:border-amber-500/20">
                <div className="flex items-center gap-1.5">
                  <MinusCircle className="w-3.5 h-3.5 text-amber-500" />
                  <span className="text-[9px] font-bold text-amber-700 dark:text-amber-400 uppercase tracking-wider">
                    Yarım
                  </span>
                </div>
                <span className="text-xs font-black text-amber-700 dark:text-amber-400">
                  {stats.halfDays}
                </span>
              </div>
              <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20">
                <div className="flex items-center gap-1.5">
                  <XCircle className="w-3.5 h-3.5 text-rose-500" />
                  <span className="text-[9px] font-bold text-rose-700 dark:text-rose-400 uppercase tracking-wider">
                    Yok
                  </span>
                </div>
                <span className="text-xs font-black text-rose-700 dark:text-rose-400">
                  {stats.absentDays}
                </span>
              </div>
            </div>
          </div>

          {/* Günlük Kazanç Dökümü */}
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1">
              Günlük Döküm
            </h3>
            <div className="rounded-xl border bg-card overflow-hidden">
              {/* Tablo Başlık */}
              <div className="flex bg-muted/50 px-3 py-2 text-[9px] font-bold uppercase tracking-wider text-muted-foreground border-b">
                <div className="w-12">Gün</div>
                <div className="flex-1 text-center">Durum</div>
                <div className="w-20 text-right">Kazanç</div>
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
                            : ""
                    }`}
                  >
                    <div className="w-12">
                      <span className="text-xs font-black">{day.dayNum}</span>
                      <span className="text-[8px] uppercase opacity-40 ml-0.5 font-bold">
                        {day.dayName}
                      </span>
                    </div>
                    <div className="flex-1 flex justify-center">
                      {day.status === "FULL" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-400 text-[9px] font-bold">
                          <CheckCircle2 className="w-3 h-3" /> Tam
                        </span>
                      ) : day.status === "HALF" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-500/20 text-amber-700 dark:text-amber-400 text-[9px] font-bold">
                          <MinusCircle className="w-3 h-3" /> Yarım
                        </span>
                      ) : day.status === "ABSENT" ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-500/20 text-rose-700 dark:text-rose-400 text-[9px] font-bold">
                          <XCircle className="w-3 h-3" /> Yok
                        </span>
                      ) : (
                        <div className="w-4 h-4 rounded-full border-2 border-dashed border-muted-foreground/15" />
                      )}
                    </div>
                    <div
                      className={`w-20 text-right font-bold text-xs ${
                        day.earned > 0
                          ? "text-emerald-700 dark:text-emerald-400"
                          : day.earned < 0
                            ? "text-rose-600 dark:text-rose-400"
                            : "text-muted-foreground/25 dark:text-muted-foreground/40"
                      }`}
                    >
                      {day.earned !== 0 ? `₺${day.earned.toLocaleString("tr-TR")}` : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Ödeme Ekle */}
          <Dialog open={isPayOpen} onOpenChange={setIsPayOpen}>
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
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
                  <Label className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground ml-1">
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
                  onClick={async () => {
                    if (!payAmount) return;
                    await addPayment(
                      worker.id,
                      parseFloat(payAmount),
                      new Date().toISOString().split("T")[0],
                      payDesc,
                    );
                    setIsPayOpen(false);
                    setPayAmount("");
                    setPayDesc("");
                  }}
                >
                  Kaydet
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Son Ödemeler */}
          <div>
            <h3 className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider mb-2 ml-1">
              Son Ödemeler
            </h3>
            <div className="space-y-2">
              {payments.slice(0, 5).map((p: Payment) => (
                <div
                  key={p.id}
                  className="flex justify-between items-center p-3 rounded-xl bg-card border shadow-sm"
                >
                  <div className="flex gap-2.5 items-center">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center shrink-0">
                      <Wallet className="w-4 h-4 text-blue-500 dark:text-blue-400" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-xs truncate">
                        {format(parseISO(p.date), "dd MMM yyyy", { locale: tr })}
                      </p>
                      <p className="text-[10px] text-muted-foreground truncate">
                        {p.description || "Nakit Ödeme"}
                      </p>
                    </div>
                  </div>
                  <div className="text-blue-600 dark:text-blue-400 font-black text-sm shrink-0 ml-2">
                    ₺{p.amount.toLocaleString("tr-TR")}
                  </div>
                </div>
              ))}
              {payments.length === 0 && (
                <div className="flex flex-col items-center justify-center py-8 text-center animate-scale-in">
                  <Wallet className="w-10 h-10 text-muted-foreground/30 mb-3" />
                  <p className="text-xs text-center text-muted-foreground font-medium">
                    Bu ay henüz ödeme yapılmamış
                  </p>
                  <p className="text-[10px] text-muted-foreground/50 mt-1">
                    Aşağıdaki butondan avans/ödeme ekleyebilirsiniz
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Arşivle Bölümü */}
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
                        await archiveWorker(worker.id);
                        setIsDeleteOpen(false);
                        onBack();
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
