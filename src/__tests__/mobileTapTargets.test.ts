import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Saha kullanımı (telefon, parmak, eldiven) için 44px dokunma hedefi tabanı.
 * K13 aşama 2: `.tap-target` tek doğruluk kaynağı — bileşenlerde elle
 * `min-h-11` yazılmaz. Bu test, o alt navigasyon dışındaki ekranlarda
 * etkileşimli öğelerin ya `.tap-target` taşıdığını ya da açıkça ≥44px
 * yüksekliğe sahip olduğunu doğrular.
 */
const OWNED = [
  "components/WorkerDetailView.tsx",
  "components/MonthSummaryScreen.tsx",
  "components/SettingsView.tsx",
  "components/DayDetailSheet.tsx",
  "components/AuditLogView.tsx",
] as const;

/** Tailwind spacing ölçeği: h-11 = 2.75rem = 44px, REM bunu px'e çevirir. */
const REM = 4;

const sources = Object.fromEntries(
  [...OWNED, "App.tsx"].map((f) => [f, readFileSync(resolve(SRC, f), "utf8")]),
) as Record<(typeof OWNED)[number] | "App.tsx", string>;

describe("44px dokunma hedefi tabanı (K13 aşama 2)", () => {
  it.each(OWNED)("%s: etkileşimli öğeler ya .tap-target ya da ≥44px", (file) => {
    const source = sources[file];
    const offenders: string[] = [];

    for (const name of ["button", "Input", "input"]) {
      const re = new RegExp(`<${name}\\b([^>]*)>`, "g");
      let m: RegExpExecArray | null;
      while ((m = re.exec(source)) !== null) {
        const cls =
          /className=(?:"([^"]*)"|\{`([^`]*)`\}|\{"([^"]*)"\})/.exec(m[1])?.slice(1).join("") ?? "";
        // `.tap-target` varsa tek doğruluk kaynağı zaten devrede.
        if (/\btap-target\b/.test(cls)) continue;
        // Sabit yükseklik yoksa intrinsic içerik belirler — kanıtlanamaz, geç.
        const h = /(?:^|\s)h-(\d+(?:\.\d+)?)(?![\w-])/.exec(cls);
        if (h && Number(h[1]) * REM < 44) {
          const line = source.slice(0, m.index).split("\n").length;
          offenders.push(`${file}:${line} <${name}> "${cls}"`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  it("bileşenlerde elle boyut yazılmıyor — tek doğruluk kaynağı `.tap-target`", () => {
    for (const file of OWNED) {
      expect(sources[file].match(/min-h-\d+/g) ?? []).toEqual([]);
    }
  });
});

describe("masaüstü varsayımlarının kırılması (K13 aşama 2)", () => {
  it("sabit sütunlu günlük döküm yatay kaydırma sarmalayıcısı içinde", () => {
    // w-12 / w-20 sabit sütunları 360px'te taşmasın diye kaydırılabilir olmalı.
    expect(sources["components/WorkerDetailView.tsx"]).toMatch(
      /overflow-x-auto[^"]*"[^>]*>\s*<div className="min-w-/,
    );
  });

  it("renk ızgarası (9 sütun) 360px'e sığmıyor — yatay kaydırılabilir", () => {
    expect(sources["components/WorkerDetailView.tsx"]).toMatch(/grid-cols-9[\s\S]{0,400}w-max/);
  });

  it("sheet yüksekliği dinamik viewport kullanıyor (100vh geri düşmeli)", () => {
    expect(sources["components/DayDetailSheet.tsx"]).toMatch(/h-\[92vh\] h-\[92dvh\]/);
  });

  it("alt navigasyon düğmeleri de 44px tabanını taşıyor", () => {
    const app = sources["App.tsx"];
    expect(app.slice(app.indexOf('aria-label="Ana menü"'))).toMatch(/tap-target/);
  });

  it("etkileşimli öğe `<div onClick>` değil — hepsi gerçek buton", () => {
    for (const file of OWNED) {
      expect(sources[file]).not.toMatch(/<div[^>]*\bonClick=/);
    }
  });
});
