import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useToastStore, type Toast } from "../stores/toastStore";
import { X } from "lucide-react";

/**
 * Bildirimin GÖRÜNME SÜRESİ tek kaynaktan gelir: `toastStore.addToast`
 * (varsayılan 3000ms, eylemli bildirimde 6000ms, `duration` ile özelleştirilebilir).
 * Bu bileşen artık kendi silme zamanlayıcısını kurmaz — iki bağımsız
 * zamanlayıcı hangisinin kazandığı koddan anlaşılmıyordu.
 *
 * Buradaki tek zamanlayıcı ÇIKIŞ animasyonu içindir (300ms): store bildirimi
 * listeden düşürdükten sonra görsel olarak kaybolmasını sağlar.
 */
const EXIT_ANIM_MS = 300;

function ToastItem({
  toast,
  exiting,
  onDismiss,
}: {
  toast: Toast;
  exiting: boolean;
  onDismiss: (id: string) => void;
}) {
  const { id, message, type, action } = toast;
  const [pendingAction, setPendingAction] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

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

  /**
   * "Geri al" gibi kritik eylemler. Hata yutulmaz: eylem başarısız olursa
   * kullanıcı hata görür ve orijinal mesajı korunur. Eylemin kendi bildirimi
   * başarıyla kapanır (store'dan düşer); başarısızsa ek hata bildirimi eklenir.
   */
  const runAction = async () => {
    if (!action || pendingAction) return;
    setPendingAction(true);
    try {
      await action.onClick();
      if (mountedRef.current) onDismiss(id);
    } catch (err: unknown) {
      const reason = err instanceof Error ? err.message : String(err);
      if (mountedRef.current) {
        useToastStore.getState().addToast(`"${action.label}" işlemi yapılamadı: ${reason}`, {
          type: "error",
          duration: 6000,
        });
      }
    } finally {
      if (mountedRef.current) setPendingAction(false);
    }
  };

  /**
   * Bu öğede `role="alert"` YOK. `role="alert"` kendi başına bir canlı bölge
   * yaratır; kökte zaten bir canlı bölge varken ikisi iç içe geçtiğinde aynı
   * mesaj bazı ekran okuyucularda iki kez okunur. Canlı bölge kararı
   * `ToastContainer` kökünde, mesajın türüne göre tek yerde verilir.
   *
   * Duyuru önceliği kaybolmadı: hata bildirimleri assertive bölgeye düşer.
   */
  return (
    <div
      data-exiting={exiting ? "true" : undefined}
      className={`
pointer-events-auto flex items-center gap-2.5 px-4 py-3 rounded-card shadow-2xl text-[13px] font-medium
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
    >
      {iconMap[type]}
      <span className="flex-1">{message}</span>
      {action && (
        <button
          onClick={() => void runAction()}
          disabled={pendingAction || exiting}
          className="shrink-0 px-2.5 h-8 rounded-lg bg-white/20 hover:bg-white/30 disabled:opacity-50 text-[13px] font-semibold active:scale-95 transition-all"
        >
          {action.label}
        </button>
      )}
      <button
        onClick={() => onDismiss(id)}
        disabled={exiting}
        className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-white/20 active:scale-90 transition-all shrink-0"
        aria-label="Bildirimi kapat"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const removeToast = useToastStore((s) => s.removeToast);
  // Store'dan düşen bildirimler çıkış animasyonunu tamamlayabilsin diye
  // 300ms daha render edilir; sonra tamamen kaldırılır.
  const [leaving, setLeaving] = useState<Toast[]>([]);

  // Store bildirimi listeden düşürdüğünde içeriği kaybolur; çıkış boyunca
  // ne gösterileceğini bu harita bilir.
  const lastSeenRef = useRef<Map<string, Toast>>(new Map());
  const previousIdsRef = useRef<ReadonlySet<string>>(new Set());
  const timersRef = useRef<Array<ReturnType<typeof setTimeout>>>([]);

  useEffect(() => {
    for (const toast of toasts) lastSeenRef.current.set(toast.id, toast);

    const currentIds = new Set(toasts.map((t) => t.id));
    const dropped = [...previousIdsRef.current].filter((id) => !currentIds.has(id));
    previousIdsRef.current = currentIds;
    if (dropped.length === 0) return;

    const toExit = dropped
      .map((id) => lastSeenRef.current.get(id))
      .filter((t): t is Toast => t !== undefined);

    setLeaving((cur) => [...cur, ...toExit.filter((t) => !cur.some((c) => c.id === t.id))]);

    timersRef.current.push(
      ...toExit.map((t) =>
        setTimeout(() => {
          lastSeenRef.current.delete(t.id);
          setLeaving((cur) => cur.filter((x) => x.id !== t.id));
        }, EXIT_ANIM_MS),
      ),
    );
  }, [toasts]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach(clearTimeout);
  }, []);

  const visible = [...toasts, ...leaving.filter((t) => !toasts.some((x) => x.id === t.id))];

  if (visible.length === 0) return null;

  // Mesaj başına TAM OLARAK BİR canlı bölge.
  //
  // Daha önce kökte `aria-live="polite"` varken her kartta da `role="alert"`
  // (kendisi assertive canlı bölge) bulunuyordu; iç içe iki canlı bölge aynı
  // mesajı bazı okuyucularda iki kez okutur.
  //
  // Tek bölgeye düşürmek (yalnız polite) çift okumayı çözer ama hata
  // bildirimini meşgulken erteler. O trade-off'un yerine iki KARDŞEN bölge
  // kullanılıyor: bir mesaj ya hata bölgesine ya da bilgi bölgesine girer,
  // dolayısıyla yine tek duyuru olur ve hatalar assertive kalır.
  //
  // Kartlar `role="alert"` taşımadığı için hiçbir yerde ikinci bir canlı
  // bölge doğmuyor. `aria-atomic` bilerek yok: yeni kart eklenince yalnız
  // eklenen metin okunur, bölgedeki eski kartlar tekrar okunmaz.
  const urgent = visible.filter((t) => t.type === "error");
  const calm = visible.filter((t) => t.type !== "error");
  const renderToast = (toast: Toast) => (
    <ToastItem
      key={toast.id}
      toast={toast}
      exiting={leaving.some((t) => t.id === toast.id)}
      onDismiss={removeToast}
    />
  );

  return createPortal(
    <div className="fixed bottom-25 left-1/2 -translate-x-1/2 z-9999 flex flex-col gap-2 w-[90vw] max-w-sm pointer-events-none">
      <div aria-live="assertive" className="flex flex-col gap-2">
        {urgent.map(renderToast)}
      </div>
      <div aria-live="polite" className="flex flex-col gap-2">
        {calm.map(renderToast)}
      </div>
    </div>,
    document.body,
  );
}
