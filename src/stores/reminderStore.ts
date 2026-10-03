import { create } from "zustand";

/**
 * Günlük hatırlatma ayarı.
 *
 * localStorage'da tutulur (veritabanı yedeğine girmesi anlamsız — cihaza özel
 * bir tercih), ama ayar ekranının ve zamanlamanın aynı anda tepki verebilmesi
 * için store üzerinden okunur.
 */

const ENABLED_KEY = "reminder-enabled";
const TIME_KEY = "reminder-time";

export const DEFAULT_REMINDER_TIME = "18:00";

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Yalnızca okuma yolunda kullanılır: localStorage'daki bozuk/eksik değer
 * varsayılana döner. Yazma yolunda (setTime) geçersiz girdi reddedilir —
 * kullanıcının geçici olarak geçersiz yazdığı saat kalıcı olarak 18:00'e
 * dönüşüyordu.
 */
export const normalizeReminderTime = (value: string | null | undefined): string =>
  TIME_PATTERN.test(value ?? "") ? (value as string) : DEFAULT_REMINDER_TIME;

/** Geçersiz saat girdisi — kullanıcıya gösterilecek mesajla birlikte. */
export const INVALID_TIME_MESSAGE = "Geçerli bir saat gir (SS:DD). Ayar değiştirilmedi.";

const read = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    // localStorage erişilemezse (gizli mod, kısıtlı webview) ayar kapalı sayılır.
    return fallback;
  }
};

interface ReminderState {
  enabled: boolean;
  time: string;
  setEnabled: (enabled: boolean) => void;
  setTime: (time: string) => boolean;
}

export const useReminderStore = create<ReminderState>((set) => ({
  enabled: read(() => localStorage.getItem(ENABLED_KEY) === "true", false),
  time: read(() => normalizeReminderTime(localStorage.getItem(TIME_KEY)), DEFAULT_REMINDER_TIME),

  setEnabled: (enabled) => {
    read(() => localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false"), undefined);
    set({ enabled });
  },

  /**
   * Geçersiz girdi reddedilir: eski değer korunur ve `false` döner, çağıran
   * kullanıcıya bildirir. Sessizce varsayılana yazmak, kullanıcının seçtiği
   * saati onaylamasına rağmen başka bir saatte hatırlatma kurulmasına yol
   * açıyordu.
   */
  setTime: (time) => {
    if (!TIME_PATTERN.test(time)) return false;
    read(() => localStorage.setItem(TIME_KEY, time), undefined);
    set({ time });
    return true;
  },
}));
