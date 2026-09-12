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

/** Geçersiz/eksik değerler varsayılana düşer; kayıtlı ayar hiç bozulmaz. */
export const normalizeReminderTime = (value: string | null | undefined): string =>
  TIME_PATTERN.test(value ?? "") ? (value as string) : DEFAULT_REMINDER_TIME;

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
  setTime: (time: string) => void;
}

export const useReminderStore = create<ReminderState>((set) => ({
  enabled: read(() => localStorage.getItem(ENABLED_KEY) === "true", false),
  time: read(() => normalizeReminderTime(localStorage.getItem(TIME_KEY)), DEFAULT_REMINDER_TIME),

  setEnabled: (enabled) => {
    read(() => localStorage.setItem(ENABLED_KEY, enabled ? "true" : "false"), undefined);
    set({ enabled });
  },

  setTime: (time) => {
    const normalized = normalizeReminderTime(time);
    read(() => localStorage.setItem(TIME_KEY, normalized), undefined);
    set({ time: normalized });
  },
}));
