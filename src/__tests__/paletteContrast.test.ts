import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { PALETTE_KEYS, PALETTE_NAMES, PALETTE_PREVIEW } from "../stores/themeStore";

const CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), "../index.css");
const CSS = readFileSync(CSS_PATH, "utf8");

/**
 * CSS'i tarayıcı olmadan çözümler: `[data-palette="x"]` ve `.dark` bloklarındaki
 * özel değişkenleri sözlüğe alır. Değişkenler hsl() veya var() referansı
 * olabilir; var() zinciri çözülür.
 */
type Vars = Record<string, string>;

const parseVars = (body: string): Vars =>
  Object.fromEntries(
    [...body.matchAll(/--([a-z-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]),
  );

const paletteVars: Record<string, { light: Vars; dark: Vars }> = (() => {
  const dark: Record<string, Vars> = {};
  for (const m of CSS.matchAll(/\[data-palette="([a-z]+)"\]\.dark\s*\{([^}]*)\}/g)) {
    dark[m[1]] = parseVars(m[2]);
  }
  const light: Record<string, Vars> = {};
  for (const m of CSS.matchAll(/\[data-palette="([a-z]+)"\](?!\.dark)\s*\{([^}]*)\}/g)) {
    light[m[1]] = parseVars(m[2]);
  }
  const entries: [string, { light: Vars; dark: Vars }][] = Object.keys(dark).map((k) => [
    k,
    { light: light[k] ?? {}, dark: dark[k] },
  ]);
  return Object.fromEntries(entries);
})();

const baseVars: { light: Vars; dark: Vars } = (() => {
  const light: Vars = {};
  const dark: Vars = {};
  for (const m of CSS.matchAll(/(^|\s):root\s*\{([^}]*)\}/g)) {
    Object.assign(light, parseVars(m[2]));
  }
  for (const m of CSS.matchAll(/(^|\s)\.dark\s*\{([^}]*)\}/g)) {
    Object.assign(dark, parseVars(m[2]));
  }
  return { light, dark };
})();

/** var(--x) referanslarını, tanımlandığı yerde arayarak düz renge indirger. */
const resolveValue = (key: string, scope: Vars, mode: "light" | "dark"): string => {
  let current = (scope[key] ?? baseVars[mode][key] ?? key).trim();
  for (let i = 0; i < 10; i++) {
    const ref = current.match(/^var\(--([a-z-]+)\)$/);
    if (!ref) break;
    const key = ref[1];
    const next = scope[key] ?? baseVars[mode][key];
    if (next === undefined) return current;
    current = next;
  }
  return current;
};

const hslToRgb = (h: number, s: number, l: number): [number, number, number] => {
  const sat = s / 100;
  const li = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(li, 1 - li);
  const f = (n: number) => li - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
};

const toRgb = (value: string): [number, number, number] => {
  const m = value.match(/hsl\(\s*([\d.]+)\s+([\d.]+)%\s+([\d.]+)%/);
  if (!m) throw new Error(`Ölçülemeyen renk: ${value}`);
  return hslToRgb(Number(m[1]), Number(m[2]), Number(m[3]));
};

const relativeLuminance = ([r, g, b]: [number, number, number]): number => {
  const lin = [r, g, b].map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
};

/** WCAG 2.x oranı: (L1 + 0.05) / (L2 + 0.05) */
const contrast = (fg: string, bg: string, scope: Vars, mode: "light" | "dark"): number => {
  const a = relativeLuminance(toRgb(resolveValue(fg, scope, mode)));
  const b = relativeLuminance(toRgb(resolveValue(bg, scope, mode)));
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
};

/** Ölçülen çiftler: gövde metni, buton dolguları, durum renkleri, kenarlık. */
const TEXT_PAIRS: [string, string, string][] = [
  ["gövde metni / zemin", "foreground", "background"],
  ["kart metni / kart", "card-foreground", "card"],
  ["popover metni / popover", "popover-foreground", "popover"],
  ["primary buton yazısı / dolgu", "primary-foreground", "primary"],
  ["ikincil dolgu metni", "secondary-foreground", "secondary"],
  ["accent dolgu metni", "accent-foreground", "accent"],
  ["muted metni / zemin", "muted-foreground", "background"],
  ["muted metni / kart", "muted-foreground", "card"],
  ["destructive buton yazısı", "destructive-foreground", "destructive"],
  ["ok / zemin", "ok", "background"],
  ["warn / zemin", "warn", "background"],
  ["bad / zemin", "bad", "background"],
  ["info / zemin", "info", "background"],
  ["ok yazısı / ok dolgusu", "on-ok", "ok"],
  ["warn yazısı / warn dolgusu", "on-warn", "warn"],
  ["bad yazısı / bad dolgusu", "on-bad", "bad"],
  ["info yazısı / info dolgusu", "on-info", "info"],
  ["ok / ok-soft", "ok", "ok-soft"],
  ["warn / warn-soft", "warn", "warn-soft"],
  ["bad / bad-soft", "bad", "bad-soft"],
  ["info / info-soft", "info", "info-soft"],
];

/** Grafik/kenarlık çiftleri — WCAG AA büyük metin eşiği 3:1. */
const GRAPHIC_PAIRS: [string, string, string][] = [
  ["kenarlık / zemin", "border", "background"],
  ["kenarlık / kart", "border", "card"],
  ["primary / zemin", "primary", "background"],
  ["ok / zemin", "ok", "background"],
  ["bad / zemin", "bad", "background"],
];

const TEXT_MIN = 4.5;
const GRAPHIC_MIN = 3;

describe("saha (güneş modu) paleti", () => {
  it("themeStore'da kayıtlı ve adı görünür", () => {
    expect(PALETTE_KEYS).toContain("saha");
    expect(PALETTE_NAMES.saha).toBe("Saha (güneş)");
    expect(PALETTE_PREVIEW.saha).toEqual({ primary: "#072988", bg: "#ffffff" });
  });

  it("index.css'te hem açık hem koyu blok tanımlı", () => {
    expect(paletteVars.saha).toBeDefined();
    expect(paletteVars.saha.light.primary).toBeDefined();
    expect(paletteVars.saha.dark.primary).toBeDefined();
  });

  describe.each(["light", "dark"] as const)("%s modda", (mode) => {
    const scope = () => paletteVars.saha[mode];

    it.each(TEXT_PAIRS)("gövde metni eşiğini geçer: %s", (label, fg, bg) => {
      const ratio = contrast(fg, bg, scope(), mode);
      expect(ratio, `${label} → ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(TEXT_MIN);
    });

    it.each(GRAPHIC_PAIRS)("grafik eşiğini geçer: %s", (label, fg, bg) => {
      const ratio = contrast(fg, bg, scope(), mode);
      expect(ratio, `${label} → ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(GRAPHIC_MIN);
    });

    it("en düşük metin oranı 7:1'in üzerinde (güneş payı)", () => {
      const worst = Math.min(...TEXT_PAIRS.map(([, fg, bg]) => contrast(fg, bg, scope(), mode)));
      expect(worst).toBeGreaterThan(7);
    });
  });
});

describe("dokunma hedefi tabanı", () => {
  it("genişliği her cihazda 44px'te tutar", () => {
    const block = CSS.match(/\.tap-target\s*\{([^}]*)\}/);
    expect(block).not.toBeNull();
    expect(block?.[1]).toContain("min-width: 44px");
  });

  /**
   * Yükseklik tabanı BİLEREK dokunmatik cihazla sınırlı: fareyle masaüstünde
   * kullanıcının seçtiği "Sıkışık" satır yoğunluğu (34px) geçerli kalır.
   * Bu yüzden kuralın kendisi değil, kuralın NEREDE tanımlandığı ölçülür.
   */
  it("yüksekliği yalnızca dokunmatik cihazda 44px yapar", () => {
    const coarse = CSS.match(/@media\s*\(pointer:\s*coarse\)\s*\{([\s\S]*?)\n\s{2}\}/);
    expect(coarse).not.toBeNull();
    const tapTarget = coarse?.[1].match(/\.tap-target\s*\{([^}]*)\}/);
    expect(tapTarget?.[1]).toContain("min-height: 44px");
  });

  it("dokunma jestini kaydırmadan ayırır", () => {
    const block = CSS.match(/\.tap-target\s*\{([^}]*)\}/);
    // `manipulation` pan'ı YASAKLAMAZ; yalnızca çift dokunuşla yakınlaştırmayı
    // ve dokunma gecikmesini kaldırır. `none` olsaydı hücre kaydırılamazdı.
    expect(block?.[1]).toContain("touch-action: manipulation");
    expect(block?.[1]).not.toContain("touch-action: none");
  });

  it("yatay kaydırma kenarı tarayıcı geri gezinmesini tetiklemez", () => {
    const block = CSS.match(/\.h-scroll-touch\s*\{([^}]*)\}/);
    expect(block?.[1]).toContain("overscroll-behavior-x: contain");
    expect(block?.[1]).toContain("-webkit-overflow-scrolling: touch");
  });
});
