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

/** Bildirim eylemi ve iptali YALNIZCA mobil eklentide var (aşağıdaki `isMobilePlatform`). */

/**
 * Zamanlanmış bildirim desteği yalnız mobil eklentide var.
 *
 * Masaüstü derlemesinin `invoke_handler` listesinde yalnız `notify`,
 * `request_permission` ve `is_permission_granted` var; `cancel`, `get_pending`
 * ve `register_action_types` komutları hiç kayıtlı değil. Çağrıldıklarında her
 * seferinde "command not found" hatası üretiyorlar (Sentry'ye düşüyordu) ve
 * masaüstünde `Schedule.at` da yok sayıldığı için 14 bildirimin hepsi o anda
 * ekrana fırlıyordu. Bu yüzden masaüstünde zamanlama hiç denenmiyor.
 *
 * @param userAgent `navigator.userAgent` — test edilebilir olsun diye dışarıdan.
 */
export function isMobilePlatform(userAgent: string): boolean {
  return /Android|iPhone|iPad|iPod/i.test(userAgent);
}

/** `navigator` yoksa (SSR/test) masaüstü sayılır — mobil komutları çağrılmaz. */
const isMobile = (): boolean =>
  typeof navigator === "undefined" ? false : isMobilePlatform(navigator.userAgent);

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

/**
 * Giriş ölçütü: AKTİF ÇALIŞANLARIN HEPSİ için bugün kayıt var.
 *
 * Ölçütün kaynağı burası; banner bileşeni de aynı kuralı kullanır.
 */
export function isDayComplete(activeWorkers: number, recordedWorkers: number): boolean {
  return activeWorkers > 0 && recordedWorkers >= activeWorkers;
}

/**
 * Bugünün puantajı girilmiş mi?
 *
 * «Tek bir kayıt yeter» ölçütü 40 kişilik bir şantiyede 1 kişi işaretlenince
 * günü «dolu» sayıyor ve geri kalan 39 kişi için bildirim hiç kurulmuyordu.
 */
async function hasAttendanceToday(): Promise<boolean> {
  const rows = await fetchQuery<{ active: number; recorded: number }>(
    `SELECT
       (SELECT COUNT(*) FROM workers WHERE is_active = 1) AS active,
       (SELECT COUNT(*) FROM attendance a
          JOIN workers w ON w.id = a.worker_id
         WHERE a.date = ?1 AND w.is_active = 1) AS recorded`,
    [todayKey()],
  );
  const row = rows[0];
  return isDayComplete(Number(row?.active ?? 0), Number(row?.recorded ?? 0));
}

/**
 * Cihazın saat dilimi ve UTC ofseti.
 *
 * Alarmlar mutlak an olarak (`Schedule.at`) kurulduğu için yurtdışına çıkıldığında
 * ya da cihaz saati elle değiştirildiğinde hepsi eski yerel saatte çalıyordu.
 * Bu bilgi imzaya girer; değişince bir sonraki senkronizasyon yeniden planlar.
 */
export function currentTimeZoneSignature(now: Date): string {
  let zone = "bilinmiyor";
  try {
    zone = Intl.DateTimeFormat().resolvedOptions().timeZone || zone;
  } catch {
    // timeZone yoksa aşağıdaki ofset yine de yakalar.
  }
  return `${zone}@${-now.getTimezoneOffset()}`;
}

/**
 * Senkronizasyon imzası — saf.
 *
 * Aynıysa 14 bildirim boş yere yeniden kurulmuyor. Saat dilimi de içinde:
 * cihaz saati değişince imza değişir ve alarmlar yeniden planlanır.
 */
export function buildSignature({
  enabled,
  time,
  today,
  filledToday,
  timeZone,
}: {
  enabled: boolean;
  time: string;
  today: string;
  filledToday: boolean;
  timeZone: string;
}): string {
  return `${enabled}|${time}|${today}|${filledToday}|${timeZone}`;
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
 * En son BAŞARILI kurulumun imzası.
 * Puantaj her değiştiğinde senkronizasyon çağrılıyor; imza aynıysa 14 bildirim
 * boş yere yeniden kurulmuyor.
 *
 * KRİTİK: imza yalnızca kurulum tamamen bitince yazılır. Kurulum başarısız
 * olursa sıfırlanır, böylece bir sonraki çağrıda yeniden denenir — önceden
 * yazılırsa kullanıcı sonradan bildirim iznini açsa bile hatırlatma hiç
 * kurulmaz kalıyordu.
 */
let lastSignature: string | null = null;

/** Testler ve zorunlu yeniden kurulum için imzayı sıfırlar. */
export const resetReminderSync = (): void => {
  lastSignature = null;
};

export type ReminderSyncResult =
  /** Zaten doğru kurulmuş — hiçbir şey yapılmadı. */
  | "değişiklik-yok"
  /** Hatırlatma ayarı kapalı; bekleyen bildirimler temizlendi. */
  | "kapalı"
  /** Bildirimler kuruldu. */
  | "kuruldu"
  /** Masaüstü: eklenti zamanlanmış bildirimi desteklemiyor. */
  | "masaustu-desteklenmiyor"
  /** İzin kesin olarak reddedilmiş; kurulum denenmedi. */
  | "izin-yok"
  /** Beklenmedik hata; imza sıfırlandı, sonraki çağrıda tekrar denenecek. */
  | "hata";

/**
 * Bekleyen tüm hatırlatmaları iptal edip yeniden kurar.
 * Açılışta, ayar değişiminde ve puantaj yazımından sonra çağrılır.
 *
 * Dönüş değeri yalnızca bilgilendirme amaçlıdır (ayarlar ekranı ve hook
 * kullanıcıya doğru mesajı göstermek için); senkronizasyon asla patlamaz.
 */
export async function syncReminders(): Promise<ReminderSyncResult> {
  try {
    // Masaüstünde eklentinin zamanlama/iptal komutları yok; hiç denemiyoruz.
    if (!isMobile()) return "masaustu-desteklenmiyor";

    const { enabled, time } = useReminderStore.getState();
    const now = new Date();
    const today = todayKey();
    const filled = enabled ? await hasAttendanceToday() : false;

    const signature = buildSignature({
      enabled,
      time,
      today,
      filledToday: filled,
      timeZone: currentTimeZoneSignature(now),
    });
    if (signature === lastSignature) return "değişiklik-yok";

    const { cancel, registerActionTypes, sendNotification, Schedule } =
      await import("@tauri-apps/plugin-notification");

    // `cancelAll()` KULLANILMIYOR: Android eklentisinde `notifications` alanı
    // zorunlu, cancelAll ise onu hiç göndermiyor; çağrı hata veriyor.
    // Kendi kimlik aralığımızı açıkça iptal etmek hem çalışıyor hem de başka
    // bildirimlere dokunmuyor. (Masaüstüde bu komut hiç çağrılmıyor.)
    await cancel(REMINDER_IDS);

    if (!enabled) {
      lastSignature = signature;
      return "kapalı";
    }

    // Yalnızca kesin olarak reddedilmişse vazgeçilir; belirsiz durumda kurulur.
    if ((await permissionState()) === false) {
      // İmza YAZILMAZ: kullanıcı izni sonradan açarsa bir sonraki çağrıda
      // kurulum yeniden denenir.
      lastSignature = null;
      return "izin-yok";
    }

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
      now,
    })) {
      sendNotification({
        id,
        title: "Puantaj hatırlatması",
        body: isToday ? "Bugünün puantajı henüz girilmedi." : "Günün puantajını girmeyi unutmayın.",
        actionTypeId: REMINDER_ACTION_TYPE,
        schedule: Schedule.at(fireAt, false, true),
      });
    }

    lastSignature = signature;
    return "kuruldu";
  } catch (err: unknown) {
    // Hatırlatma bir kolaylık; kurulamaması uygulamanın çalışmasını engellemez.
    // İmza sıfırlanır ki sonraki çağrıda tekrar denensin.
    lastSignature = null;
    reportError(err instanceof Error ? err : new Error(String(err)), { scope: "reminder-sync" });
    return "hata";
  }
}
