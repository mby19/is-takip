import { useState, useEffect, useMemo, useCallback } from "react";
import { usePaymentStore } from "../stores/paymentStore";
import { useWorkerStore, RATE_HISTORY_EPOCH } from "../stores/workerStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { useDomainMonthData } from "../hooks/useDomainMonthData";
import {
  ArrowLeft,
  Wallet,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Lock,
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
import type { Worker, Payment } from "../types";
import { resolveWorkerRate } from "../utils/earningsCalculator";
import { periodOf, formatPeriod } from "../lib/period";
import {
  buildWorkerStats,
  canSelectNextMonth,
  paymentsInPeriod,
  paymentsOfWorker,
  rateValidFrom,
  workerRateHistory,
} from "../lib/periodStats";
import {
  describeRateChangeImpact,
  rateChangeImpact,
  type RateChangeImpact,
} from "../lib/rateChangeImpact";
import { overpayExcess } from "../lib/paymentOverpay";
import { exportWorkerReport } from "../lib/workerReport";
import { formatMoney } from "../lib/utils";
import { DetailSkeleton } from "./ui/skeleton";
import { WorkerAvatar } from "./ui/worker-avatar";
import {
  WORKER_COLORS,
  WORKER_COLOR_KEYS,
  WORKER_COLOR_NAMES,
  WORKER_INK,
  SHORT_LABEL_MAX,
  resolveWorkerColorKey,
  normalizeShortLabel,
  type WorkerColorKey,
} from "../lib/workerAppearance";
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

  const fetchWorkers = useWorkerStore((s) => s.fetchWorkers);
  const archiveWorker = useWorkerStore((s) => s.archiveWorker);
  const updateWorker = useWorkerStore((s) => s.updateWorker);
  const updateWorkerStatus = useWorkerStore((s) => s.updateWorkerStatus);
  const updateAppearance = useWorkerStore((s) => s.updateAppearance);

  const addToast = useToastStore((s) => s.addToast);

  /**
   * Aylık dökümün verisi ortak hook'tan gelir (K8): ekran kendi repository
   * sorgusunu kurmaz. Hook'un neden store kullanmadığı ve neden ay penceresini
   * yerel tuttuğu kendi dosyasında gerekçelendirilmiştir.
   *
   * Kapsam yalnız EKRANDAKİ AY: tüm tabloyu çekmek 60 personel × 365 gün
   * ≈ 22k satırı belleğe alıp sonra filtrelemek demekti.
   */
  const [currentMonth, setCurrentMonth] = useState(new Date());
  const {
    rateHistory,
    viewPeriod,
    attendance,
    periodEarnings,
    allTimeEarned: allTimeEarnedByWorker,
    isLoading: dataLoading,
    error: dataError,
  } = useDomainMonthData({ month: currentMonth, withBreakdown: true });

  /** Bu çalışanın tüm dönemlerdeki hakedişi — hook tüm ekip için döndürür. */
  const allTimeEarned = allTimeEarnedByWorker.get(worker.id) ?? 0;

  const [payAmount, setPayAmount] = useState("");
  const [payDesc, setPayDesc] = useState("");
  const [payDate, setPayDate] = useState(todayStr());
  const [isPayOpen, setIsPayOpen] = useState(false);
  const [isSavingPayment, setIsSavingPayment] = useState(false);
  /** Bakiye aşımı onayı (K1): onay verilmeden `addPayment` çağrılmaz. */
  const [overpayExcessAmount, setOverpayExcessAmount] = useState<number | null>(null);
  /** Geçmişe yürüyen ücret değişikliği onayı (K2). */
  const [rateImpact, setRateImpact] = useState<RateChangeImpact | null>(null);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [paymentToDelete, setPaymentToDelete] = useState<Payment | null>(null);
  const [isExporting, setIsExporting] = useState(false);

  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editName, setEditName] = useState(worker.name);
  const [editWage, setEditWage] = useState(worker.daily_wage.toString());
  const [editType, setEditType] = useState(worker.worker_type);
  const [effectiveFrom, setEffectiveFrom] = useState(todayStr());
  const [editColor, setEditColor] = useState<WorkerColorKey>(() => resolveWorkerColorKey(worker));
  const [editLabel, setEditLabel] = useState(worker.short_label ?? "");

  useEffect(() => {
    setEditName(worker.name);
    setEditWage(worker.daily_wage.toString());
    setEditType(worker.worker_type);
    setEditColor(resolveWorkerColorKey(worker));
    setEditLabel(worker.short_label ?? "");
  }, [worker]);

  const wageOrTypeChanged =
    parseFloat(editWage || "0") !== worker.daily_wage || editType !== worker.worker_type;

  useEffect(() => {
    fetchWorkerPayments(worker.id);
    fetchWorkers();
  }, [worker.id, fetchWorkerPayments, fetchWorkers]);

  /** Hook'un okuma hatası ekrana toast olarak düşer; hook kendi hatasını yutar. */
  useEffect(() => {
    if (dataError) addToast(dataError, "error");
  }, [dataError, addToast]);

  /**
   * Ödeme listesi ile bakiye hesabı AYNI kayıt kümesini kullanır: store hangi
   * çalışanı yüklemiş olursa olsun `worker_id` her koşulda doğrulanır.
   */
  const workerPayments = useMemo(
    () => paymentsOfWorker(payments, worker.id),
    [payments, worker.id],
  );
  const monthPayments = useMemo(
    () => paymentsInPeriod(payments, worker.id, viewPeriod.period),
    [payments, worker.id, viewPeriod.period],
  );

  const stats = useMemo(
    () => buildWorkerStats(worker, viewPeriod.period, periodEarnings, allTimeEarned, payments),
    [worker, viewPeriod.period, periodEarnings, allTimeEarned, payments],
  );

  const closedPeriods = usePeriodStore((s) => s.closed);
  const closedLoaded = usePeriodStore((s) => s.closedLoaded);
  const earliestDataPeriod = usePeriodStore((s) => s.earliestDataPeriod);

  /**
   * Kilit listesi okunamadıysa `null` — fail-closed: hiçbir dönem yazmaya uygun
   * sayılmaz. Store'un altı yazma yolu da aynı varsayımı paylaşıyor.
   */
  const lockedPeriods = useMemo(
    () => (closedLoaded ? new Set(closedPeriods.map((c) => c.period)) : null),
    [closedPeriods, closedLoaded],
  );
  const isLocked = useCallback(
    (dateStr: string) => lockedPeriods === null || lockedPeriods.has(periodOf(dateStr)),
    [lockedPeriods],
  );

  const isArchived = worker.is_active === false;
  /** Ekranda görüntülenen dönemin kilidi — ödeme girişi için sınır. */
  const monthLocked = lockedPeriods === null || lockedPeriods.has(viewPeriod.period);
  const payDateLocked = isLocked(payDate);

  /**
   * Kilitli dönemde ücret değişikliği ENGELLENMEZ (K2 kararı B: uyar, engelleme);
   * onay diyaloğu açılır. Yalnızca kilit listesi hiç okunmamışsa düğme kilitli
   * kalır — hangi dönemin kapalı olduğu bilinmiyorsa etki hesaplanamaz ve store
   * zaten `ClosedPeriodError` fırlatacak.
   */
  const lockStateUnknown = lockedPeriods === null;
  const effectiveFromBlocked = wageOrTypeChanged && lockStateUnknown;

  /**
   * Kaydetmeden önce geçmişe yürüme onayı istenecek mi?
   *
   * Yalnız onay DİYALOĞUNU göstermek için hesaplanır; kararın tek sahibi
   * `workerStore.updateWorker`'dır (aynı saf fonksiyonu çağırır). İkisi ayrışırsa
   * kullanıcı diyaloğu hiç açılmadan kalıcı hata görür.
   */
  const pendingRateImpact = useMemo(
    () =>
      wageOrTypeChanged
        ? rateChangeImpact({
            effectiveFrom,
            today: todayStr(),
            earliestDataPeriod,
            closedPeriods: closedPeriods.map((c) => c.period),
          })
        : null,
    [wageOrTypeChanged, effectiveFrom, earliestDataPeriod, closedPeriods],
  );

  /**
   * Çalışan bilgilerini kaydeder. `confirmRetroactive` yalnızca onay
   * diyaloğundan sonra `true` gelir; ilk tıklamada geçmişe yürüyen bir
   * değişiklik varsa bu fonksiyona hiç ulaşılmaz.
   */
  const saveWorker = async (confirmRetroactive: boolean) => {
    if (!editName.trim()) return;
    try {
      await updateWorker(
        worker.id,
        editName.trim(),
        parseFloat(editWage) || 0,
        editType,
        effectiveFrom,
        { confirmRetroactive },
      );
      await updateAppearance(worker.id, editColor, normalizeShortLabel(editLabel) || null);
      setIsEditOpen(false);
      setRateImpact(null);
      addToast("Çalışan bilgileri güncellendi", "success");
    } catch (err: unknown) {
      addToast(`Güncellenemedi: ${err instanceof Error ? err.message : String(err)}`, "error");
    }
  };

  /**
   * Ödemeyi kaydeder. `confirmed` yalnızca aşım onay diyaloğundan sonra `true`
   * gelir; store katmanındaki koruma yine de tek başına yeterlidir.
   */
  const savePayment = async (confirmed: boolean) => {
    const amount = parseFloat(payAmount);
    if (!(amount > 0) || !payDate) return;
    // Çift tıklama → iki INSERT → çift ödeme. Store'daki uçuş korumasına
    // ek olarak buton da kilitlenir.
    if (isSavingPayment) return;
    setIsSavingPayment(true);
    try {
      await addPayment(worker.id, amount, payDate, payDesc, {
        balance: stats.balance,
        // `balance` bu toplamdan türetildi; store farkı okuyup bakiyeyi
        // tazeler, yoksa ikinci ödeme bayat bakiyeye bakar (K1).
        paidTotal: stats.totalPaid,
        confirmed,
      });
      setIsPayOpen(false);
      setOverpayExcessAmount(null);
      setPayAmount("");
      setPayDesc("");
      addToast("Ödeme kaydedildi", "success");
    } catch (err: unknown) {
      addToast(`Ödeme kaydedilemedi: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setIsSavingPayment(false);
    }
  };

  /** Ekranda görüntülenen aydaki yevmiyenin ne zamandan itibaren geçerli olduğu. */
  const monthRate = useMemo(
    () => resolveWorkerRate(worker, viewPeriod.end, rateHistory),
    [worker, viewPeriod.end, rateHistory],
  );
  const monthRateFrom = useMemo(
    () => rateValidFrom(rateHistory, worker.id, viewPeriod.end),
    [rateHistory, worker.id, viewPeriod.end],
  );
  const rateRows = useMemo(
    () => workerRateHistory(rateHistory, worker.id),
    [rateHistory, worker.id],
  );

  const isLoading = dataLoading || payLoading;

  const handleExportPDF = async () => {
    if (isExporting) return;
    setIsExporting(true);
    try {
      const saved = await exportWorkerReport(worker, currentMonth, stats, workerPayments);
      if (saved) addToast(`Rapor kaydedildi: ${saved}`, "success");
    } catch (e: unknown) {
      console.error("[PDF] Export error:", e);
      addToast(`Rapor oluşturulamadı: ${e instanceof Error ? e.message : String(e)}`, "error");
    } finally {
      setIsExporting(false);
    }
  };

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

  if (isLoading && attendance.length === 0 && workerPayments.length === 0) {
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
          className="tap-target rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <WorkerAvatar worker={worker} size="md" />
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
          className="tap-target rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
        >
          <Edit2 className="w-4 h-4 text-muted-foreground" />
        </button>
      </header>

      {/* Dönem kilidi — kaydetmeden ÖNCE görünür olmalı */}
      {lockedPeriods !== null && lockedPeriods.has(viewPeriod.period) && (
        <div className="shrink-0 px-4 py-2 bg-info-soft text-info text-[11px] font-semibold flex items-center gap-1.5">
          <Lock className="w-3.5 h-3.5 shrink-0" />
          <span className="truncate">
            {formatPeriod(viewPeriod.period)} kapatıldı — bu dönemde ödeme ve ücret değişikliği
            yapılamaz.
          </span>
        </div>
      )}

      {/* Arşivli çalışana yeni kayıt girilemez; geçmişi görünür kalır. */}
      {isArchived && (
        <div className="shrink-0 px-4 py-2 bg-muted/60 text-muted-foreground text-[11px] font-semibold">
          Arşivde — yeni ödeme ve ücret değişikliği yapılamaz, geçmiş kayıtlar korunur.
        </div>
      )}

      {/* Düzenleme */}
      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent className="rounded-2xl border-none shadow-2xl mx-4 max-w-md">
          <DialogHeader>
            <DialogTitle className="text-lg font-black">Çalışan Bilgilerini Düzenle</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-1.5">
              <Label
                htmlFor="worker-edit-name"
                className="text-[11px] font-bold text-muted-foreground ml-1"
              >
                İsim Soyisim
              </Label>
              <Input
                id="worker-edit-name"
                placeholder="Çalışan İsmi"
                className="h-12 rounded-xl border bg-muted/30 font-bold"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label
                htmlFor="worker-edit-wage"
                className="text-[11px] font-bold text-muted-foreground ml-1"
              >
                Günlük Yevmiye (₺)
              </Label>
              <Input
                id="worker-edit-wage"
                type="number"
                inputMode="decimal"
                placeholder="Örn: 1500"
                disabled={isArchived}
                className="h-12 rounded-xl border bg-muted/30 font-bold text-base disabled:opacity-50"
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
                  disabled={isArchived}
                  onClick={() => setEditType("GUNLUK")}
                  aria-pressed={editType === "GUNLUK"}
                  className={`flex-1 h-11 rounded-xl font-bold text-xs transition-all disabled:opacity-50 ${
                    editType === "GUNLUK"
                      ? "bg-primary text-primary-foreground shadow-md"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Günlük Yevmiyeli
                </button>
                <button
                  type="button"
                  disabled={isArchived}
                  onClick={() => setEditType("ORTAK")}
                  aria-pressed={editType === "ORTAK"}
                  className={`flex-1 h-11 rounded-xl font-bold text-xs transition-all disabled:opacity-50 ${
                    editType === "ORTAK"
                      ? "bg-warn text-on-warn shadow-md shadow-amber-500/20"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Ortak
                </button>
              </div>
            </div>

            {/* Tablodaki görünüm — hesaplamayı etkilemez, sadece tanımayı hızlandırır */}
            <div className="space-y-2">
              <Label className="text-[11px] font-medium text-muted-foreground ml-1">
                Tablodaki görünüm
              </Label>

              <div className="flex items-center gap-3">
                <span
                  style={{ backgroundColor: WORKER_COLORS[editColor], color: WORKER_INK }}
                  className="w-10 h-10 rounded-full grid place-items-center text-[15px] font-semibold shrink-0"
                >
                  {normalizeShortLabel(editLabel) ||
                    editName.trim().charAt(0).toLocaleUpperCase("tr-TR") ||
                    "?"}
                </span>
                <Input
                  value={editLabel}
                  maxLength={SHORT_LABEL_MAX}
                  onChange={(e) => setEditLabel(normalizeShortLabel(e.target.value))}
                  placeholder="Otomatik"
                  aria-label="Kısa etiket"
                  className="tap-target rounded-control border bg-muted/30 font-semibold text-center tracking-wider"
                />
              </div>
              <p className="text-[11px] text-muted-foreground ml-1 leading-relaxed">
                Boş bırakırsanız baş harflerden üretilir ve ekipte benzersiz olması sağlanır.
              </p>

              {/* 9 renk 360px'e sığmıyor: yatay kaydırma sarmalayıcısı.
                  Sütun genişliğinin tek doğruluk kaynağı `.tap-target`. */}
              <div className="h-scroll-touch overflow-x-auto no-scrollbar -mx-1 px-1 pt-1">
                <div className="grid grid-cols-9 gap-1.5 w-max">
                  {WORKER_COLOR_KEYS.map((key) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setEditColor(key)}
                      aria-label={WORKER_COLOR_NAMES[key]}
                      aria-pressed={editColor === key}
                      title={WORKER_COLOR_NAMES[key]}
                      style={{ backgroundColor: WORKER_COLORS[key] }}
                      className={`tap-target rounded-full transition-transform active:scale-90 ${
                        editColor === key
                          ? "ring-2 ring-offset-2 ring-foreground ring-offset-background scale-110"
                          : ""
                      }`}
                    />
                  ))}
                </div>
              </div>
            </div>

            {/* Ücret/tip değişikliği tarih etkilidir — geçmiş aylar korunur. */}
            {wageOrTypeChanged && (
              <div className="space-y-1.5 animate-slide-up">
                <Label
                  htmlFor="worker-edit-from"
                  className="text-[11px] font-bold text-primary ml-1"
                >
                  Bu tarihten itibaren geçerli
                </Label>
                <Input
                  id="worker-edit-from"
                  type="date"
                  className="h-12 rounded-xl border bg-muted/30 font-bold"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                />
                {lockStateUnknown ? (
                  <p className="text-[11px] text-info font-semibold leading-relaxed">
                    Dönem kilidi okunamadığı için ücret değişikliği kaydedilemez.
                  </p>
                ) : (
                  pendingRateImpact?.requiresConfirmation && (
                    <p className="text-[11px] text-warn font-semibold leading-relaxed">
                      {formatPeriod(periodOf(effectiveFrom))} ve sonrası etkilenecek — kaydederken
                      onay isteyeceğiz.
                    </p>
                  )
                )}
                <div className="flex gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => setEffectiveFrom(format(startOfMonth(new Date()), "yyyy-MM-dd"))}
                    className="tap-target flex-1 rounded-lg bg-muted/60 border text-[11px] font-bold hover:bg-muted"
                  >
                    Bu ayın başı
                  </button>
                  <button
                    type="button"
                    onClick={() => setEffectiveFrom(RATE_HISTORY_EPOCH)}
                    className="tap-target flex-1 rounded-lg bg-muted/60 border text-[11px] font-bold hover:bg-muted"
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
              disabled={!editName.trim() || effectiveFromBlocked}
              onClick={() => {
                // Geçmişe yürüyorsa kaydetmeden önce onay diyaloğu açılır.
                if (pendingRateImpact?.requiresConfirmation) {
                  setRateImpact(pendingRateImpact);
                  return;
                }
                void saveWorker(false);
              }}
            >
              Değişiklikleri Kaydet
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* K2 — geçmişe yürüyen ücret değişikliği onayı. Kilitli ay burada
          ENGELLENMEZ; uyarılır ve onay alınır. */}
      <Dialog open={rateImpact !== null} onOpenChange={(open) => !open && setRateImpact(null)}>
        <DialogContent className="w-[90%] max-w-sm rounded-sheet p-6 border-none shadow-2xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-[17px] font-semibold">
              Geçmiş hakedişleri değiştir
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-medium py-2 leading-relaxed">
            {rateImpact && describeRateChangeImpact(rateImpact)}
          </p>
          <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
            Bu dönemlerin hakedişi yeni yevmiyeyle yeniden hesaplanır. Kilitli dönemler
            onaylandıktan sonra da kapalı kalır.
          </p>
          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-12 rounded-control border font-bold text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => setRateImpact(null)}
              disabled={isSavingPayment}
            >
              Vazgeç
            </button>
            <button
              className="flex-1 h-12 rounded-control bg-primary text-primary-foreground font-semibold text-xs shadow-sm disabled:opacity-60"
              onClick={() => void saveWorker(true)}
            >
              Onayla ve Kaydet
            </button>
          </div>
        </DialogContent>
      </Dialog>

      {/* K1 — bakiye aşımı onayı. Onaylanmadan `addPayment` çağrılmaz; store
          katmanındaki koruma yine de tek başına yeterlidir. */}
      <Dialog
        open={overpayExcessAmount !== null}
        onOpenChange={(open) => !open && setOverpayExcessAmount(null)}
      >
        <DialogContent className="w-[90%] max-w-sm rounded-sheet p-6 border-none shadow-2xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-[17px] font-semibold">Bakiye aşılıyor</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-medium py-2 leading-relaxed">
            Kalan bakiye{" "}
            <span className="font-semibold text-foreground font-mono">
              ₺{Math.round(stats.balance).toLocaleString("tr-TR")}
            </span>
            . Bu ödeme bakiyeyi{" "}
            <span className="font-semibold text-bad font-mono">
              ₺{Math.round(overpayExcessAmount ?? 0).toLocaleString("tr-TR")}
            </span>{" "}
            aşıyor.
          </p>
          <p className="text-[11px] text-muted-foreground font-medium leading-relaxed">
            Onaylarsanız ödeme kaydedilir ve çalışan fazla ödeme görünür.
          </p>
          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-12 rounded-control border font-bold text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => setOverpayExcessAmount(null)}
              disabled={isSavingPayment}
            >
              Vazgeç
            </button>
            <button
              className="flex-1 h-12 rounded-control bg-primary text-primary-foreground font-semibold text-xs shadow-sm disabled:opacity-60"
              onClick={() => void savePayment(true)}
              disabled={isSavingPayment}
            >
              {isSavingPayment ? "..." : "Onayla ve Kaydet"}
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <div className="flex-1 overflow-y-auto no-scrollbar touch-pan-y">
        <div className="p-4 space-y-4 pb-safe-content">
          {/* Ay seçici */}
          <div className="flex items-center justify-between rounded-control bg-muted/40 p-1">
            <button
              onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
              aria-label="Önceki ay"
              className="tap-target rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background active:scale-90 transition-all"
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
              disabled={!canSelectNextMonth(currentMonth)}
              className="tap-target rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-background active:scale-90 transition-all disabled:opacity-30 disabled:pointer-events-none"
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

          {/* Yevmiye geçmişi — "yevmiyem 1500 ama ekranda 1000" itirazının cevabı */}
          <div className="rounded-card surface-raised overflow-hidden">
            <div className="flex items-baseline justify-between px-4 pt-4 pb-2">
              <h3 className="text-[13px] font-medium">Yevmiye geçmişi</h3>
              <span className="text-[11px] text-muted-foreground">
                {monthRate.worker_type === "ORTAK" ? "Ortak" : "Günlük"} · ₺
                {monthRate.daily_wage.toLocaleString("tr-TR")}
              </span>
            </div>
            <p className="px-4 pb-3 text-[11px] text-muted-foreground leading-relaxed">
              {monthLabel} hesabında{" "}
              <span className="font-semibold text-foreground">
                ₺{monthRate.daily_wage.toLocaleString("tr-TR")}
              </span>{" "}
              yevmiye geçerli
              {monthRateFrom ? (
                <>
                  {" "}
                  (<span className="tabular-nums">{monthRateFrom}</span> tarihinden itibaren)
                </>
              ) : (
                " (tüm geçmiş boyunca)"
              )}
              .
            </p>
            {rateRows.length > 0 && (
              <div className="border-t border-border/60 divide-y">
                {rateRows.map((r) => (
                  <div
                    key={r.id}
                    className="flex items-center justify-between px-4 py-2 text-[11px]"
                  >
                    <span className="tabular-nums text-muted-foreground">
                      {format(parseISO(r.valid_from), "dd MMM yyyy", { locale: tr })}
                    </span>
                    <span className="font-semibold tabular-nums">
                      ₺{Number(r.daily_wage).toLocaleString("tr-TR")}
                      <span className="ml-1 font-normal text-muted-foreground">
                        {r.worker_type === "ORTAK" ? "ortak" : "yevmiyeli"}
                      </span>
                    </span>
                  </div>
                ))}
              </div>
            )}
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
              {/* Sabit sütunlu döküm: dar ekranda sütunlar ezilmesin diye
                  yatay kaydırma sarmalayıcısı. */}
              <div className="h-scroll-touch overflow-x-auto no-scrollbar">
                <div className="min-w-72">
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
                          {day.earned !== 0 ? formatMoney(day.earned) : "—"}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
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
              <button
                disabled={isArchived || monthLocked}
                className="w-full h-12 rounded-control bg-primary text-primary-foreground text-[14px] font-semibold flex items-center justify-center gap-2 shadow-sm active:scale-[0.97] transition-all disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {isArchived ? "Arşivde — ödeme alınamaz" : "Ödeme Yap"}
              </button>
            </DialogTrigger>
            <DialogContent className="rounded-2xl border-none shadow-2xl mx-4">
              <DialogHeader>
                <DialogTitle className="text-lg font-black">Ödeme Yap</DialogTitle>
              </DialogHeader>
              <div className="space-y-4 py-3">
                <div className="space-y-1.5">
                  <Label
                    htmlFor="worker-pay-amount"
                    className="text-[11px] font-bold text-muted-foreground ml-1"
                  >
                    Tutar (₺)
                  </Label>
                  <Input
                    id="worker-pay-amount"
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
                  <Label
                    htmlFor="worker-pay-date"
                    className="text-[11px] font-bold text-muted-foreground ml-1"
                  >
                    Ödeme Tarihi
                  </Label>
                  <Input
                    id="worker-pay-date"
                    type="date"
                    className="h-12 rounded-xl border bg-muted/30 font-bold"
                    value={payDate}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                      setPayDate(e.target.value)
                    }
                  />
                  {payDateLocked && (
                    <p className="text-[11px] text-info font-semibold leading-relaxed">
                      {formatPeriod(periodOf(payDate))} kapatılmış — bu tarihe ödeme kaydedilemez.
                      Açık bir dönem seçin.
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label
                    htmlFor="worker-pay-desc"
                    className="text-[11px] font-bold text-muted-foreground ml-1"
                  >
                    Açıklama (Opsiyonel)
                  </Label>
                  <Input
                    id="worker-pay-desc"
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
                  disabled={
                    !payAmount ||
                    !(parseFloat(payAmount) > 0) ||
                    !payDate ||
                    payDateLocked ||
                    isSavingPayment
                  }
                  onClick={() => {
                    const amount = parseFloat(payAmount);
                    if (!(amount > 0) || !payDate) return;
                    // Bakiyeyi aşan ödeme onaysız kaydedilmez (K1): aşım
                    // hesabı store ile aynı saf kuralı (`overpayExcess`) kullanır.
                    const excess = overpayExcess(stats.balance, amount);
                    if (excess > 0) {
                      setOverpayExcessAmount(excess);
                      return;
                    }
                    void savePayment(false);
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
                      disabled={isLocked(p.date)}
                      aria-label="Ödemeyi sil"
                      title={isLocked(p.date) ? "Dönem kapalı — silinemez" : "Ödemeyi sil"}
                      className="tap-target -my-1 rounded-lg flex items-center justify-center text-muted-foreground hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-500/10 active:scale-90 transition-all disabled:opacity-30"
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
              {workerPayments.length > monthPayments.length && (
                <p className="text-[11px] text-muted-foreground/70 text-center pt-1">
                  Diğer dönemlerde {workerPayments.length - monthPayments.length} ödeme daha var.
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
                  className="flex-1 h-12 rounded-control bg-bad text-on-bad font-semibold text-xs shadow-sm"
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
                      className="flex-1 h-12 rounded-control bg-bad text-on-bad hover:opacity-90 font-semibold text-xs shadow-sm"
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
