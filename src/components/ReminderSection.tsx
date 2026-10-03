import { useState } from "react";
import { Bell, BellOff } from "lucide-react";
import { useReminderStore, INVALID_TIME_MESSAGE } from "../stores/reminderStore";
import { ensureNotificationPermission, resetReminderSync, syncReminders } from "../lib/reminder";
import { useToastStore } from "../stores/toastStore";

/**
 * Günlük hatırlatma ayarı.
 *
 * İzin, hatırlatma AÇILDIĞI anda isteniyor — uygulama ilk açılışta bildirim
 * izni sormuyor, çünkü kullanıcı henüz ne için sorulduğunu bilmiyor olur.
 */
export function ReminderSection() {
  const enabled = useReminderStore((s) => s.enabled);
  const time = useReminderStore((s) => s.time);
  const setEnabled = useReminderStore((s) => s.setEnabled);
  const setTime = useReminderStore((s) => s.setTime);
  const [isBusy, setIsBusy] = useState(false);

  /**
   * Bildirimleri kuran/iptal eden asıl iş `useReminders` içindeki etkide;
   * burada yalnızca ayar değiştirilir. İmza sıfırlanmazsa etki, ayar değişse
   * bile "zaten kurulu" sanıp hiçbir şey yapmaz.
   */
  const toggle = async () => {
    if (enabled) {
      resetReminderSync();
      setEnabled(false);
      return;
    }

    setIsBusy(true);
    try {
      if (!(await ensureNotificationPermission())) {
        useToastStore
          .getState()
          .addToast("Bildirim izni verilmedi. Telefon ayarlarından açabilirsiniz.", "error");
        return;
      }
      resetReminderSync();
      setEnabled(true);
      // Başarı bildirimi yalnızca kurulum GERÇEKTEN denendiğinde atılır.
      // `syncReminders` sessizce başarısız olabiliyor (izin reddedilmiş ya da
      // beklenmedik hata); bu durumlarda "kuruldu" demek yanlış olurdu.
      const result = await syncReminders();
      if (result === "izin-yok") {
        useToastStore
          .getState()
          .addToast("Bildirim izni verilmedi, hatırlatma kurulamadı.", "error");
        return;
      }
      if (result === "hata") {
        useToastStore
          .getState()
          .addToast("Hatırlatma kurulamadı, bir sonraki açılışta tekrar denenecek.", "error");
        return;
      }
      useToastStore.getState().addToast(`Her gün ${time} için hatırlatma kuruldu`, "success");
    } finally {
      setIsBusy(false);
    }
  };

  /** Geçersiz saat sessizce yutulmaz: kullanıcı neden kaydedilmediğini bilir. */
  const changeTime = (value: string) => {
    if (!setTime(value)) {
      useToastStore.getState().addToast(INVALID_TIME_MESSAGE, "error");
      return;
    }
    resetReminderSync();
  };

  return (
    <div className="space-y-4">
      <h2 className="text-[11px] font-medium text-muted-foreground ml-1 flex items-center gap-1.5">
        <Bell className="w-3.5 h-3.5" /> Günlük Hatırlatma
      </h2>

      <button
        onClick={() => void toggle()}
        disabled={isBusy}
        className="w-full p-4 rounded-card border-2 bg-card flex items-center gap-4 text-left active:scale-[0.99] transition-all disabled:opacity-60"
      >
        <div
          className={`w-11 h-11 rounded-control flex items-center justify-center shrink-0 ${
            enabled ? "bg-primary/10" : "bg-muted"
          }`}
        >
          {enabled ? (
            <Bell className="w-5 h-5 text-primary" />
          ) : (
            <BellOff className="w-5 h-5 text-muted-foreground" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-semibold">
            {enabled ? "Hatırlatma açık" : "Hatırlatma kapalı"}
          </div>
          <div className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">
            {enabled
              ? `Her gün ${time}'de, o günün puantajı girilmemişse bildirim gelir.`
              : "Gün sonunda puantajı girmeyi unutmamak için bildirim gönderilir."}
          </div>
        </div>
        <div
          className={`w-11 h-6 rounded-full shrink-0 flex items-center px-0.5 transition-colors ${
            enabled ? "bg-primary justify-end" : "bg-muted-foreground/30 justify-start"
          }`}
        >
          <div className="w-5 h-5 rounded-full bg-background shadow" />
        </div>
      </button>

      {enabled && (
        <label className="flex items-center justify-between gap-4 p-4 rounded-card border-2 bg-card">
          <span className="text-[13px] font-medium">Hatırlatma saati</span>
          <input
            type="time"
            value={time}
            onChange={(e) => changeTime(e.target.value)}
            className="h-10 px-3 rounded-control border-2 bg-background text-[15px] font-semibold tabular-nums"
          />
        </label>
      )}
    </div>
  );
}
