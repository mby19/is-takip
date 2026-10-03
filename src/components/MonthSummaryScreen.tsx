import { useEffect, useMemo, useState, useCallback } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Lock,
  LockOpen,
  Layers,
  TrendingUp,
  Wallet,
  Scale,
  Users,
  Loader2,
} from "lucide-react";
import { format, startOfMonth, endOfMonth, eachDayOfInterval } from "date-fns";
import { tr } from "date-fns/locale";
import { useWorkerStore } from "../stores/workerStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { useDomainMonthData } from "../hooks/useDomainMonthData";
import { periodOfDate, formatPeriod } from "../lib/period";
import { calculateDailyEarnings, rateResolverFor, roundMoney } from "../utils/earningsCalculator";
import { buildWorkerStats, canSelectNextMonth } from "../lib/periodStats";
import { formatMoney } from "../lib/utils";
import type { Attendance, AttendanceStatus, Worker } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { WorkerAvatar } from "./ui/worker-avatar";
import { workerInitials } from "../utils/initials";

interface MonthSummaryScreenProps {
  onWorkerClick: (worker: Worker) => void;
}

/**
 * Ekipte bu ay verisi olan herkes — arşivlenmişler dahil.
 *
 * Hook'un `selectPool` geri çağrısı olarak da kullanılır: hakedişin
 * hesaplandığı havuz ile ekranda listelenen kişi listesi aynı olmalı, yoksa
 * toplamlar ekrandaki satırlarla uyuşmaz. Modül seviyesinde tanımlı ki
 * kimliği her render'da değişmez — hook içindeki `useMemo` bu yüzden bozulmaz.
 */
const selectRelevant = (
  workers: readonly Worker[],
  attendance: readonly Attendance[],
): Worker[] => {
  const monthIds = new Set(attendance.map((a) => Number(a.worker_id)));
  return workers.filter((w) => w.is_active !== false || monthIds.has(w.id));
};

export function MonthSummaryScreen({ onWorkerClick }: MonthSummaryScreenProps) {
  const closed = usePeriodStore((s) => s.closed);
  const workers = useWorkerStore((s) => s.workers);
  const closePeriod = usePeriodStore((s) => s.closePeriod);
  const reopenPeriod = usePeriodStore((s) => s.reopenPeriod);
  const addToast = useToastStore((s) => s.addToast);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [confirmLock, setConfirmLock] = useState(false);
  const [busy, setBusy] = useState(false);

  const period = periodOfDate(currentMonth);
  const isClosed = closed.some((c) => c.period === period);
  const monthLabel = format(currentMonth, "MMMM yyyy", { locale: tr });

  /**
   * Hook havuzu kendi `workers` listesiyle birleştirir; `selectPool` yalnız
   * attendance alır, bu yüzden `workers` burada kapatılır.
   */
  const selectPoolOf = useCallback(
    (att: readonly Attendance[]) => selectRelevant(workers, att),
    [workers],
  );

  /**
   * Veri ortak hook'tan gelir (K8): ekran hiçbir repository'ye dokunmaz.
   * `withPayments` açık çünkü "tüm dönemler dahil" bakiye tüm ödemeleri
   * gerektirir; puantaj ise yalnız ekrandaki ayın aralığıyla okunur.
   */
  const {
    rateHistory,
    attendance,
    metrics,
    payments,
    periodIndex,
    periodEarnings,
    allTimeEarned,
    isLoading: loading,
    error: dataError,
  } = useDomainMonthData({
    month: currentMonth,
    withPayments: true,
    selectPool: selectPoolOf,
  });

  /** Hook'un okuma hatası ekrana toast olarak düşer; hook kendi hatasını yutar. */
  useEffect(() => {
    if (dataError) addToast(dataError, "error");
  }, [dataError, addToast]);

  /** Ekipte bu ay verisi olan herkes — arşivlenmişler dahil. */
  const relevantWorkers = useMemo(() => selectRelevant(workers, attendance), [attendance, workers]);

  /**
   * İşletme tarafı: üretim, ciro, gider, yevmiye, net kâr ve **dağıtılmayan**
   * tutar. Sonuncusu olmadan ortaklara dağıtılmayan kâr/zarar ekranda hiç
   * görünmez — para kaybolmuş gibi durur (ADR-0009).
   */
  const business = useMemo(() => {
    const byDate = periodIndex.attendanceByDate;

    let production = 0;
    let revenue = 0;
    let expenses = 0;
    let wageCost = 0;
    let netProfit = 0;
    let undistributed = 0;

    for (const m of metrics) {
      production += m.production_amount || 0;
      revenue += m.total_earned || 0;
      expenses += m.extra_expenses || 0;

      const dateStr = String(m.date).trim();
      const statusMap: Record<number, AttendanceStatus | null> = {};
      for (const a of byDate.get(dateStr) ?? []) statusMap[Number(a.worker_id)] = a.status;

      const day = calculateDailyEarnings(
        relevantWorkers,
        statusMap,
        m.total_earned || 0,
        m.extra_expenses || 0,
        rateResolverFor(dateStr, rateHistory),
      );
      wageCost += day.totalWorkerCosts;
      netProfit += day.netProfit;
      undistributed += day.undistributed;
    }

    const workedDays = eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth),
    }).filter((d) => (byDate.get(format(d, "yyyy-MM-dd")) ?? []).length > 0).length;

    return {
      production,
      revenue,
      expenses,
      wageCost: roundMoney(wageCost),
      netProfit: roundMoney(netProfit),
      undistributed: roundMoney(undistributed),
      workedDays,
    };
  }, [metrics, periodIndex, relevantWorkers, rateHistory, currentMonth]);

  const rows = useMemo(
    () =>
      relevantWorkers
        .map((worker) => ({
          worker,
          stats: buildWorkerStats(
            worker,
            period,
            periodEarnings,
            allTimeEarned.get(worker.id) ?? 0,
            payments,
          ),
        }))
        .filter((r) => r.stats.totalEarnedInMonth !== 0 || r.stats.paidInMonth !== 0)
        .sort((a, b) => b.stats.periodBalance - a.stats.periodBalance),
    [relevantWorkers, period, periodEarnings, allTimeEarned, payments],
  );

  const initials = useMemo(() => workerInitials(relevantWorkers), [relevantWorkers]);

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          earned: acc.earned + r.stats.totalEarnedInMonth,
          paid: acc.paid + r.stats.paidInMonth,
          due: acc.due + r.stats.periodBalance,
          debt: acc.debt + r.stats.balance,
        }),
        { earned: 0, paid: 0, due: 0, debt: 0 },
      ),
    [rows],
  );

  const toggleLock = async () => {
    setBusy(true);
    try {
      if (isClosed) {
        await reopenPeriod(period);
        addToast(`${formatPeriod(period)} yeniden açıldı`, "success");
      } else {
        await closePeriod(period);
        addToast(`${formatPeriod(period)} kapatıldı`, "success");
      }
      setConfirmLock(false);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden animate-screen-enter">
      <header className="pt-safe-header pb-4 px-5 border-b bg-card shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-control bg-primary/10 flex items-center justify-center">
            <Scale className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Ay Sonu</h1>
            <p className="text-[10px] font-bold text-muted-foreground  ">Hakediş ve ödeme özeti</p>
          </div>
        </div>

        <div className="flex items-center justify-between bg-muted/30 rounded-control p-1 border">
          <button
            onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
            aria-label="Önceki ay"
            className="tap-target rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-background"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-semibold capitalize">{monthLabel}</span>
            {isClosed && (
              <span className="text-[11px] font-medium text-info bg-info-soft px-1.5 py-0.5 rounded flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Kapalı
              </span>
            )}
          </div>
          <button
            onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
            aria-label="Sonraki ay"
            disabled={!canSelectNextMonth(currentMonth)}
            className="tap-target rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-background disabled:opacity-30 disabled:pointer-events-none"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-4 pb-safe-content">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            {/* Ödenecek toplam — ekranın asıl cevabı */}
            <div className="rounded-card border-2 border-primary/20 surface-raised p-4">
              <div className="text-[11px] font-medium text-primary/70">Bu ay ödenecek kalan</div>
              <div className="text-3xl font-semibold font-mono tracking-tight text-primary mt-1">
                {formatMoney(totals.due)}
              </div>
              <div className="text-[11px] font-bold text-muted-foreground mt-1.5">
                {formatMoney(totals.earned)} hakediş − {formatMoney(totals.paid)} ödendi
              </div>
              {/*
                Borç satırı ASLA gizlenmez: `due !== debt` guard'ı, önceki
                dönemlerden kalan bir borç tam olarak bu ayki rakama eşit
                olduğunda satırı yok ediyordu — yani borç varken ekranda
                borç görünmüyordu.
              */}
              <div className="text-[11px] font-bold text-muted-foreground mt-0.5">
                {totals.debt >= 0
                  ? "Tüm dönemler dahil kalan borç"
                  : "Tüm dönemler dahil fazla ödeme"}
                :{" "}
                <span className={`font-mono ${totals.debt >= 0 ? "text-foreground" : "text-bad"}`}>
                  {formatMoney(Math.abs(totals.debt))}
                </span>
              </div>
            </div>

            {/* İşletme özeti */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Layers, label: "Üretim", value: `${business.production}`, cls: "" },
                { icon: TrendingUp, label: "Ciro", value: formatMoney(business.revenue), cls: "" },
                {
                  icon: Wallet,
                  label: "Yevmiye gideri",
                  value: formatMoney(business.wageCost),
                  cls: "",
                },
                {
                  icon: Scale,
                  label: "Net kâr",
                  value: formatMoney(business.netProfit),
                  cls: business.netProfit < 0 ? "text-bad" : "text-ok",
                },
              ].map(({ icon: Icon, label, value, cls }) => (
                <div key={label} className="rounded-control border bg-card p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[11px]">{label}</span>
                  </div>
                  <div className={`text-base font-semibold font-mono tracking-tight mt-1 ${cls}`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            {/* Ortaklara dağıtılmayan tutar (ADR-0009). Zararlı gün ortak payı
                dağıtılmaz; kârlı gün aktif ortak yoksa kâr da dağıtılmaz.
                Bu satır olmadan dönem düzeyinde ortada kalan para hiç
                görünmezdi. Aynı satır işletme özetiyle de tutarlılık denetimi
                yapar: yevmiye + net kâr − dağıtılmayan = kişi hakedişleri. */}
            {business.undistributed !== 0 && (
              <div className="rounded-control border bg-card px-3 py-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                  <Scale className="w-3.5 h-3.5" />
                  <span>
                    {business.undistributed < 0
                      ? "İşletme zararı — ortak payı dağıtılmadı"
                      : "Dağıtılmayan kâr — o günlerde aktif ortak yoktu"}
                  </span>
                </div>
                <span
                  className={`text-sm font-semibold font-mono tabular-nums ${
                    business.undistributed < 0 ? "text-bad" : "text-foreground"
                  }`}
                >
                  {formatMoney(business.undistributed)}
                </span>
              </div>
            )}

            <p className="text-[11px] text-muted-foreground font-medium px-1">
              Bu ay {business.workedDays} gün kayıt girilmiş. Gider toplamı{" "}
              {formatMoney(business.expenses)}.
            </p>

            {/* Kişi bazlı döküm */}
            <div>
              <h2 className="text-[11px] font-medium text-muted-foreground ml-1 mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Kişi bazlı
              </h2>

              {rows.length === 0 ? (
                <div className="rounded-card border border-dashed bg-card/50 py-10 text-center">
                  <p className="text-xs font-bold text-muted-foreground">
                    {monthLabel} döneminde kayıt yok
                  </p>
                </div>
              ) : (
                <div className="rounded-card border bg-card overflow-hidden divide-y">
                  {rows.map(({ worker, stats }) => (
                    <button
                      key={worker.id}
                      onClick={() => onWorkerClick(worker)}
                      className="tap-target w-full flex items-center justify-between px-3.5 py-3 gap-3 text-left hover:bg-muted/40 active:bg-muted/60 transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <WorkerAvatar worker={worker} label={initials.get(worker.id)} />
                        <div className="min-w-0">
                          <p className="font-bold text-[13px] leading-tight truncate">
                            {worker.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground font-medium">
                            {formatMoney(stats.totalEarnedInMonth)} hakediş ·{" "}
                            {formatMoney(stats.paidInMonth)} ödendi
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-[14px] font-semibold font-mono tracking-tight ${
                            stats.periodBalance > 0
                              ? "text-ok"
                              : stats.periodBalance < 0
                                ? "text-bad"
                                : "text-muted-foreground"
                          }`}
                        >
                          {formatMoney(stats.periodBalance)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {stats.periodBalance >= 0 ? "ödenecek" : "fazla ödeme"}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dönem kilidi */}
            <button
              onClick={() => setConfirmLock(true)}
              className={`w-full h-12 rounded-control border-2 font-semibold text-xs flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                isClosed
                  ? "border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                  : "border-sky-300 text-sky-700 dark:border-sky-500/40 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-info-soft"
              }`}
            >
              {isClosed ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {isClosed ? "Dönemi Yeniden Aç" : "Dönemi Kapat"}
            </button>
          </>
        )}
      </div>

      <Dialog open={confirmLock} onOpenChange={setConfirmLock}>
        <DialogContent className="w-[90%] max-w-sm rounded-sheet p-6 border-none shadow-2xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-[17px] font-semibold">
              {isClosed ? "Dönemi Yeniden Aç" : "Dönemi Kapat"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-medium py-2 leading-relaxed">
            {isClosed ? (
              <>
                <span className="font-semibold text-foreground">{monthLabel}</span> yeniden
                düzenlenebilir hale gelecek. İşiniz bitince tekrar kapatmayı unutmayın.
              </>
            ) : (
              <>
                <span className="font-semibold text-foreground">{monthLabel}</span> kapatılacak. Bu
                aya ait puantaj, gün verisi ve ödemeler değiştirilemez olur. Ödenecek kalan:{" "}
                <span className="font-semibold text-foreground font-mono">
                  {formatMoney(totals.due)}
                </span>
                .
              </>
            )}
          </p>
          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-12 rounded-control border font-bold text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => setConfirmLock(false)}
              disabled={busy}
            >
              Vazgeç
            </button>
            <button
              className={`flex-1 h-12 rounded-control font-semibold text-xs shadow-sm disabled:opacity-60 ${
                isClosed ? "bg-amber-500 shadow-amber-500/20" : "bg-sky-500 shadow-sky-500/20"
              }`}
              onClick={toggleLock}
              disabled={busy}
            >
              {busy ? "..." : isClosed ? "Evet, Aç" : "Evet, Kapat"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
