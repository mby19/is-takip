import { useState, useEffect } from "react";
import { createPortal } from "react-dom";
import { useToastStore } from "../stores/toastStore";
import { X } from "lucide-react";

function ToastItem({
  id,
  message,
  type,
  onRemove,
}: {
  id: string;
  message: string;
  type: "success" | "error" | "info";
  onRemove: (id: string) => void;
}) {
  const [exiting, setExiting] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setExiting(true);
      setTimeout(() => onRemove(id), 300);
    }, 3500);
    return () => clearTimeout(timer);
  }, [id, onRemove]);

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
 pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-card shadow-2xl text-sm font-bold cursor-pointer
 transition-all duration-300 ease-out active:scale-95
        ${exiting ? "opacity-0 translate-y-2 scale-95" : "opacity-100 translate-y-0 scale-100"}
        ${
          type === "success"
            ? "bg-emerald-600 text-white"
            : type === "error"
              ? "bg-rose-600 text-white"
              : "bg-gray-800 text-white dark:bg-gray-200 dark:text-gray-900"
        }
      `}
      role="alert"
    >
      {iconMap[type]}
      <span className="flex-1">{message}</span>
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
        <div key={t.id} className="animate-slide-up" style={{ animationDelay: `${i * 60}ms` }}>
          <ToastItem id={t.id} message={t.message} type={t.type} onRemove={removeToast} />
        </div>
      ))}
    </div>,
    document.body,
  );
}
