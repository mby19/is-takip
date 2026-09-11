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
import { attendanceRepository } from "../repositories/attendanceRepository";
import { metricsRepository } from "../repositories/metricsRepository";
import { paymentRepository } from "../repositories/paymentRepository";
import { calculateWorkerStats } from "../utils/calculations";
import { calculateDailyEarnings, rateResolverFor } from "../utils/earningsCalculator";
import { periodOfDate, formatPeriod } from "../lib/period";
import type { Attendance, DailyMetric, Payment, Worker, AttendanceStatus } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

interface MonthSummaryScreenProps {
  onWorkerClick: (worker: Worker) => void;
}

const money = (n: number) => `₺${Math.round(n).toLocaleString("tr-TR")}`;

export function MonthSummaryScreen({ onWorkerClick }: MonthSummaryScreenProps) {
  const workers = useWorkerStore((s) => s.workers);
  const rateHistory = useWorkerStore((s) => s.rateHistory);
  const closed = usePeriodStore((s) => s.closed);
  const closePeriod = usePeriodStore((s) => s.closePeriod);
  const reopenPeriod = usePeriodStore((s) => s.reopenPeriod);
  const addToast = useToastStore((s) => s.addToast);

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [attendance, setAttendance] = useState<Attendance[]>([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);
  const [loading, setLoading] = useState(true);
  const [confirmLock, setConfirmLock] = useState(false);
  const [busy, setBusy] = useState(false);

  const period = periodOfDate(currentMonth);
  const isClosed = closed.some((c) => c.period === period);
  const monthLabel = format(currentMonth, "MMMM yyyy", { locale: tr });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [a, m, p] = await Promise.all([
        attendanceRepository.findAll(),
        metricsRepository.findAll(),
        paymentRepository.findAll(),
      ]);
      setAttendance(a);
      setMetrics(m);
      setPayments(p);
    } catch (err: unknown) {
      addToast(`Veriler yüklenemedi: ${err instanceof Error ? err.message : String(err)}`, "error");
    } finally {
      setLoading(false);
    }
  }, [addToast]);

  useEffect(() => {
    load();
  }, [load]);

  /** Ekipte bu ay verisi olan herkes — arşivlenmişler dahil. */
  const relevantWorkers = useMemo(() => {
    const monthIds = new Set(
      attendance.filter((a) => String(a.date).startsWith(period)).map((a) => Number(a.worker_id)),
    );
    return workers.filter((w) => w.is_active !== false || monthIds.has(w.id));
  }, [workers, attendance, period]);

  /** İşletme tarafı: üretim, ciro, gider, yevmiye ve net kâr. */
  const business = useMemo(() => {
    const monthMetrics = metrics.filter((m) => String(m.date).startsWith(period));
    const byDate = new Map<string, Attendance[]>();
    for (const a of attendance) {
      const key = String(a.date).trim();
      const bucket = byDate.get(key);
      if (bucket) bucket.push(a);
      else byDate.set(key, [a]);
    }

    let production = 0;
    let revenue = 0;
    let expenses = 0;
    let wageCost = 0;
    let netProfit = 0;

    for (const m of monthMetrics) {
      const dateStr = String(m.date).trim();
      production += m.production_amount || 0;
      revenue += m.total_earned || 0;
      expenses += m.extra_expenses || 0;

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
    }

    const workedDays = eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth),
    }).filter((d) => (byDate.get(format(d, "yyyy-MM-dd")) ?? []).length > 0).length;

    return { production, revenue, expenses, wageCost, netProfit, workedDays };
  }, [metrics, attendance, period, relevantWorkers, rateHistory, currentMonth]);

  /** Kişi bazlı hakediş / ödeme / bakiye. */
  const rows = useMemo(
    () =>
      relevantWorkers
        .map((worker) => ({
          worker,
          stats: calculateWorkerStats(
            worker,
            currentMonth,
            metrics,
            attendance,
            relevantWorkers,
            payments,
            rateHistory,
          ),
        }))
        .filter((r) => r.stats.totalEarnedInMonth !== 0 || r.stats.paidInMonth !== 0)
        .sort((a, b) => b.stats.periodBalance - a.stats.periodBalance),
    [relevantWorkers, currentMonth, metrics, attendance, payments, rateHistory],
  );

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
    <div className="flex flex-col h-full overflow-hidden animate-scale-in">
      <header className="pt-safe-header pb-4 px-5 border-b bg-card shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
            <Scale className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">Ay Sonu</h1>
            <p className="text-[10px] font-bold text-muted-foreground tracking-wider uppercase">
              Hakediş ve ödeme özeti
            </p>
          </div>
        </div>

        <div className="flex items-center justify-between bg-muted/30 rounded-xl p-1 border">
          <button
            onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() - 1, 1))}
            aria-label="Önceki ay"
            className="w-10 h-9 rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-background"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm font-black capitalize">{monthLabel}</span>
            {isClosed && (
              <span className="text-[10px] font-black uppercase tracking-wider text-sky-600 dark:text-sky-400 bg-sky-500/10 px-1.5 py-0.5 rounded flex items-center gap-1">
                <Lock className="w-2.5 h-2.5" /> Kapalı
              </span>
            )}
          </div>
          <button
            onClick={() => setCurrentMonth((p) => new Date(p.getFullYear(), p.getMonth() + 1, 1))}
            aria-label="Sonraki ay"
            className="w-10 h-9 rounded-lg flex items-center justify-center active:scale-90 transition-all hover:bg-background"
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
            <div className="rounded-2xl border-2 border-primary/20 bg-linear-to-br from-primary/5 to-primary/10 p-4">
              <div className="text-[10px] font-black uppercase tracking-widest text-primary/70">
                Bu ay ödenecek kalan
              </div>
              <div className="text-3xl font-black font-mono tracking-tight text-primary mt-1">
                {money(totals.due)}
              </div>
              <div className="text-[11px] font-bold text-muted-foreground mt-1.5">
                {money(totals.earned)} hakediş − {money(totals.paid)} ödendi
              </div>
              {totals.debt !== totals.due && (
                <div className="text-[11px] font-bold text-muted-foreground mt-0.5">
                  Tüm dönemler dahil kalan borç:{" "}
                  <span className="font-mono text-foreground">{money(totals.debt)}</span>
                </div>
              )}
            </div>

            {/* İşletme özeti */}
            <div className="grid grid-cols-2 gap-2">
              {[
                { icon: Layers, label: "Üretim", value: `${business.production}`, cls: "" },
                { icon: TrendingUp, label: "Ciro", value: money(business.revenue), cls: "" },
                { icon: Wallet, label: "Yevmiye gideri", value: money(business.wageCost), cls: "" },
                {
                  icon: Scale,
                  label: "Net kâr",
                  value: money(business.netProfit),
                  cls:
                    business.netProfit < 0
                      ? "text-rose-600 dark:text-rose-400"
                      : "text-emerald-600 dark:text-emerald-400",
                },
              ].map(({ icon: Icon, label, value, cls }) => (
                <div key={label} className="rounded-xl border bg-card p-3">
                  <div className="flex items-center gap-1.5 text-muted-foreground">
                    <Icon className="w-3.5 h-3.5" />
                    <span className="text-[10px] font-bold uppercase tracking-wider">{label}</span>
                  </div>
                  <div className={`text-base font-black font-mono tracking-tight mt-1 ${cls}`}>
                    {value}
                  </div>
                </div>
              ))}
            </div>

            <p className="text-[11px] text-muted-foreground font-medium px-1">
              Bu ay {business.workedDays} gün kayıt girilmiş. Gider toplamı{" "}
              {money(business.expenses)}.
            </p>

            {/* Kişi bazlı döküm */}
            <div>
              <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 mb-2 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5" /> Kişi bazlı
              </h2>

              {rows.length === 0 ? (
                <div className="rounded-2xl border border-dashed bg-card/50 py-10 text-center">
                  <p className="text-xs font-bold text-muted-foreground">
                    {monthLabel} döneminde kayıt yok
                  </p>
                </div>
              ) : (
                <div className="rounded-2xl border bg-card overflow-hidden divide-y">
                  {rows.map(({ worker, stats }) => (
                    <button
                      key={worker.id}
                      onClick={() => onWorkerClick(worker)}
                      className="w-full flex items-center justify-between px-3.5 py-3 gap-3 text-left hover:bg-muted/40 active:bg-muted/60 transition-colors"
                    >
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
                          <p className="text-[11px] text-muted-foreground font-medium">
                            {money(stats.totalEarnedInMonth)} hakediş · {money(stats.paidInMonth)}{" "}
                            ödendi
                          </p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <div
                          className={`text-sm font-black font-mono tracking-tight ${
                            stats.periodBalance > 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : stats.periodBalance < 0
                                ? "text-rose-600 dark:text-rose-400"
                                : "text-muted-foreground"
                          }`}
                        >
                          {money(stats.periodBalance)}
                        </div>
                        <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
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
              className={`w-full h-12 rounded-xl border-2 font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 transition-all active:scale-[0.98] ${
                isClosed
                  ? "border-amber-300 text-amber-700 dark:border-amber-500/40 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-500/10"
                  : "border-sky-300 text-sky-700 dark:border-sky-500/40 dark:text-sky-400 hover:bg-sky-50 dark:hover:bg-sky-500/10"
              }`}
            >
              {isClosed ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {isClosed ? "Dönemi Yeniden Aç" : "Dönemi Kapat"}
            </button>
          </>
        )}
      </div>

      <Dialog open={confirmLock} onOpenChange={setConfirmLock}>
        <DialogContent className="w-[90%] max-w-sm rounded-3xl p-6 border-none shadow-2xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-lg font-black">
              {isClosed ? "Dönemi Yeniden Aç" : "Dönemi Kapat"}
            </DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground font-medium py-2 leading-relaxed">
            {isClosed ? (
              <>
                <span className="font-black text-foreground">{monthLabel}</span> yeniden
                düzenlenebilir hale gelecek. İşiniz bitince tekrar kapatmayı unutmayın.
              </>
            ) : (
              <>
                <span className="font-black text-foreground">{monthLabel}</span> kapatılacak. Bu aya
                ait puantaj, gün verisi ve ödemeler değiştirilemez olur. Ödenecek kalan:{" "}
                <span className="font-black text-foreground font-mono">{money(totals.due)}</span>.
              </>
            )}
          </p>
          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-12 rounded-xl border font-bold text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => setConfirmLock(false)}
              disabled={busy}
            >
              Vazgeç
            </button>
            <button
              className={`flex-1 h-12 rounded-xl text-white font-bold text-xs shadow-md disabled:opacity-60 ${
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
