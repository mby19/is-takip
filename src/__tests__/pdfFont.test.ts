import { describe, expect, it } from "vitest";
import { PDF_FONT_WARNING, toWinAnsiText } from "../lib/pdfFont";

describe("toWinAnsiText", () => {
  it("cp1252'de glifi olan Türkçe harfleri olduğu gibi bırakır", () => {
    expect(toWinAnsiText("ÇÖÜçöü")).toEqual({ text: "ÇÖÜçöü", foldedCount: 0 });
  });

  it("cp1252 dışı Türkçe harfleri okunur karşılıklarına eşler ve sayar", () => {
    expect(toWinAnsiText("İşçi Şişli Mağaza Çağrı")).toEqual({
      text: "Isçi Sisli Magaza Çagri",
      foldedCount: 7,
    });
  });

  it("para birimi simgesini TL yapar", () => {
    expect(toWinAnsiText("₺1.500")).toEqual({ text: "TL1.500", foldedCount: 1 });
  });

  it("eşlemesi olmayan karakteri '?' ile değiştirir — bozuk bayt sızmaz", () => {
    expect(toWinAnsiText("aЯb")).toEqual({ text: "a?b", foldedCount: 1 });
  });

  it("cp1252'de noktalı İngilizce karakterleri korur", () => {
    expect(toWinAnsiText("Révue — 25 €")).toEqual({ text: "Révue — 25 €", foldedCount: 0 });
  });
});

describe("PDF_FONT_WARNING", () => {
  it("uyarının kendisi cp1252'de tamamen çizilebilir", () => {
    expect(toWinAnsiText(PDF_FONT_WARNING)).toEqual({ text: PDF_FONT_WARNING, foldedCount: 0 });
  });
});
