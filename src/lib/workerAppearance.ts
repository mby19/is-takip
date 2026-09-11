import type { Worker } from "../types";

/**
 * Tabloda kişiyi ayırt etmek için renk paleti.
 *
 * Tek set kullanılır, temaya göre değişmez: bir kişinin rengi kimliğidir,
 * tema değiştirince değişirse amacını yitirir. Tonlar aynı parlaklık bandında
 * seçildi; hepsinin üzerinde aynı koyu mürekkep okunuyor (ölçüm: 5.7–9.7:1).
 */
export const WORKER_COLORS = {
  slate: "hsl(215 22% 62%)",
  blue: "hsl(205 70% 62%)",
  teal: "hsl(180 45% 55%)",
  green: "hsl(145 45% 58%)",
  lime: "hsl(80 50% 58%)",
  amber: "hsl(42 85% 62%)",
  orange: "hsl(22 80% 64%)",
  rose: "hsl(350 70% 68%)",
  violet: "hsl(270 55% 70%)",
} as const;

export type WorkerColorKey = keyof typeof WORKER_COLORS;

export const WORKER_COLOR_KEYS = Object.keys(WORKER_COLORS) as WorkerColorKey[];

export const WORKER_COLOR_NAMES: Record<WorkerColorKey, string> = {
  slate: "Kurşuni",
  blue: "Mavi",
  teal: "Turkuaz",
  green: "Yeşil",
  lime: "Fıstık",
  amber: "Kehribar",
  orange: "Turuncu",
  rose: "Gül",
  violet: "Mor",
};

/** Renkli rozetlerin üzerindeki yazı — her tonda okunur. */
export const WORKER_INK = "hsl(25 15% 12%)";

/** Kısa etiket en fazla bu kadar karakter olur; daha uzunu rozete sığmaz. */
export const SHORT_LABEL_MAX = 3;

/**
 * Kullanıcı renk seçmediyse id'den kararlı bir renk türetir.
 * Böylece hiçbir ayar yapılmadan da her sütun farklı görünür.
 */
export function resolveWorkerColor(worker: Pick<Worker, "id" | "color">): string {
  const key = worker.color as WorkerColorKey | null | undefined;
  if (key && key in WORKER_COLORS) return WORKER_COLORS[key];
  return WORKER_COLORS[WORKER_COLOR_KEYS[Math.abs(Number(worker.id)) % WORKER_COLOR_KEYS.length]];
}

/** Kullanıcının seçtiği renk anahtarı; yoksa otomatik atanan. */
export function resolveWorkerColorKey(worker: Pick<Worker, "id" | "color">): WorkerColorKey {
  const key = worker.color as WorkerColorKey | null | undefined;
  if (key && key in WORKER_COLORS) return key;
  return WORKER_COLOR_KEYS[Math.abs(Number(worker.id)) % WORKER_COLOR_KEYS.length];
}

export const normalizeShortLabel = (value: string): string =>
  value.trim().slice(0, SHORT_LABEL_MAX).toLocaleUpperCase("tr-TR");
