import { useEffect, useState } from "react";
import { BellRing, X } from "lucide-react";
import { fetchQuery } from "../lib/db";
import { todayKey } from "../lib/period";
import { markTodayFull } from "../lib/quickAttendance";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useReminderStore } from "../stores/reminderStore";
import { isDateInClosedPeriod } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { syncReminders } from "../lib/reminder";

/**
 * «Bugünün puantajı girilmedi» uyarısı.
 *
 * Bildirimdeki eylem düğmelerinin uygulama tamamen kapalıyken kaybolması
 * (bkz. useReminders) bu uyarıyla telafi edilir: kullanıcı uygulamayı açtığında
 * aynı iki seçeneği burada bulur.
 *
 * Yalnızca hatırlatma saati geçtikten sonra görünür — sabahın köründe
 * "puantaj girmedin" demek anlamsız.
 */

interface ReminderBannerProps {
  onOpenToday: () => void;
}

/** Verilen `HH:MM` saati bugün için geçti mi? */
const isPastTime = (time: string): boolean => {
  const [hour, minute] = time.split(":").map(Number);
  const now = new Date();
  return now.getHours() > hour || (now.getHours() === hour && now.getMinutes() >= minute);
};

export function ReminderBanner({ onOpenToday }: ReminderBannerProps) {
  const enabled = useReminderStore((s) => s.enabled);
  const time = useReminderStore((s) => s.time);
  // Takvim başka bir ayı gösteriyorsa store bugünü içermez; sayım doğrudan
  // veritabanından okunur. Değişimi yakalamak için diziyi bağımlılığa alıyoruz.
  const attendances = useAttendanceStore((s) => s.attendances);

  const [isEmpty, setIsEmpty] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [isBusy, setIsBusy] = useState(false);

  useEffect(() => {
    if (!enabled || dismissed || !isPastTime(time)) {
      setIsEmpty(false);
      return;
    }

    let alive = true;
    void (async () => {
      try {
        const date = todayKey();
        if (isDateInClosedPeriod(date)) return;
        const rows = await fetchQuery<{ n: number }>(
          "SELECT COUNT(*) AS n FROM attendance WHERE date = ?",
          [date],
        );
        if (alive) setIsEmpty(Number(rows[0]?.n ?? 0) === 0);
      } catch {
        // Sayım okunamazsa uyarı gösterilmez; sessizce geçilir.
      }
    })();

    return () => {
      alive = false;
    };
  }, [enabled, time, dismissed, attendances]);

  if (!isEmpty) return null;

  const fillToday = async () => {
    setIsBusy(true);
    try {
      const { marked } = await markTodayFull();
      useToastStore
        .getState()
        .addToast(
          marked > 0 ? `${marked} kişi tam güne çekildi` : "İşaretlenecek kişi kalmadı",
          marked > 0 ? "success" : "info",
        );
      void syncReminders();
    } catch (err: unknown) {
      useToastStore.getState().addToast(err instanceof Error ? err.message : String(err), "error");
    } finally {
      setIsBusy(false);
    }
  };

  return (
    <div className="mx-3 mb-2 p-3 rounded-card border border-warn/30 bg-warn-soft flex items-start gap-3 animate-pop-in">
      <BellRing className="w-4 h-4 text-warn shrink-0 mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="text-xs font-semibold text-warn">Bugünün puantajı girilmedi</p>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => void fillToday()}
            disabled={isBusy}
            className="h-8 px-3 rounded-control bg-warn text-on-warn text-[11px] font-bold active:scale-95 transition-all disabled:opacity-50"
          >
            Herkes tam gün
          </button>
          <button
            onClick={onOpenToday}
            className="h-8 px-3 rounded-control border border-warn/40 text-warn text-[11px] font-bold active:scale-95 transition-all"
          >
            Tek tek gir
          </button>
        </div>
      </div>
      <button
        onClick={() => setDismissed(true)}
        aria-label="Uyarıyı kapat"
        className="w-7 h-7 rounded-control flex items-center justify-center text-warn/70 hover:text-warn active:scale-90 transition-all shrink-0"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
