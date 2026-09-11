import { describe, it, expect } from "vitest";
import { workerInitials } from "../utils/initials";
import type { Worker } from "../types";

const w = (id: number, name: string): Worker => ({
  id,
  name,
  daily_wage: 0,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
});

describe("workerInitials", () => {
  it("çakışma yoksa tek harf kullanır", () => {
    const map = workerInitials([w(1, "Ahmet Yılmaz"), w(2, "Bekir Kaya")]);
    expect(map.get(1)).toBe("A");
    expect(map.get(2)).toBe("B");
  });

  it("aynı harfle başlayan isimleri soyadıyla ayırır", () => {
    const map = workerInitials([w(1, "Mehmet Demir"), w(2, "Murat Kaya")]);
    expect(map.get(1)).toBe("M");
    expect(map.get(2)).toBe("MK");
    expect(map.get(1)).not.toBe(map.get(2));
  });

  it("aynı soyadı harfi de çakışırsa ada genişler", () => {
    const map = workerInitials([w(1, "Mehmet Demir"), w(2, "Murat Demir"), w(3, "Metin Demir")]);
    const values = [map.get(1), map.get(2), map.get(3)];
    expect(new Set(values).size).toBe(3);
  });

  it("tamamen aynı isimlerde sıra numarası ekler", () => {
    const map = workerInitials([w(1, "Ali Veli"), w(2, "Ali Veli")]);
    expect(map.get(1)).not.toBe(map.get(2));
    expect(new Set([map.get(1), map.get(2)]).size).toBe(2);
  });

  it("altı kişilik ekipte hepsi benzersiz", () => {
    const team = [
      w(1, "Ahmet Yılmaz"),
      w(2, "Ayşe Yıldız"),
      w(3, "Ali Yalçın"),
      w(4, "Mehmet Demir"),
      w(5, "Murat Kaya"),
      w(6, "Hasan Çelik"),
    ];
    const map = workerInitials(team);
    expect(new Set(map.values()).size).toBe(6);
  });

  it("Türkçe harfleri doğru büyütür", () => {
    const map = workerInitials([w(1, "İbrahim Şahin"), w(2, "ırmak Öz")]);
    expect(map.get(1)).toBe("İ");
    expect(map.get(2)).toBe("I");
  });

  it("tek kelimelik ismi tek harfle gösterir", () => {
    expect(workerInitials([w(1, "Ahmet")]).get(1)).toBe("A");
  });

  it("boş ismi çökmeden karşılar", () => {
    expect(workerInitials([w(1, "   ")]).get(1)).toBe("?");
  });
});
