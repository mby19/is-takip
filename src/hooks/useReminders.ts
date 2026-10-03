import { useEffect, useRef } from "react";
import { syncReminders, ACTION_MARK_ALL_FULL, DEEP_LINK_TODAY } from "../lib/reminder";
import { markTodayFull } from "../lib/quickAttendance";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useReminderStore } from "../stores/reminderStore";
import { useToastStore } from "../stores/toastStore";
import { reportError } from "../lib/errorMonitoring";

/**
 * Hatırlatma bildirimlerini ve dışarıdan gelen «bugünü işaretle» isteklerini
 * yönetir. Üç giriş noktası var:
 *   1. Bildirimdeki eylem düğmeleri (uygulama açıkken).
 *   2. Uygulama simgesine basılı tutunca çıkan kısayol (derin bağlantı).
 *   3. Bildirim gövdesine dokunma — bugünü açar.
 *
 * BİLİNEN SINIR: Android eklentisi, uygulama tamamen kapalıyken gelen bildirim
 * eylemini web tarafı dinleyici kurulmadan önce tetikliyor; o durumda eylem
 * kaybolur ve uygulama yalnızca açılır. Karşılığı takvimdeki «bugün girilmedi»
 * uyarısı (ReminderBanner) — kullanıcı aynı işi oradan tek dokunuşla yapar.
 */

/** Puantaj değişimlerinde art arda gelen çağrıları tek senkronizasyona indirir. */
const SYNC_DEBOUNCE_MS = 1500;

interface UseRemindersOptions {
  /** Veritabanı hazır olmadan ne sorgu ne de yazma yapılabilir. */
  ready: boolean;
  /** Bugünün puantaj kartını açar. */
  onOpenToday: () => void;
}

export function useReminders({ ready, onOpenToday }: UseRemindersOptions): void {
  const openTodayRef = useRef(onOpenToday);
  openTodayRef.current = onOpenToday;

  const enabled = useReminderStore((s) => s.enabled);
  const time = useReminderStore((s) => s.time);

  // Bildirim eylemleri ve derin bağlantı dinleyicileri.
  useEffect(() => {
    if (!ready) return;
    let disposed = false;
    const cleanups: (() => void)[] = [];

    const fillToday = async () => {
      try {
        const { marked, skipped } = await markTodayFull();
        const suffix = skipped > 0 ? ` · ${skipped} kişi zaten işaretliydi` : "";
        useToastStore
          .getState()
          .addToast(
            marked > 0
              ? `${marked} kişi tam güne çekildi${suffix}`
              : "Bugün herkesin puantajı zaten girilmiş",
            marked > 0 ? "success" : "info",
          );
        void syncReminders();
      } catch (err: unknown) {
        useToastStore
          .getState()
          .addToast(err instanceof Error ? err.message : String(err), "error");
      }
    };

    void (async () => {
      try {
        const { onAction } = await import("@tauri-apps/plugin-notification");
        const listener = await onAction((payload) => {
          // `actionId` eklentinin tip tanımında yok ama Android tarafı gönderiyor.
          const actionId = (payload as { actionId?: string }).actionId;
          if (actionId === ACTION_MARK_ALL_FULL) void fillToday();
          else openTodayRef.current();
        });
        if (disposed) void listener.unregister();
        else cleanups.push(() => void listener.unregister());
      } catch (err: unknown) {
        reportError(err instanceof Error ? err : new Error(String(err)), {
          scope: "notification-action-listener",
        });
      }
    })();

    void (async () => {
      try {
        const { getCurrent, onOpenUrl } = await import("@tauri-apps/plugin-deep-link");

        const handle = (urls: string[] | null) => {
          if (urls?.some((u) => u.startsWith(DEEP_LINK_TODAY))) openTodayRef.current();
        };

        // Uygulama kapalıyken kısayoldan açıldıysa bağlantı burada bekliyor.
        handle(await getCurrent());

        const unlisten = await onOpenUrl(handle);
        if (disposed) unlisten();
        else cleanups.push(unlisten);
      } catch (err: unknown) {
        reportError(err instanceof Error ? err : new Error(String(err)), {
          scope: "deep-link-listener",
        });
      }
    })();

    return () => {
      disposed = true;
      for (const cleanup of cleanups) cleanup();
    };
  }, [ready]);

  /**
   * Bildirimlerin yeniden kurulması: açılışta, ayar değişince, puantaj
   * yazıldığında ve uygulama öne geldiğinde (gün dönmüş olabilir).
   */
  useEffect(() => {
    if (!ready) return;

    void syncReminders().then((result) => {
      // Kurulum sessizce başarısız olursa kullanıcı bunu bilmeli; bir sonraki
      // denemede tekrar kurulacak (imza sıfırlandığı için).
      if (result === "izin-yok") {
        useToastStore.getState().addToast("Bildirim izni kapalı, hatırlatma kurulamadı.", "error");
      } else if (result === "hata") {
        useToastStore
          .getState()
          .addToast("Hatırlatma kurulamadı, bir sonraki açılışta tekrar denenecek.", "error");
      }
    });
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleSync = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void syncReminders(), SYNC_DEBOUNCE_MS);
    };

    const unsubscribe = useAttendanceStore.subscribe(scheduleSync);
    const onVisible = () => {
      if (!document.hidden) void syncReminders();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [ready, enabled, time]);
}
