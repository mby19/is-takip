import { useEffect, useMemo, useState } from "react";
import { Lock, LockOpen, CalendarCheck, Loader2 } from "lucide-react";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { formatPeriod, periodsSince, periodOfDate, type PeriodKey } from "../lib/period";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

export function PeriodLockSection() {
  const closed = usePeriodStore((s) => s.closed);
  const earliest = usePeriodStore((s) => s.earliestDataPeriod);
  const isLoading = usePeriodStore((s) => s.isLoading);
  const fetchClosedPeriods = usePeriodStore((s) => s.fetchClosedPeriods);
  const closePeriod = usePeriodStore((s) => s.closePeriod);
  const reopenPeriod = usePeriodStore((s) => s.reopenPeriod);
  const addToast = useToastStore((s) => s.addToast);

  const [pending, setPending] = useState<{ period: PeriodKey; action: "close" | "reopen" } | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    fetchClosedPeriods();
  }, [fetchClosedPeriods]);

  const closedSet = useMemo(() => new Set(closed.map((c) => c.period)), [closed]);
  const currentPeriod = periodOfDate(new Date());

  const periods = useMemo(() => {
    const all = periodsSince(earliest);
    return showAll ? all : all.slice(0, 6);
  }, [earliest, showAll]);

  const apply = async () => {
    if (!pending) return;
    setBusy(true);
    try {
      if (pending.action === "close") {
        await closePeriod(pending.period);
        addToast(`${formatPeriod(pending.period)} kapatıldı`, "success");
      } else {
        await reopenPeriod(pending.period);
        addToast(`${formatPeriod(pending.period)} yeniden açıldı`, "success");
      }
      setPending(null);
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <h2 className="text-[11px] font-medium text-muted-foreground ml-1 flex items-center gap-1.5">
        <CalendarCheck className="w-3.5 h-3.5" /> Dönem Kilidi
      </h2>

      <p className="text-[11px] text-muted-foreground font-medium leading-relaxed px-1">
        Ödemesi tamamlanan ayı kapatın. Kapalı bir dönemde puantaj, gün verisi ve ödeme
        değiştirilemez; yevmiye değişikliği o aya geriye dönük uygulanamaz. Açma ve kapama işlemleri
        Sistem Geçmişi'ne kaydedilir.
      </p>

      <div className="rounded-card border bg-card divide-y overflow-hidden">
        {isLoading && periods.length === 0 && (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {periods.map((period) => {
          const locked = closedSet.has(period);
          const isCurrent = period === currentPeriod;

          return (
            <div key={period} className="flex items-center justify-between px-4 py-3 gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold capitalize">{formatPeriod(period)}</span>
                  {isCurrent && (
                    <span className="text-[11px] font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      İçinde
                    </span>
                  )}
                </div>
                <div
                  className={`text-[11px] font-bold ${
                    locked ? "text-info" : "text-muted-foreground"
                  }`}
                >
                  {locked ? "Kapalı — salt okunur" : "Açık — değiştirilebilir"}
                </div>
              </div>

              <button
                onClick={() => setPending({ period, action: locked ? "reopen" : "close" })}
                aria-label={`${formatPeriod(period)} dönemini ${locked ? "aç" : "kapat"}`}
                className={`shrink-0 h-9 px-3 rounded-control border text-[11px] font-medium flex items-center gap-1.5 transition-all active:scale-95 ${
                  locked
                    ? "bg-sky-500 text-white border-sky-500 shadow-sm shadow-sky-500/20"
                    : "bg-transparent text-muted-foreground border-border hover:bg-muted"
                }`}
              >
                {locked ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
                {locked ? "Aç" : "Kapat"}
              </button>
            </div>
          );
        })}
      </div>

      {periodsSince(earliest).length > 6 && (
        <button
          onClick={() => setShowAll((v) => !v)}
          className="w-full h-10 rounded-control border text-[11px] font-medium text-muted-foreground hover:bg-muted transition-colors"
        >
          {showAll ? "Daha az göster" : "Tüm dönemleri göster"}
        </button>
      )}

      <Dialog open={!!pending} onOpenChange={(open) => !open && setPending(null)}>
        <DialogContent className="w-[90%] max-w-sm rounded-sheet p-6 border-none shadow-2xl">
          <DialogHeader className="mb-2">
            <DialogTitle className="text-[17px] font-semibold">
              {pending?.action === "close" ? "Dönemi Kapat" : "Dönemi Yeniden Aç"}
            </DialogTitle>
          </DialogHeader>

          {pending?.action === "close" ? (
            <p className="text-sm text-muted-foreground font-medium py-2 leading-relaxed">
              <span className="font-semibold text-foreground">{formatPeriod(pending.period)}</span>{" "}
              dönemi kapatılacak. Bu aya ait puantaj, üretim, ciro ve ödeme kayıtları değiştirilemez
              hale gelir. İstediğiniz zaman buradan tekrar açabilirsiniz.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground font-medium py-2 leading-relaxed">
              <span className="font-semibold text-foreground">
                {pending ? formatPeriod(pending.period) : ""}
              </span>{" "}
              dönemi yeniden açılacak ve düzenlenebilir hale gelecek. Ödemesi yapılmış bir dönemde
              yapılan değişiklik hakediş rakamlarını değiştirir — işiniz bitince tekrar kapatın.
            </p>
          )}

          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-12 rounded-control border font-bold text-xs hover:bg-muted disabled:opacity-50"
              onClick={() => setPending(null)}
              disabled={busy}
            >
              Vazgeç
            </button>
            <button
              className={`flex-1 h-12 rounded-control text-white font-bold text-xs shadow-md disabled:opacity-60 ${
                pending?.action === "close"
                  ? "bg-sky-500 shadow-sky-500/20"
                  : "bg-amber-500 shadow-amber-500/20"
              }`}
              onClick={apply}
              disabled={busy}
            >
              {busy ? "..." : pending?.action === "close" ? "Evet, Kapat" : "Evet, Aç"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
