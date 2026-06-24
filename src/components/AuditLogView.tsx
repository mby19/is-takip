import { useEffect, useState } from "react";
import { useAuditLogStore } from "../stores/auditLogStore";
import { parseLogData } from "../utils/parseLogData";
import { useWorkerStore } from "../stores/workerStore";
import { useToastStore } from "../stores/toastStore";
import {
  ArrowLeft,
  Clock,
  Trash2,
  Edit3,
  PlusCircle,
  RotateCcw,
  Loader2,
  ChevronDown,
  AlertCircle,
} from "lucide-react";
import { format, parseISO } from "date-fns";
import { tr } from "date-fns/locale";
import type { AuditLog } from "../types";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function AuditLogView({ onBack }: { onBack: () => void }) {
  const { logs, fetchLogs, isLoading, revertLog } = useAuditLogStore();
  const { workers } = useWorkerStore();
  const [filter, setFilter] = useState<"ALL" | "daily_metrics" | "payments">("ALL");
  const [revertingId, setRevertingId] = useState<number | null>(null);
  const [confirmLog, setConfirmLog] = useState<AuditLog | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const addToast = useToastStore((s) => s.addToast);

  const toggleExpand = (id: number) => {
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const getWorkerName = (id: number | string) => {
    const w = workers.find((w) => w.id === (typeof id === "string" ? parseInt(id) : id));
    return w?.name || `Çalışan #${id}`;
  };

  useEffect(() => {
    fetchLogs();
  }, [fetchLogs]);

  const filteredLogs = logs.filter((log) => {
    if (filter === "ALL") {
      return true; // Tümü sekmesinde tüm kayıtları göster
    }
    return log.entity_table === filter;
  });

  // --- Helpers ---
  const statusLabel = (s: string | undefined) => {
    const map: Record<string, string> = {
      FULL: "Tam Gün",
      HALF: "Yarım Gün",
      ABSENT: "Yok",
      HOLIDAY: "Tatil",
    };
    return map[s || ""] || s || "—";
  };
  const statusColor = (s: string | undefined) => {
    const map: Record<string, string> = {
      FULL: "text-emerald-600 dark:text-emerald-400",
      HALF: "text-amber-600 dark:text-amber-400",
      ABSENT: "text-rose-600 dark:text-rose-400",
      HOLIDAY: "text-blue-600 dark:text-blue-400",
    };
    return map[s || ""] || "text-muted-foreground";
  };
  const fmtDate = (d: string | undefined) => {
    if (!d) return "";
    try {
      const m = [
        "Oca",
        "Şub",
        "Mar",
        "Nis",
        "May",
        "Haz",
        "Tem",
        "Ağu",
        "Eyl",
        "Eki",
        "Kas",
        "Ara",
      ];
      const [y, mo, da] = d.split("-");
      return `${parseInt(da)} ${m[parseInt(mo) - 1]} ${y}`;
    } catch {
      return d;
    }
  };
  const fmtTime = (c: string) => {
    try {
      return format(parseISO(c.replace(" ", "T")), "dd MMM HH:mm", { locale: tr });
    } catch {
      return c;
    }
  };

  const parseAtts = (s: string | null | undefined) => {
    if (!s) return {};
    const res: Record<string, { name: string; status: string }> = {};
    s.split(",").forEach((part) => {
      const sub = part.trim().split(":");
      if (sub.length >= 3) {
        res[sub[0]] = { name: sub[1], status: sub[2] };
      } else if (sub.length === 2) {
        res[sub[0]] = { name: sub[0], status: sub[1] };
      }
    });
    return res;
  };

  // --- Log mesajı ---
  const renderLog = (log: AuditLog) => {
    const nd = parseLogData(log.new_data);
    const od = parseLogData(log.old_data);

    // Çalışan ekleme
    if (log.entity_table === "workers" && log.action_type === "INSERT") {
      const name = nd?.name || "?";
      const type = nd?.type === "ORTAK" ? "Ortak" : nd?.type === "GUNLUK" ? "Günlük" : "";
      return (
        <p>
          <b className="text-primary">{name}</b> {type && `(${type})`} eklendi
        </p>
      );
    }

    // Çalışma Durumu — genişletilebilir
    if (log.entity_table === "attendance") {
      const wid = nd?.worker_id || od?.worker_id;
      const name = wid
        ? getWorkerName(wid)
        : nd?.worker_name || od?.worker_name || `#${log.record_id}`;
      const date = nd?.date || od?.date;
      const hasDetail = !!(wid || date);
      const isOpen = expandedIds.has(log.id);

      const summary =
        log.action_type === "INSERT" ? (
          <>
            <b>{name}</b> çalışma durumu eklendi
          </>
        ) : (
          <>
            <b>{name}</b> çalışma durumu güncellendi
          </>
        );

      return (
        <div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasDetail) toggleExpand(log.id);
            }}
            className="flex items-center gap-1 w-full text-left"
          >
            <div className="flex-1">
              <div className="text-[12px]">{summary}</div>
              <div className="text-[10px] text-muted-foreground font-bold">{fmtDate(date)}</div>
            </div>
            {hasDetail && (
              <ChevronDown
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>
          {isOpen && hasDetail && (
            <div className="mt-2 space-y-1">
              <div className="flex justify-between px-2.5 py-1 rounded-lg bg-muted/30 text-[11px]">
                <span className="text-muted-foreground">Tarih</span>
                <b>{fmtDate(date)}</b>
              </div>
              {log.action_type === "INSERT" && nd?.status && (
                <div className="flex justify-between px-2.5 py-1 rounded-lg bg-muted/30 text-[11px]">
                  <span className="text-muted-foreground">Durum</span>
                  <b className={statusColor(nd.status)}>{statusLabel(nd.status)}</b>
                </div>
              )}
              {log.action_type === "UPDATE" && (
                <div className="flex justify-between px-2.5 py-1 rounded-lg bg-muted/30 text-[11px]">
                  <span className="text-muted-foreground">Durum</span>
                  <span>
                    <span className="line-through opacity-50">{statusLabel(od?.status)}</span>
                    {" → "}
                    <b className={statusColor(nd?.status)}>{statusLabel(nd?.status)}</b>
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      );
    }

    // Günlük üretim — genişletilebilir
    if (log.entity_table === "daily_metrics") {
      const date = nd?.date || od?.date;
      const hasDetail = (nd && !nd._raw) || (od && !od._raw);
      const isOpen = expandedIds.has(log.id);

      // Kaç kişinin çalışma durumu değişmiş bulalım
      const oldAtts = parseAtts(od?.atts);
      const newAtts = parseAtts(nd?.atts);
      const changedCount = Object.keys(newAtts).filter(
        (id) => newAtts[id].status !== (oldAtts[id]?.status || "YOK"),
      ).length;

      return (
        <div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (hasDetail) toggleExpand(log.id);
            }}
            className="flex items-center gap-1 w-full text-left"
          >
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <b>{fmtDate(date)}</b> günlük veri{" "}
                {log.action_type === "INSERT" ? "eklendi" : "güncellendi"}
                {changedCount > 0 && (
                  <span className="bg-primary/10 text-primary text-[8px] px-1.5 py-0.5 rounded-full font-black border border-primary/20">
                    {changedCount} kişi güncellendi
                  </span>
                )}
              </div>
              {hasDetail && (
                <span className="text-primary/60 text-[10px]">Detaylar için dokunun ▾</span>
              )}
            </div>
            {hasDetail && (
              <ChevronDown
                className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
              />
            )}
          </button>
          {isOpen && hasDetail && renderMetricsDetail(od, nd, log.action_type)}
        </div>
      );
    }

    // Ödeme
    if (log.entity_table === "payments") {
      const d = nd || od;
      const workerName = d?.worker_id ? getWorkerName(d.worker_id) : d?.worker_name || "";
      const actionLabel =
        log.action_type === "INSERT"
          ? "eklendi"
          : log.action_type === "UPDATE"
            ? "güncellendi"
            : "silindi";

      return (
        <p>
          {workerName && (
            <>
              <b>{workerName}</b> için{" "}
            </>
          )}
          <b className="text-emerald-600 dark:text-emerald-400">₺{d?.amount || "0"}</b> tutarında
          ödeme {actionLabel}
        </p>
      );
    }

    // Fallback
    return (
      <p className="text-muted-foreground">
        Bir kayıt {log.action_type === "INSERT" ? "eklendi" : "güncellendi"}
      </p>
    );
  };

  const renderMetricsDetail = (
    od: Record<string, string> | null,
    nd: Record<string, string> | null,
    action: string,
  ) => {
    const fields = [
      { k: "production", ak: "production_amount", label: "Palet", suffix: " adet" },
      { k: "earned", ak: "total_earned", label: "Toplam Kazanç", prefix: "₺" },
      { k: "expenses", ak: "extra_expenses", label: "Giderler", prefix: "₺" },
    ];
    const g = (d: Record<string, string> | null, k: string, ak: string) =>
      d?.[k] ?? d?.[ak] ?? null;
    const f = (v: string | null, field: (typeof fields)[0]) => {
      if (!v && v !== "0") return "—";
      return `${field.prefix || ""}${v}${field.suffix || ""}`;
    };

    const oldAtts = parseAtts(od?.atts);
    const newAtts = parseAtts(nd?.atts);
    const allWorkerIds = Array.from(new Set([...Object.keys(oldAtts), ...Object.keys(newAtts)]));

    return (
      <div className="mt-2 space-y-3">
        {/* Metrikler */}
        <div className="space-y-1">
          {fields.map((field) => {
            const ov = g(od, field.k, field.ak);
            const nv = g(nd, field.k, field.ak);

            if (action === "INSERT") {
              if (!nv && nv !== "0") return null;
              return (
                <div
                  key={field.k}
                  className="flex justify-between px-2.5 py-1 rounded-lg bg-muted/30 text-[11px]"
                >
                  <span className="text-muted-foreground">{field.label}</span>
                  <b className="text-foreground">{f(nv, field)}</b>
                </div>
              );
            }

            const isSame =
              ov === nv || (ov !== null && nv !== null && parseFloat(ov) === parseFloat(nv));
            if (isSame) return null;

            return (
              <div
                key={field.k}
                className="flex justify-between px-2.5 py-1 rounded-lg bg-muted/30 text-[11px]"
              >
                <span className="text-muted-foreground">{field.label}</span>
                <span>
                  <span className="line-through opacity-50">{f(ov, field)}</span> →{" "}
                  <b>{f(nv, field)}</b>
                </span>
              </div>
            );
          })}
        </div>

        {/* Personel Durumu / Değişiklikleri */}
        {allWorkerIds.length > 0 && (
          <div className="border-t pt-2">
            <p className="text-[9px] font-bold text-muted-foreground uppercase tracking-widest mb-1.5 px-1">
              Personel Durumu
            </p>
            <div className="grid grid-cols-2 gap-1.5">
              {allWorkerIds.map((id) => {
                const o = oldAtts[id];
                const n = newAtts[id];
                const name = getWorkerName(id) || n?.name || o?.name || "?";
                const os = o?.status || "YOK";
                const ns = n?.status || "YOK";
                const isChanged = os !== ns;

                const sLbl = (s: string) => (s === "FULL" ? "Tam" : s === "HALF" ? "Yarım" : "Yok");

                return (
                  <div
                    key={id}
                    className={`flex items-center justify-between px-2 py-1 rounded-md border ${isChanged ? "bg-primary/5 border-primary/20 shadow-sm" : "bg-muted/20 border-border/30 opacity-70"}`}
                  >
                    <span
                      className={`text-[10px] truncate pr-1 ${isChanged ? "font-bold text-primary" : "font-medium"}`}
                    >
                      {name}
                    </span>
                    <span className="text-[10px] font-black flex items-center gap-0.5">
                      {isChanged ? (
                        <>
                          <span className={`${statusColor(os)} opacity-40`}>{sLbl(os)}</span>
                          <span className="text-muted-foreground/30 text-[8px]">→</span>
                          <span className={statusColor(ns)}>{sLbl(ns)}</span>
                        </>
                      ) : ns === "FULL" || ns === "HALF" ? (
                        <span className={statusColor(ns)}>{sLbl(ns)}</span>
                      ) : null}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    );
  };

  const handleRevert = async (log: AuditLog) => {
    setRevertingId(log.id);
    try {
      await revertLog(log);
      addToast("Geri alındı!", "success");
      // Geri alma sonrası tüm store'ların ve sayfaların sıfırlanıp güncel veriyi veritabanından çekmesini garanti et
      setTimeout(() => {
        window.location.reload();
      }, 500);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      addToast("Geri alma hatası: " + msg, "error");
    } finally {
      setRevertingId(null);
    }
  };

  const getRevertDescription = (log: AuditLog) => {
    const nd = parseLogData(log.new_data);
    const od = parseLogData(log.old_data);
    const date = nd?.date || od?.date;
    const wid = nd?.worker_id || od?.worker_id;
    const wname = wid ? getWorkerName(wid) : nd?.worker_name || od?.worker_name || "";

    const fmtDateLocal = (d: string) => {
      try {
        return format(parseISO(d), "dd MMMM yyyy", { locale: tr });
      } catch {
        return d;
      }
    };

    if (log.entity_table === "daily_metrics") {
      const dateStr = date ? fmtDateLocal(date) : "";
      if (log.action_type === "UPDATE") {
        return `${dateStr} tarihli günlük veriyi ve çalışma durumlarını eski haline geri getirir.`;
      }
      if (log.action_type === "INSERT") {
        return `${dateStr} tarihindeki tüm günlük veriyi ve çalışma durumlarını komple siler.`;
      }
      if (log.action_type === "DELETE") {
        return `Silinen ${dateStr} tarihli günlük veriyi ve çalışma durumlarını geri getirir.`;
      }
    }

    if (log.entity_table === "attendance") {
      const dateStr = date ? fmtDateLocal(date) : "";
      const name = wname || `Çalışan #${log.record_id}`;
      return `${name} adlı kişinin ${dateStr} tarihindeki çalışma durumunu eski haline döndürür.`;
    }

    if (log.entity_table === "payments") {
      const amount = nd?.amount || od?.amount || "0";
      const name = wname || (wid ? getWorkerName(wid) : `Personel #${wid}`);
      if (log.action_type === "INSERT") {
        return `${name} için eklenmiş olan ₺${amount} tutarındaki ödeme kaydını veritabanından siler.`;
      }
      if (log.action_type === "DELETE") {
        return `${name} için silinmiş olan ₺${amount} tutarındaki ödemeyi geri getirerek veritabanına yeniden ekler.`;
      }
      if (log.action_type === "UPDATE") {
        const oldAmt = od?.amount || "0";
        return `${name} için yapılan ödeme güncellemesini iptal ederek tutarı eski haline (₺${oldAmt}) geri yükler.`;
      }
    }

    if (log.entity_table === "workers") {
      const name = nd?.name || od?.name || `Çalışan #${log.record_id}`;
      if (log.action_type === "INSERT") {
        return `"${name}" adlı kişiyi ve tüm çalışma durumu/ödeme geçmişini sistemden tamamen siler.`;
      }
      if (log.action_type === "DELETE") {
        return `Silinen "${name}" isimli çalışanı ve profilini veritabanına geri yükler.`;
      }
      if (log.action_type === "UPDATE") {
        return `"${name}" isimli çalışanın bilgilerinde (günlük yevmiye, çalışan tipi vb.) yapılan güncellemeleri geri alarak eski haline döndürür.`;
      }
    }

    return "Bu işlem yapılan değişiklikleri geri alarak veritabanını önceki durumuna döndürecektir.";
  };

  const actionIcon = (t: string) => {
    if (t === "INSERT")
      return <PlusCircle className="w-3.5 h-3.5 text-emerald-500 flex-shrink-0" />;
    if (t === "UPDATE") return <Edit3 className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />;
    return <Trash2 className="w-3.5 h-3.5 text-rose-500 flex-shrink-0" />;
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {/* Header */}
      <header className="px-4 pt-14 pb-3 border-b bg-card flex flex-col gap-3 flex-shrink-0">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-lg font-black tracking-tight">İşlem Geçmişi</h1>
              <p className="text-[9px] font-bold text-muted-foreground tracking-wider">
                {logs.length} kayıt
              </p>
            </div>
          </div>
        </div>

        <div className="flex gap-1.5">
          {[
            { id: "ALL", label: "Tümü" },
            { id: "daily_metrics", label: "Günlük Veri" },
            { id: "payments", label: "Ödemeler" },
          ].map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id as "ALL" | "daily_metrics" | "payments")}
              className={`px-3.5 py-1.5 rounded-lg text-[10px] font-bold transition-all ${
                filter === item.id
                  ? "bg-primary text-primary-foreground shadow-sm"
                  : "bg-muted/50 dark:bg-muted/20 text-muted-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </header>

      {/* Log listesi */}
      <div className="flex-1 overflow-y-auto no-scrollbar">
        <div className="p-3 space-y-2 pb-24">
          {isLoading && (
            <p className="text-center py-10 animate-pulse text-sm text-muted-foreground">
              Yükleniyor...
            </p>
          )}

          {filteredLogs.map((log) => (
            <div key={log.id} className="p-3 rounded-xl bg-card border shadow-sm">
              {/* Üst satır: ikon + zaman + geri al */}
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  {actionIcon(log.action_type)}
                  <span className="text-[9px] text-muted-foreground font-medium flex items-center gap-1">
                    <Clock className="w-2.5 h-2.5" />
                    {fmtTime(log.created_at)}
                  </span>
                </div>
                {["attendance", "daily_metrics", "payments", "workers"].includes(
                  log.entity_table,
                ) &&
                  ["UPDATE", "INSERT", "DELETE"].includes(log.action_type) && (
                    <button
                      onClick={() => setConfirmLog(log)}
                      disabled={revertingId === log.id}
                      className="text-[9px] font-bold text-rose-500 bg-rose-50 dark:bg-rose-500/10 px-2 py-0.5 rounded active:scale-95 flex items-center gap-0.5 disabled:opacity-50"
                    >
                      {revertingId === log.id ? (
                        <Loader2 className="w-2.5 h-2.5 animate-spin" />
                      ) : (
                        <RotateCcw className="w-2.5 h-2.5" />
                      )}
                      Geri Al
                    </button>
                  )}
              </div>
              {/* Mesaj */}
              <div className="text-[12px] leading-relaxed">{renderLog(log)}</div>
            </div>
          ))}

          {filteredLogs.length === 0 && !isLoading && (
            <div className="text-center py-20 text-muted-foreground/40 space-y-2">
              <p className="text-sm font-medium">Henüz kayıt yok</p>
              <p className="text-xs">Veri girişi yaptığınızda burada görünecek.</p>
            </div>
          )}
        </div>
      </div>

      {/* Geri Alma Açıklama Modalı */}
      <Dialog
        open={!!confirmLog}
        onOpenChange={(open) => {
          if (!open) setConfirmLog(null);
        }}
      >
        <DialogContent className="max-w-md w-[95vw] rounded-[28px] p-6 border-none shadow-2xl bg-background">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-base font-black flex items-center gap-2">
              <RotateCcw className="w-5 h-5 text-rose-500" />
              İşlemi Geri Almak İstiyor Musunuz?
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground mt-1">
              Bu işlem veritabanı kayıtlarında geriye dönük değişiklik yapacaktır.
            </DialogDescription>
          </DialogHeader>

          {confirmLog && (
            <div className="space-y-4">
              <div className="p-4 rounded-2xl bg-rose-500/5 border border-rose-500/15 space-y-2">
                <div className="flex items-start gap-2.5">
                  <AlertCircle className="w-4 h-4 text-rose-500 mt-0.5 flex-shrink-0" />
                  <div>
                    <h4 className="text-xs font-black text-rose-600 dark:text-rose-400 uppercase tracking-wider">
                      Yapılacak Değişiklik
                    </h4>
                    <p className="text-[12px] leading-relaxed text-muted-foreground mt-1 font-medium">
                      {getRevertDescription(confirmLog)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => setConfirmLog(null)}
                  className="flex-1 h-12 rounded-xl text-xs font-bold bg-muted hover:bg-muted/70 active:scale-95 transition-all"
                >
                  İptal Et
                </button>
                <button
                  onClick={async () => {
                    const log = confirmLog;
                    setConfirmLog(null);
                    await handleRevert(log);
                  }}
                  className="flex-1 h-12 rounded-xl text-xs font-black bg-rose-500 text-white shadow-lg shadow-rose-500/20 hover:bg-rose-600 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Geri Al ve Yenile
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
