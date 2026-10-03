import { create } from "zustand";

export type ThemePalette =
  | "ocean"
  | "forest"
  | "sunset"
  | "mono"
  | "midnight"
  | "graphite"
  | "plum"
  | "mint"
  | "saha";

export const PALETTE_NAMES: Record<ThemePalette, string> = {
  ocean: "Okyanus",
  forest: "Orman",
  sunset: "Günbatımı",
  mono: "Tek Renk",
  midnight: "Gece Yarısı",
  graphite: "Grafit",
  plum: "Erik",
  mint: "Nane",
  saha: "Saha (güneş)",
};

export const PALETTE_PREVIEW: Record<ThemePalette, { primary: string; bg: string }> = {
  ocean: { primary: "#47a3d6", bg: "#f6f3ef" },
  forest: { primary: "#4db36d", bg: "#f4f4ed" },
  sunset: { primary: "#e8973b", bg: "#f6f0ec" },
  mono: { primary: "#a0a4af", bg: "#fafafa" },
  midnight: { primary: "#8b6ee0", bg: "#f5f6fa" },
  graphite: { primary: "#1f6fb8", bg: "#f7f8fa" },
  plum: { primary: "#a52a63", bg: "#faf6f9" },
  mint: { primary: "#177a63", bg: "#f5f9fa" },
  saha: { primary: "#072988", bg: "#ffffff" },
};

export const PALETTE_KEYS = Object.keys(PALETTE_NAMES) as ThemePalette[];

export type ThemeMode = "light" | "dark";

/**
 * Varsayılan tema koyu.
 * Uygulama sahada, çoğunlukla düşük ışıkta ve uzun süre açık kalarak
 * kullanılıyor; cihaz tercihi ne olursa olsun koyu tema ile açılır.
 * Kullanıcı bir kez seçim yaptıysa o seçim korunur.
 */
export const DEFAULT_MODE: ThemeMode = "dark";
export const DEFAULT_PALETTE: ThemePalette = "ocean";

/**
 * Kalıcı anahtarlar. Şema sürümlüdür: okuma/kural tek yerde toplanır,
 * anahtar biçimi değişirse eskisi çalışmaz ama tanımlı şekilde öne geçer.
 */
const MODE_KEY = "is-takip:theme:mode:v1";
const PALETTE_KEY = "is-takip:theme:palette:v1";

/** Sürümlendirmeden önce yazılmış anahtarlar — seçim kaybolmasın diye taşınır. */
const LEGACY_MODE_KEY = "theme-mode";
const LEGACY_PALETTE_KEY = "theme-palette";

/** Geçersiz/eksik değerler varsayılana düşer; kayıtlı ayar hiç bozulmaz. */
export const normalizeThemeMode = (value: string | null | undefined): ThemeMode =>
  value === "light" || value === "dark" ? value : DEFAULT_MODE;

/** Geçersiz/eksik değerler varsayılana düşer; kayıtlı ayar hiç bozulmaz. */
export const normalizeThemePalette = (value: string | null | undefined): ThemePalette =>
  PALETTE_KEYS.includes((value ?? "") as ThemePalette) ? (value as ThemePalette) : DEFAULT_PALETTE;

/**
 * localStorage erişilemeyen ortamda (gizli mod, kısıtlı webview) ayar okuma ve
 * yazma işlemlerini yutar. `create()` gövdesi modül import anında çalıştığı
 * için korumasız bir `localStorage.getItem` tüm uygulamayı çökertirdi.
 */
const read = <T>(fn: () => T, fallback: T): T => {
  try {
    return fn();
  } catch {
    return fallback;
  }
};

const persist = (key: string, value: string): void => {
  read(() => localStorage.setItem(key, value), undefined);
};

const loadMode = (): ThemeMode => {
  const stored = read(() => localStorage.getItem(MODE_KEY), null);
  if (stored !== null) return normalizeThemeMode(stored);

  const legacy = read(() => localStorage.getItem(LEGACY_MODE_KEY), null);
  if (legacy === null) return DEFAULT_MODE;

  const migrated = normalizeThemeMode(legacy);
  persist(MODE_KEY, migrated);
  return migrated;
};

const loadPalette = (): ThemePalette => {
  const stored = read(() => localStorage.getItem(PALETTE_KEY), null);
  if (stored !== null) return normalizeThemePalette(stored);

  const legacy = read(() => localStorage.getItem(LEGACY_PALETTE_KEY), null);
  if (legacy === null) return DEFAULT_PALETTE;

  const migrated = normalizeThemePalette(legacy);
  persist(PALETTE_KEY, migrated);
  return migrated;
};

interface ThemeStore {
  mode: ThemeMode;
  palette: ThemePalette;
  setMode: (mode: ThemeMode) => void;
  toggleMode: () => void;
  setPalette: (palette: ThemePalette) => void;
}

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: loadMode(),
  palette: loadPalette(),

  setMode: (mode) => {
    persist(MODE_KEY, mode);
    set({ mode });
  },

  toggleMode: () =>
    set((state) => {
      const mode = state.mode === "light" ? "dark" : "light";
      persist(MODE_KEY, mode);
      return { mode };
    }),

  setPalette: (palette) => {
    persist(PALETTE_KEY, palette);
    set({ palette });
  },
}));
