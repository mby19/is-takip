import { create } from "zustand";

export type ThemePalette = "ocean" | "forest" | "sunset" | "mono" | "midnight";

export const PALETTE_NAMES: Record<ThemePalette, string> = {
  ocean: "Okyanus",
  forest: "Orman",
  sunset: "Günbatımı",
  mono: "Tek Renk",
  midnight: "Gece Yarısı",
};

export const PALETTE_PREVIEW: Record<ThemePalette, { primary: string; bg: string }> = {
  ocean: { primary: "#47a3d6", bg: "#f6f3ef" },
  forest: { primary: "#4db36d", bg: "#f4f4ed" },
  sunset: { primary: "#e8973b", bg: "#f6f0ec" },
  mono: { primary: "#a0a4af", bg: "#fafafa" },
  midnight: { primary: "#8b6ee0", bg: "#f5f6fa" },
};

interface ThemeStore {
  mode: "light" | "dark";
  palette: ThemePalette;
  setMode: (mode: "light" | "dark") => void;
  toggleMode: () => void;
  setPalette: (palette: ThemePalette) => void;
}

/**
 * Varsayılan tema koyu.
 * Uygulama sahada, çoğunlukla düşük ışıkta ve uzun süre açık kalarak
 * kullanılıyor; cihaz tercihi ne olursa olsun koyu tema ile açılır.
 * Kullanıcı bir kez seçim yaptıysa o seçim korunur.
 */
const getInitialMode = (): "light" | "dark" => {
  const stored = localStorage.getItem("theme-mode");
  return stored === "light" ? "light" : "dark";
};

const getInitialPalette = (): ThemePalette => {
  const stored = localStorage.getItem("theme-palette");
  if (["ocean", "forest", "sunset", "mono", "midnight"].includes(stored || "")) {
    return stored as ThemePalette;
  }
  return "ocean";
};

export const useThemeStore = create<ThemeStore>((set) => ({
  mode: getInitialMode(),
  palette: getInitialPalette(),
  setMode: (mode) => {
    localStorage.setItem("theme-mode", mode);
    set({ mode });
  },
  toggleMode: () =>
    set((state) => {
      const mode = state.mode === "light" ? "dark" : "light";
      localStorage.setItem("theme-mode", mode);
      return { mode };
    }),
  setPalette: (palette) => {
    localStorage.setItem("theme-palette", palette);
    set({ palette });
  },
}));
