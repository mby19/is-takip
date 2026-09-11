import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useToastStore, type Toast } from "../stores/toastStore";
import { X } from "lucide-react";

function ToastItem({
  id,
  message,
  type,
  action,
  onRemove,
}: Toast & { onRemove: (id: string) => void }) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    // Eylemli bildirim daha uzun durur: kullanıcının karar verecek vakti olmalı.
    const timer = setTimeout(
      () => {
        setExiting(true);
        setTimeout(() => onRemove(id), 300);
      },
      action ? 5800 : 3500,
    );
    return () => clearTimeout(timer);
  }, [id, onRemove, action]);

  const iconMap = {
    success: (
      <svg
        className="w-4 h-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
      >
        <path d="M20 6L9 17l-5-5" />
      </svg>
    ),
    error: (
      <svg
        className="w-4 h-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
      >
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    ),
    info: (
      <svg
        className="w-4 h-4 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={3}
      >
        <circle cx="12" cy="12" r="10" />
        <path d="M12 16v-4M12 8h.01" />
      </svg>
    ),
  };

  const dismiss = () => {
    setExiting(true);
    setTimeout(() => onRemove(id), 300);
  };

  return (
    <div
      data-exiting={exiting ? "true" : undefined}
      onClick={dismiss}
      className={`
 pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-card shadow-2xl text-[13px] font-medium cursor-pointer
 transition-all duration-300 ease-out active:scale-95
        ${exiting ? "opacity-0 translate-y-2 scale-95" : "opacity-100 translate-y-0 scale-100"}
        ${
          type === "success"
            ? "bg-ok text-on-ok"
            : type === "error"
              ? "bg-bad text-on-bad"
              : "bg-foreground text-background"
        }
      `}
      role="alert"
    >
      {iconMap[type]}
      <span className="flex-1">{message}</span>
      {action && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            void action.onClick();
            dismiss();
          }}
          className="shrink-0 px-2.5 h-8 rounded-lg bg-white/20 hover:bg-white/30 text-[13px] font-semibold active:scale-95 transition-all"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          dismiss();
        }}
        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/20 active:scale-90 transition-all shrink-0"
        aria-label="Kapat"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const { toasts, removeToast } = useToastStore();

  if (toasts.length === 0) return null;

  return createPortal(
    <div className="fixed bottom-25 left-1/2 -translate-x-1/2 z-9999 flex flex-col gap-2 w-[90vw] max-w-sm pointer-events-none">
      {toasts.map((t, i) => (
        <div key={t.id} className="animate-pop-in" style={{ animationDelay: `${i * 60}ms` }}>
          <ToastItem {...t} onRemove={removeToast} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
