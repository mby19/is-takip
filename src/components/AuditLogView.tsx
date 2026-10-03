import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  RotateCcw,
  Loader2,
  History,
  CalendarDays,
  Users,
  Wallet,
  ClipboardCheck,
  Lock,
  Database,
  ChevronDown,
} from "lucide-react";
import { useAuditLogStore } from "../stores/auditLogStore";
import { useWorkerStore } from "../stores/workerStore";
import { useToastStore } from "../stores/toastStore";
import { usePeriodStore } from "../stores/periodStore";
import { periodOf, formatPeriod } from "../lib/period";
import { parseLogData } from "../utils/parseLogData";
import {
  describeAuditLog,
  groupLogsByDay,
  formatLogTime,
  type AuditKind,
  type AuditTone,
} from "../utils/auditLogFormat";
import type { AuditLog } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";

const TONE_TEXT: Record<AuditTone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  neutral: "text-muted-foreground",
};

const TONE_BG: Record<AuditTone, string> = {
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  bad: "bg-bad-soft text-bad",
  info: "bg-info-soft text-info",
  neutral: "bg-muted text-muted-foreground",
};

const KIND_ICON: Record<AuditKind, typeof History> = {
  attendance: ClipboardCheck,
  metrics: CalendarDays,
  payment: Wallet,
  worker: Users,
  period: Lock,
  backup: Database,
  revert: RotateCcw,
  other: History,
};

/** Filtre sekmeleri — eskiden yalnızca üç tanesi vardı, kişiler ve sistem yoktu. */
const FILTERS: { id: string; label: string; kinds: AuditKind[] | null }[] = [
  { id: "ALL", label: "Tümü", kinds: null },
  { id: "attendance", label: "Puantaj", kinds: ["attendance", "metrics"] },
  { id: "payment", label: "Ödeme", kinds: ["payment"] },
  { id: "worker", label: "Kişiler", kinds: ["worker"] },
  { id: "system", label: "Sistem", kinds: ["period", "backup", "revert", "other"] },
];

export function AuditLogView({ onBack }: { onBack: () => void }) {
  const logs = useAuditLogStore((s) => s.logs);
  const fetchLogs = useAuditLogStore((s) => s.fetchLogs);
  const isLoading = useAuditLogStore((s) => s.isLoading);
  const revertLog = useAuditLogStore((s) => s.revertLog);
  const workers = useWorkerStore((s) => s.workers);
  const closedPeriods = usePeriodStore((s) => s.closed);
  const addToast = useToastStore((s) => s.addToast);

  const [filter, setFilter] = useState("ALL");
  const [revertingId, setRevertingId] = useState<number | null>(null);
  const [confirmLog, setConfirmLog] = useState<AuditLog | null>(null);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const resolveWorkerName = useMemo(() => {
    const byId = new Map(workers.map((w) => [w.id, w.name]));
    return (id: number) => byId.get(id);
  }, [workers]);

  /** Kayıt + görünüm modeli bir kez hesaplanır. */
  const entries = useMemo(
    () => logs.map((log) => ({ log, view: describeAuditLog(log, resolveWorkerName) })),
    [logs, resolveWorkerName],
  );

  const visible = useMemo(() => {
    const kinds = FILTERS.find((f) => f.id === filter)?.kinds;
    if (!kinds) return entries;
    return entries.filter((e) => kinds.includes(e.view.kind));
  }, [entries, filter]);

  const groups = useMemo(() => {
    const byDay = groupLogsByDay(visible.map((e) => e.log));
    const viewById = new Map(visible.map((e) => [e.log.id, e.view]));
    return byDay.map((g) => ({
      label: g.label,
      entries: g.logs.map((log) => ({ log, view: viewById.get(log.id)! })),
    }));
  }, [visible]);

  const toggle = (id: number) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  /** Kaydın dokunduğu gün kapalı bir dönemdeyse geri alma engellenir. */
  const isLocked = (log: AuditLog): boolean => {
    const data = parseLogData(log.old_data) ?? parseLogData(log.new_data);
    const date = data?.date;
    return !!date && closedPeriods.some((c) => c.period === periodOf(date));
  };

  const handleRevert = async (log: AuditLog) => {
    setRevertingId(log.id);
    try {
      await revertLog(log);
      addToast("İşlem geri alındı", "success");
    } catch (err: unknown) {
      addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setRevertingId(null);
      setConfirmLog(null);
    }
  };

  const confirmView = confirmLog ? describeAuditLog(confirmLog, resolveWorkerName) : null;

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="px-4 pt-safe-header pb-3 border-b bg-surface flex flex-col gap-3 shrink-0">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            aria-label="Geri"
            className="tap-target rounded-control bg-muted/60 flex items-center justify-center active:scale-90 transition-all"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <h1 className="text-[17px] font-semibold tracking-tight">İşlem geçmişi</h1>
            <p className="text-[11px] text-muted-foreground">{logs.length} kayıt · hepsi kalıcı</p>
          </div>
        </div>

        <div className="h-scroll-touch flex gap-1.5 overflow-x-auto no-scrollbar -mx-1 px-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={`tap-target shrink-0 px-3 rounded-full text-[12px] font-medium transition-all active:scale-95 ${
                filter === f.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted/60 text-muted-foreground hover:text-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </header>

      <div className="flex-1 overflow-y-auto no-scrollbar pb-safe-content">
        {isLoading && logs.length === 0 && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {groups.map((group) => (
          <section key={group.label}>
            <h2 className="sticky top-0 z-10 px-4 py-1.5 bg-surface/95 backdrop-blur-sm text-[11px] font-medium text-muted-foreground border-b border-border/50">
              {group.label}
            </h2>

            {group.entries.map(({ log, view }) => {
              const Icon = KIND_ICON[view.kind];
              const open = expanded.has(log.id);
              const locked = isLocked(log);
              const canRevert = view.revertable && !log.reverted_at && !locked;

              return (
                <article
                  key={log.id}
                  className={`flex gap-3 px-4 py-3 border-b border-border/40 transition-opacity ${
                    log.reverted_at ? "opacity-55" : ""
                  }`}
                >
                  <span
                    className={`w-8 h-8 rounded-full grid place-items-center shrink-0 ${TONE_BG[view.tone]}`}
                  >
                    <Icon className="w-4 h-4" />
                  </span>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline gap-2">
                      <p className="text-[13px] font-medium leading-snug flex-1 min-w-0">
                        {view.title}
                      </p>
                      <time className="text-[11px] text-muted-foreground tabular-nums shrink-0">
                        {formatLogTime(log.created_at)}
                      </time>
                    </div>

                    {view.subtitle && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">{view.subtitle}</p>
                    )}

                    {log.reverted_at && (
                      <p className="text-[11px] text-info mt-1 flex items-center gap-1">
                        <RotateCcw className="w-3 h-3" /> Geri alındı
                      </p>
                    )}

                    {open && view.details.length > 0 && (
                      <dl className="mt-2 rounded-control bg-muted/40 divide-y divide-border/50 animate-screen-enter">
                        {view.details.map((d, i) => (
                          <div
                            key={i}
                            className="flex items-center justify-between gap-3 px-3 py-1.5"
                          >
                            <dt className="text-[11px] text-muted-foreground truncate">
                              {d.label}
                            </dt>
                            <dd className="text-[12px] font-medium tabular-nums shrink-0">
                              {d.was && (
                                <span className="text-muted-foreground line-through mr-1.5">
                                  {d.was}
                                </span>
                              )}
                              <span className={d.tone ? TONE_TEXT[d.tone] : ""}>{d.value}</span>
                            </dd>
                          </div>
                        ))}
                      </dl>
                    )}

                    <div className="flex items-center gap-3 mt-1.5">
                      {view.details.length > 0 && (
                        <button
                          onClick={() => toggle(log.id)}
                          className="tap-target -my-1 px-1 text-[11px] text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors"
                        >
                          {open ? "Gizle" : `Ayrıntı (${view.details.length})`}
                          <ChevronDown
                            className={`w-3 h-3 transition-transform ${open ? "rotate-180" : ""}`}
                          />
                        </button>
                      )}

                      {canRevert && (
                        <button
                          onClick={() => setConfirmLog(log)}
                          disabled={revertingId === log.id}
                          className="tap-target -my-1 px-1 text-[11px] text-muted-foreground hover:text-bad flex items-center gap-1 transition-colors disabled:opacity-50"
                        >
                          {revertingId === log.id ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3 h-3" />
                          )}
                          Geri al
                        </button>
                      )}

                      {view.revertable && locked && !log.reverted_at && (
                        <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                          <Lock className="w-3 h-3" /> Dönem kapalı
                        </span>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}
          </section>
        ))}

        {groups.length === 0 && !isLoading && (
          <div className="flex flex-col items-center justify-center py-20 gap-3 text-center px-8">
            <div className="w-16 h-16 rounded-full bg-muted/50 grid place-items-center">
              <History className="w-7 h-7 text-muted-foreground/50" />
            </div>
            <p className="text-sm font-medium text-muted-foreground">
              {filter === "ALL" ? "Henüz kayıt yok" : "Bu türde kayıt yok"}
            </p>
            <p className="text-[11px] text-muted-foreground/70 max-w-60 leading-relaxed">
              Veri girdikçe tüm değişiklikler — geri alma dahil — burada listelenir.
            </p>
          </div>
        )}
        <p className="px-4 py-3 text-[11px] leading-relaxed text-muted-foreground/70 border-t border-border/40">
          Denetim kayıtları artık otomatik silinmez — geri alma geçmişi kalıcıdır. Veritabanı ve
          yedek dosyası zamanla büyüyebilir; eski kayıtları elle temizlemek istersen
          Ayarlar&apos;tan yedek alabilirsin.
        </p>
      </div>

      {/* Geri alma onayı */}
      <Dialog open={!!confirmLog} onOpenChange={(open) => !open && setConfirmLog(null)}>
        <DialogContent className="w-[90%] max-w-sm rounded-sheet p-6 border-none shadow-2xl">
          <DialogHeader className="mb-1">
            <DialogTitle className="text-base font-semibold">İşlemi geri al</DialogTitle>
          </DialogHeader>

          {confirmView && (
            <>
              <div className="rounded-control bg-muted/50 px-3 py-2.5 my-2">
                <p className="text-[13px] font-medium">{confirmView.title}</p>
                {confirmView.subtitle && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{confirmView.subtitle}</p>
                )}
              </div>
              <p className="text-[13px] text-muted-foreground leading-relaxed">
                Bu kayıt eski hâline döndürülecek. İşlem denetim geçmişine yazılır ve kayıt
                silinmez, «geri alındı» olarak işaretlenir.
              </p>
              {confirmLog && isLocked(confirmLog) && (
                <p className="text-[12px] text-bad mt-2">
                  {formatPeriod(
                    periodOf(
                      parseLogData(confirmLog.old_data)?.date ??
                        parseLogData(confirmLog.new_data)?.date ??
                        "",
                    ),
                  )}{" "}
                  dönemi kapalı — önce açmanız gerekir.
                </p>
              )}
            </>
          )}

          <div className="flex gap-3 mt-4">
            <button
              className="flex-1 h-11 rounded-control bg-muted/60 text-[13px] font-medium hover:bg-muted"
              onClick={() => setConfirmLog(null)}
            >
              Vazgeç
            </button>
            <button
              className="flex-1 h-11 rounded-control bg-bad text-on-bad text-[13px] font-medium disabled:opacity-60"
              disabled={revertingId !== null}
              onClick={() => confirmLog && handleRevert(confirmLog)}
            >
              {revertingId !== null ? "Geri alınıyor..." : "Geri al"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
