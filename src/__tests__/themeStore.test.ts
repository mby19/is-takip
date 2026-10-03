import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { normalizeThemeMode, normalizeThemePalette } from "../stores/themeStore";

/** Ayar testleri için basit bir taklit — jsdom localStorage sağlamıyor. */
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
};

/** Gizli mod / kısıtlı webview taklidi: her erişim patlar. */
const blockedStorage = () => {
  const deny = () => {
    throw new Error("localStorage erişilemiyor");
  };
  return {
    getItem: deny,
    setItem: deny,
    removeItem: deny,
    clear: deny,
    key: deny,
    get length(): number {
      return deny();
    },
  } as unknown as Storage;
};

/** Tema store'u import anında localStorage okur; her senaryoda taze modül gerekir. */
const loadThemeStore = async () => {
  vi.resetModules();
  return import("../stores/themeStore");
};

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("localStorage erişilemeyen ortam", () => {
  it("import uygulamayı çökertmez, varsayılan temayla açılır", async () => {
    vi.stubGlobal("localStorage", blockedStorage());

    const { useThemeStore, DEFAULT_MODE, DEFAULT_PALETTE } = await loadThemeStore();

    expect(useThemeStore.getState().mode).toBe(DEFAULT_MODE);
    expect(useThemeStore.getState().palette).toBe(DEFAULT_PALETTE);
  });

  it("ayar değiştirme de çökmez, yalnızca kaydedilmez", async () => {
    vi.stubGlobal("localStorage", blockedStorage());
    const { useThemeStore } = await loadThemeStore();

    expect(() => useThemeStore.getState().setMode("light")).not.toThrow();
    expect(useThemeStore.getState().mode).toBe("light");
    expect(() => useThemeStore.getState().toggleMode()).not.toThrow();
    expect(useThemeStore.getState().mode).toBe("dark");
    expect(() => useThemeStore.getState().setPalette("mint")).not.toThrow();
    expect(useThemeStore.getState().palette).toBe("mint");
  });
});

describe("tema anahtarları", () => {
  it("sürümlü, şemalı anahtarlara yazar", async () => {
    const { useThemeStore } = await loadThemeStore();

    useThemeStore.getState().setMode("light");
    useThemeStore.getState().setPalette("plum");

    expect(localStorage.getItem("is-takip:theme:mode:v1")).toBe("light");
    expect(localStorage.getItem("is-takip:theme:palette:v1")).toBe("plum");
  });

  it("okunan değerleri sürümlü anahtardan geri yükler", async () => {
    localStorage.setItem("is-takip:theme:mode:v1", "light");
    localStorage.setItem("is-takip:theme:palette:v1", "forest");

    const { useThemeStore } = await loadThemeStore();

    expect(useThemeStore.getState().mode).toBe("light");
    expect(useThemeStore.getState().palette).toBe("forest");
  });

  it("sürümlendirme öncesi anahtarlardaki seçimi korur", async () => {
    localStorage.setItem("theme-mode", "light");
    localStorage.setItem("theme-palette", "sunset");

    const { useThemeStore } = await loadThemeStore();

    expect(useThemeStore.getState().mode).toBe("light");
    expect(useThemeStore.getState().palette).toBe("sunset");
    expect(localStorage.getItem("is-takip:theme:mode:v1")).toBe("light");
    expect(localStorage.getItem("is-takip:theme:palette:v1")).toBe("sunset");
  });

  it("sürümlü anahtar varsa eski anahtara dokunmaz", async () => {
    localStorage.setItem("is-takip:theme:mode:v1", "dark");
    localStorage.setItem("theme-mode", "light");

    const { useThemeStore } = await loadThemeStore();

    expect(useThemeStore.getState().mode).toBe("dark");
    expect(localStorage.getItem("theme-mode")).toBe("light");
  });
});

describe("tema değeri doğrulama", () => {
  it("yalnız light ve dark kabul eder", () => {
    expect(normalizeThemeMode("light")).toBe("light");
    expect(normalizeThemeMode("dark")).toBe("dark");
    expect(normalizeThemeMode("LIGHT")).toBe("dark");
    expect(normalizeThemeMode("true")).toBe("dark");
    expect(normalizeThemeMode(null)).toBe("dark");
    expect(normalizeThemeMode(undefined)).toBe("dark");
  });

  it("palet adı tanınmıyorsa varsayılana düşer", () => {
    expect(normalizeThemePalette("forest")).toBe("forest");
    expect(normalizeThemePalette("neon")).toBe("ocean");
    expect(normalizeThemePalette("")).toBe("ocean");
    expect(normalizeThemePalette(null)).toBe("ocean");
  });
});
