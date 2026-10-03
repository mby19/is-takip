import { describe, it, expect } from "vitest";
import { formatMoney } from "../lib/utils";
import { formatCsvMoney } from "../lib/csvExport";

/**
 * `formatMoney` ekrandaki her tutarın tek kaynağı: bileşenler, denetim
 * günlüğü ve takvim sayaçları buradan geçer. Buradaki beklentiler o yüzden
 * bir kopyanın değil, uygulamanın para gösteriminin kendisidir.
 */
describe("formatMoney", () => {
  it("binlik ayracı Türkçe yazar ve ₺ öneki koyar", () => {
    expect(formatMoney(1250)).toBe("₺1.250");
    expect(formatMoney(1234567)).toBe("₺1.234.567");
    expect(formatMoney(0)).toBe("₺0");
  });

  it("kuruşu yuvarlar — 1250,4 ve 1250,6 aynı görünür", () => {
    expect(formatMoney(1250.4)).toBe("₺1.250");
    expect(formatMoney(1250.6)).toBe("₺1.251");
  });

  it("negatif bakiyeyi eksi çeviriyle gösterir", () => {
    expect(formatMoney(-4600.2)).toBe("₺-4.600");
  });

  it("eksik alanı sıfır sayar, bozuk sayıyı em-dash yapar", () => {
    expect(formatMoney(null)).toBe("₺0");
    expect(formatMoney(undefined)).toBe("₺0");
    expect(formatMoney("")).toBe("₺0");
    expect(formatMoney("abc")).toBe("—");
    expect(formatMoney(Number.NaN)).toBe("—");
    expect(formatMoney(Number.POSITIVE_INFINITY)).toBe("—");
  });

  it("SQLite'ın sayı olarak döndürdüğü metni de kabul eder", () => {
    // Denetim kaydı `new_data` JSON'undan gelir: tutar orada metindir.
    expect(formatMoney("1250.6")).toBe("₺1.251");
  });
});

describe("ekran ve CSV para biçimi ayrımı", () => {
  it("ekran biçimi her zaman simgeli ve ondalıksız", () => {
    // Yanlışlıkla CSV biçimi ekrana girerse hücre metin olur ve para
    // görünmez; tersi durumda tablo hücresi sayı olmaktan çıkar.
    //
    // tr-TR'de ondalık ayracı `,`, binlik ayracı `.` — bu yüzden "kuruş
    // yok" denetimi `,` yokluğudur; kalan `.`ler binlik ayracıdır.
    for (const n of [0, 1, 1234.5, -99.99]) {
      const shown = formatMoney(n);
      expect(shown.startsWith("₺")).toBe(true);
      expect(shown).not.toContain(",");
      expect(shown.slice(1).replace(/\./g, "")).toMatch(/^-?\d+$/);
    }
  });

  it("CSV biçimi simgesiz ve kuruşlu", () => {
    for (const n of [0, 1, 1234.5, -99.99]) {
      const cell = formatCsvMoney(n);
      expect(cell).not.toContain("₺");
      expect(cell).toContain(".");
      expect(cell.split(".")[1]).toHaveLength(2);
    }
  });

  it("ikisi aynı girdide aynı çıktıyı vermez", () => {
    expect(formatMoney(1234.5)).not.toBe(formatCsvMoney(1234.5));
  });
});
