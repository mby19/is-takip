import { describe, it, expect } from "vitest";
import { compareTurkish, foldTurkish, matchesTurkish } from "../utils/turkishCollation";

const names = (...values: string[]) => [...values].sort(compareTurkish);

describe("Türkçe sıralama", () => {
  it("Ç, Ğ, I, Ö, Ş, Ü harflerini alfabetdeki yerine koyar", () => {
    // SQLite BINARY collation'da Ç/Ş/Ğ 'Z' ve 'z' sonrasına düşerdi.
    expect(names("Zeynep", "Çetin", "Ayşe")).toEqual(["Ayşe", "Çetin", "Zeynep"]);
    expect(names("Uğur", "Şahin", "Zeynep")).toEqual(["Şahin", "Uğur", "Zeynep"]);
    expect(names("Zeynep", "Ömer", "Ayşe")).toEqual(["Ayşe", "Ömer", "Zeynep"]);
    expect(names("Zeynep", "İbrahim", "Ayşe")).toEqual(["Ayşe", "İbrahim", "Zeynep"]);
  });

  it("Çetin C ile B arasında, Şahin S ile U arasında sıralanır", () => {
    const sorted = names("Berna", "Çetin", "Cemil", "Duran");
    // Çetin: C grubunda ama Cemil'den sonra. BINARY'da listenin sonunda olurdu.
    expect(sorted).toEqual(["Berna", "Cemil", "Çetin", "Duran"]);
    expect(sorted.indexOf("Çetin")).toBeLessThan(sorted.indexOf("Duran"));
    expect(sorted.indexOf("Çetin")).toBeGreaterThan(sorted.indexOf("Berna"));

    const sahin = names("Selim", "Şahin", "Uğur");
    expect(sahin).toEqual(["Selim", "Şahin", "Uğur"]);
  });

  it("büyük/küçük harf karışınca da alfabet sırasını korur", () => {
    expect(names("zeynep", "AYŞE", "çetin", "Berna")).toEqual(["AYŞE", "Berna", "çetin", "zeynep"]);
  });

  it("aksanlı harfleri komşu harfin yanına koyar", () => {
    // Türkçe alfabede é/ö/ü yok; aksan farkı sıralamayı bozmamalı.
    expect(names("Zeynep", "José")).toEqual(["José", "Zeynep"]);
    expect(names("Zeynep", "Bjørn")).toEqual(["Bjørn", "Zeynep"]);
  });

  it("Norveççe Å gibi Türkçe olmayan harfler sıralamayı bozmaz", () => {
    const sorted = names("Åsa", "Çetin", "Zeynep", "Ali");
    // Å, A'nın arkasına düşer; Z'nin ÖNÜNE geçmemeli.
    expect(sorted.indexOf("Ali")).toBeLessThan(sorted.indexOf("Åsa"));
    expect(sorted.indexOf("Åsa")).toBeLessThan(sorted.indexOf("Çetin"));
    expect(sorted.indexOf("Çetin")).toBeLessThan(sorted.indexOf("Zeynep"));
  });

  it("isim içindeki sayıları doğru dizer", () => {
    expect(names("K10", "K2")).toEqual(["K2", "K10"]);
  });

  it("tam eşitlikte 0 döner, kalan durumlarda işaret döner", () => {
    expect(compareTurkish("Çetin", "Çetin")).toBe(0);
    expect(compareTurkish("Ali", "Ayşe")).toBeLessThan(0);
    expect(compareTurkish("Zeynep", "Ali")).toBeGreaterThan(0);
    // `ç` Türkçe alfabede `c`den SONRA gelen ayrı bir harftır: aksan
    // duyarsızlık `c`/`ç`yi eşitlemez, yoksa "Selim" < "Şahin" kaybolurdu.
    expect(compareTurkish("Cetin", "Çetin")).toBeLessThan(0);
  });
});

describe("arama normalizasyonu", () => {
  it("büyük/küçük harf ve aksan duyarsız", () => {
    expect(foldTurkish("Mehmet")).toBe("mehmet");
    expect(foldTurkish("Şahin")).toBe("sahin");
    expect(foldTurkish("Çetin")).toBe("cetin");
    expect(foldTurkish("Işık")).toBe("isik");
    expect(foldTurkish("Gökçe")).toBe("gokce");
    expect(foldTurkish("José")).toBe("jose");
  });

  it("Türkçe harf yazmadan ismi bulur", () => {
    expect(matchesTurkish(["Şahin"], "sahin")).toBe(true);
    expect(matchesTurkish(["Şahin"], "SAHİN")).toBe(true);
    expect(matchesTurkish(["Çetin Yılmaz"], "yilmaz")).toBe(true);
    expect(matchesTurkish(["Çetin Yılmaz"], "cetiny")).toBe(false);
  });

  it("kısa etiket üzerinde de arar", () => {
    expect(matchesTurkish(["Ahmet Yılmaz", "AY"], "ay")).toBe(true);
    expect(matchesTurkish(["Ahmet Yılmaz", "ME"], "me")).toBe(true);
    expect(matchesTurkish(["Ahmet Yılmaz", null], "ay")).toBe(false);
  });

  it("birden çok alandan birinde tutunca eşleşir", () => {
    expect(matchesTurkish(["Ahmet", "MK"], "mk")).toBe(true);
  });

  it("eşleşmeyen ve boş sorgu", () => {
    expect(matchesTurkish(["Ayşe"], "mehmet")).toBe(false);
    // Arama kapalıyken filtre tüm listeyi geçirmeli, boş dönmemeli.
    expect(matchesTurkish(["Ayşe"], "")).toBe(true);
    expect(matchesTurkish(["Ayşe"], "   ")).toBe(true);
    expect(matchesTurkish([], "")).toBe(true);
    expect(matchesTurkish([null, undefined, ""], "a")).toBe(false);
  });
});
