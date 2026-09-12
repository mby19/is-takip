import { invoke } from "@tauri-apps/api/core";
import { fetchQuery } from "./db";
import { todayKey } from "./period";
import { reportError } from "./errorMonitoring";
import { useReminderStore } from "../stores/reminderStore";

/**
 * Günlük puantaj hatırlatması.
 *
 * Uygulamanın değeri her gün veri girilmesine bağlı; atlanan bir gün ay sonu
 * hesabını eksik bırakıyor. Hatırlatma bunun için var.
 *
 * NEDEN GÜNLER TEK TEK KURULUYOR:
 * Bildirimi işletim sistemi zamanlıyor; uygulama kapalıyken "bugün veri
 * girilmiş mi" diye veritabanına bakamaz. Tekrarlayan tek bir bildirim, veri
 * girilmiş günlerde de çalar ve birkaç günde kapatılır. Onun yerine önümüzdeki
 * günler ayrı ayrı kurulur; uygulama her açıldığında hepsi iptal edilip
 * yeniden kurulur ve bugünün verisi girilmişse bugün atlanır.
 */

/** Kaç gün ileriye kurulacağı. Uygulama bu süre içinde bir kez açılırsa yenilenir. */
const DAYS_AHEAD = 14;

/** Hatırlatma bildirimlerinin kimlik aralığı — başka bildirimlerle çakışmasın. */
const ID_BASE = 9100;

/** Her yeniden kurulumda önce iptal edilen kimlikler. */
const REMINDER_IDS = Array.from({ length: DAYS_AHEAD }, (_, i) => ID_BASE + i);

export const REMINDER_ACTION_TYPE = "puantaj-hatirlatma";
export const ACTION_MARK_ALL_FULL = "hepsi-tam";
export const ACTION_OPEN_TODAY = "bugunu-ac";

/** Uygulama kısayolunun (simgeye basılı tutma) açtığı bağlantı. */
export const DEEP_LINK_TODAY = "istakip://bugun";

/**
 * Bildirim izninin durumu.
 *
 * Eklentinin `isPermissionGranted()` yardımcısı önce `window.Notification.permission`
 * değerine bakıp kısa devre yapıyor; Android webview'inde bu değer izin verildikten
 * sonra bile güncellenmeyebiliyor ve bildirimler sessizce kurulmuyordu. Bu yüzden
 * eklentiye doğrudan soruluyor. `null` = "henüz belirlenmedi".
 */
async function permissionState(): Promise<boolean | null> {
  const granted = await invoke<boolean | null>("plugin:notification|is_permission_granted");
  return granted ?? null;
}

/** Bildirim izni ister. Kullanıcı hatırlatmayı açtığında çağrılır, açılışta değil. */
export async function ensureNotificationPermission(): Promise<boolean> {
  try {
    if ((await permissionState()) === true) return true;
    const { requestPermission } = await import("@tauri-apps/plugin-notification");
    return (await requestPermission()) === "granted";
  } catch (err: unknown) {
    reportError(err instanceof Error ? err : new Error(String(err)), {
      scope: "notification-permission",
    });
    return false;
  }
}

/** Bugüne ait tek bir puantaj kaydı bile varsa gün girilmiş sayılır. */
async function hasAttendanceToday(): Promise<boolean> {
  const rows = await fetchQuery<{ n: number }>(
    "SELECT COUNT(*) AS n FROM attendance WHERE date = ?",
    [todayKey()],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

export interface PlannedReminder {
  /** Bildirim kimliği — yeniden kurulumda aynı gün aynı kimliği alır. */
  id: number;
  /** Bildirimin çalacağı an. */
  fireAt: Date;
  /** Bugüne ait mi — gövde metni buna göre değişir. */
  isToday: boolean;
}

export interface ReminderPlanInput {
  /** `HH:MM` — kullanıcının seçtiği hatırlatma saati. */
  time: string;
  /** Bugüne ait puantaj kaydı var mı? Varsa bugün atlanır. */
  filledToday: boolean;
  /** Şu an — testlerin sabitleyebilmesi için dışarıdan verilir. */
  now: Date;
  daysAhead?: number;
}

/**
 * Kurulacak bildirimlerin listesi.
 *
 * Zamanlamanın tek zor kısmı burası olduğu için eklentiden ayrı, saf bir
 * fonksiyon: geçmiş saat atlanır, verisi girilmiş bugün atlanır.
 */
export function planReminders({
  time,
  filledToday,
  now,
  daysAhead = DAYS_AHEAD,
}: ReminderPlanInput): PlannedReminder[] {
  const [hour, minute] = time.split(":").map(Number);
  const plan: PlannedReminder[] = [];

  for (let offset = 0; offset < daysAhead; offset++) {
    const fireAt = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offset);
    fireAt.setHours(hour, minute, 0, 0);

    if (fireAt <= now) continue;
    if (offset === 0 && filledToday) continue;

    plan.push({ id: ID_BASE + offset, fireAt, isToday: offset === 0 });
  }

  return plan;
}

/**
 * En son kurulan hatırlatma kümesinin imzası.
 * Puantaj her değiştiğinde senkronizasyon çağrılıyor; imza aynıysa 14 bildirim
 * boş yere yeniden kurulmuyor.
 */
let lastSignature: string | null = null;

/** Testler ve zorunlu yeniden kurulum için imzayı sıfırlar. */
export const resetReminderSync = (): void => {
  lastSignature = null;
};

/**
 * Bekleyen tüm hatırlatmaları iptal edip yeniden kurar.
 * Açılışta, ayar değişiminde ve puantaj yazımından sonra çağrılır.
 */
export async function syncReminders(): Promise<void> {
  try {
    const { enabled, time } = useReminderStore.getState();
    const today = todayKey();
    const filled = enabled ? await hasAttendanceToday() : false;

    const signature = `${enabled}|${time}|${today}|${filled}`;
    if (signature === lastSignature) return;

    const { cancel, registerActionTypes, sendNotification, Schedule } =
      await import("@tauri-apps/plugin-notification");

    // `cancelAll()` KULLANILMIYOR: Android eklentisinde `notifications` alanı
    // zorunlu, cancelAll ise onu hiç göndermiyor; çağrı hata veriyor ve hata
    // yutulduğu için tek bir bildirim bile kurulmadan sessizce çıkılıyordu.
    // Kendi kimlik aralığımızı açıkça iptal etmek hem çalışıyor hem de başka
    // bildirimlere dokunmuyor.
    await cancel(REMINDER_IDS);
    lastSignature = signature;

    if (!enabled) return;
    // Yalnızca kesin olarak reddedilmişse vazgeçilir; belirsiz durumda kurulur.
    if ((await permissionState()) === false) return;

    await registerActionTypes([
      {
        id: REMINDER_ACTION_TYPE,
        actions: [
          { id: ACTION_MARK_ALL_FULL, title: "Herkes tam gün", foreground: true },
          { id: ACTION_OPEN_TODAY, title: "Puantajı aç", foreground: true },
        ],
      },
    ]);

    for (const { id, fireAt, isToday } of planReminders({
      time,
      filledToday: filled,
      now: new Date(),
    })) {
      sendNotification({
        id,
        title: "Puantaj hatırlatması",
        body: isToday ? "Bugünün puantajı henüz girilmedi." : "Günün puantajını girmeyi unutmayın.",
        actionTypeId: REMINDER_ACTION_TYPE,
        schedule: Schedule.at(fireAt, false, true),
      });
    }
  } catch (err: unknown) {
    // Hatırlatma bir kolaylık; kurulamaması uygulamanın çalışmasını engellemez.
    lastSignature = null;
    reportError(err instanceof Error ? err : new Error(String(err)), { scope: "reminder-sync" });
  }
}
