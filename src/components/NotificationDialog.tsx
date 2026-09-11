import { useState, useEffect } from "react";
import { Bell, History, Database, AlertTriangle, FileText, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "./ui/dialog";
import { auditLogRepository } from "../repositories/auditLogRepository";
import { format, parseISO } from "date-fns";
import { tr } from "date-fns/locale";
import type { AuditLog } from "../types";

const ACTION_LABELS: Record<string, { label: string; color: string; Icon: typeof Bell }> = {
  INSERT: { label: "Ekleme", color: "text-emerald-600 dark:text-emerald-400", Icon: FileText },
  UPDATE: { label: "Güncelleme", color: "text-blue-600 dark:text-blue-400", Icon: History },
  DELETE: { label: "Silme", color: "text-rose-600 dark:text-rose-400", Icon: Trash2 },
  EXPORT: { label: "Yedekleme", color: "text-indigo-600 dark:text-indigo-400", Icon: Database },
  IMPORT: { label: "Geri Yükleme", color: "text-amber-600 dark:text-amber-400", Icon: Database },
  DELETE_FILE: { label: "Dosya Silme", color: "text-rose-600 dark:text-rose-400", Icon: Trash2 },
};

const ENTITY_LABELS: Record<string, string> = {
  workers: "Çalışan",
  attendance: "Devam",
  daily_metrics: "Metrik",
  payments: "Ödeme",
  backup: "Yedek",
};

function formatAction(log: AuditLog): string {
  const entity = ENTITY_LABELS[log.entity_table] || log.entity_table;
  const action = ACTION_LABELS[log.action_type]?.label || log.action_type;
  return `${entity} • ${action}`;
}

function getIcon(log: AuditLog) {
  const entry = ACTION_LABELS[log.action_type];
  if (!entry) return AlertTriangle;
  return entry.Icon;
}

function getColor(log: AuditLog): string {
  return ACTION_LABELS[log.action_type]?.color || "text-muted-foreground";
}

interface NotificationDialogProps {
  isOpen: boolean;
  onClose: () => void;
}

export function NotificationDialog({ isOpen, onClose }: NotificationDialogProps) {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    setLoading(true);
    auditLogRepository
      .findAll()
      .then(setLogs)
      .catch(() => setLogs([]))
      .finally(() => setLoading(false));
  }, [isOpen]);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md w-[95vw] max-h-[80vh] flex flex-col rounded-3xl p-0 gap-0 border-none shadow-2xl bg-background">
        <DialogHeader className="px-5 pt-6 pb-3 border-b shrink-0">
          <DialogTitle className="text-base font-black flex items-center gap-2">
            <Bell className="w-5 h-5 text-primary" />
            Bildirimler
          </DialogTitle>
          <p className="text-[10px] text-muted-foreground font-bold mt-1">Son 200 işlem kaydı</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-2 px-5">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <p className="text-xs font-bold text-muted-foreground animate-pulse">Yükleniyor...</p>
            </div>
          ) : logs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-3 text-center">
              <div className="w-14 h-14 rounded-2xl bg-muted/50 flex items-center justify-center">
                <Bell className="w-7 h-7 text-muted-foreground/40" />
              </div>
              <p className="text-sm font-bold text-muted-foreground">Henüz bildirim yok</p>
              <p className="text-[10px] text-muted-foreground/60 max-w-55 leading-relaxed">
                Çalışan ekleme, devam kaydı ve ödeme gibi işlemler burada görünecek.
              </p>
            </div>
          ) : (
            <div className="space-y-2 py-2">
              {logs.map((log) => {
                const Icon = getIcon(log);
                const color = getColor(log);
                return (
                  <div
                    key={log.id}
                    className="flex items-start gap-3 p-3.5 rounded-2xl bg-card border border-border hover:bg-muted/30 transition-colors"
                  >
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                        log.action_type === "EXPORT" || log.action_type === "IMPORT"
                          ? "bg-indigo-50 dark:bg-indigo-500/10"
                          : log.action_type === "DELETE_FILE"
                            ? "bg-rose-50 dark:bg-rose-500/10"
                            : "bg-muted"
                      }`}
                    >
                      <Icon className={`w-4.5 h-4.5 ${color}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-xs font-black tracking-tight">{formatAction(log)}</p>
                        <span className="text-[10px] text-muted-foreground font-bold whitespace-nowrap ml-2">
                          {format(parseISO(log.created_at), "HH:mm", { locale: tr })}
                        </span>
                      </div>
                      <p className="text-[10px] text-muted-foreground font-bold mt-0.5 truncate">
                        {log.new_data?.slice(0, 60) ||
                          log.old_data?.slice(0, 60) ||
                          `#${log.record_id}`}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t shrink-0">
          <button
            onClick={onClose}
            className="w-full h-12 rounded-2xl font-bold text-muted-foreground bg-muted/50 hover:bg-muted transition-all active:scale-[0.97] text-sm"
          >
            Kapat
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
