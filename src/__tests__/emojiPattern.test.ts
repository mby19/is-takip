import { describe, it, expect } from "vitest";
import {
  appendToPattern,
  appendToPin,
  emojiChar,
  isPatternComplete,
  matchesPattern,
  LOCK_EMOJIS,
  PATTERN_LENGTH,
  PIN_LENGTH,
} from "../utils/emojiPattern";

describe("appendToPattern", () => {
  it("deseni sırayla biriktirir", () => {
    let seq: string[] = [];
    for (const id of ["panda", "rocket", "diamond"]) {
      seq = appendToPattern(seq, id);
    }
    expect(seq).toEqual(["panda", "rocket", "diamond"]);
  });

  it("4. basışta en eskiyi düşürür, uzunluk 3'te kalır", () => {
    let seq: string[] = [];
    for (const id of ["panda", "rocket", "diamond", "crown"]) {
      seq = appendToPattern(seq, id);
    }
    expect(seq).toEqual(["rocket", "diamond", "crown"]);
    expect(seq).toHaveLength(PATTERN_LENGTH);
  });

  it("4 basış sonrası son 3'lü doğru desen olarak tanınır", () => {
    // LK2: kullanıcı 300ms penceresinde 4. emoji'ye basıp kilitlememeli.
    let seq: string[] = [];
    for (const id of ["panda", "rocket", "diamond", "crown"]) {
      seq = appendToPattern(seq, id);
    }
    expect(isPatternComplete(seq)).toBe(true);
    expect(matchesPattern(seq, ["rocket", "diamond", "crown"])).toBe(true);
  });

  it("5 ve daha fazla basışta da pencere taşmaz", () => {
    let seq: string[] = [];
    for (const id of ["panda", "rocket", "diamond", "crown", "pizza", "clover"]) {
      seq = appendToPattern(seq, id);
    }
    expect(seq).toEqual(["crown", "pizza", "clover"]);
  });
});

describe("isPatternComplete", () => {
  it("yalnızca tam uzunlukta true döner", () => {
    expect(isPatternComplete([])).toBe(false);
    expect(isPatternComplete(["panda"])).toBe(false);
    expect(isPatternComplete(["panda", "rocket"])).toBe(false);
    expect(isPatternComplete(["panda", "rocket", "diamond"])).toBe(true);
  });
});

describe("matchesPattern", () => {
  it("aynı sırada eşleşir", () => {
    expect(matchesPattern(["a", "b", "c"], ["a", "b", "c"])).toBe(true);
  });

  it("farklı sırada eşleşmez", () => {
    expect(matchesPattern(["a", "b", "c"], ["a", "c", "b"])).toBe(false);
  });

  it("uzunluk farklıysa asla eşleşmez", () => {
    // LK2 regresyonu: 4 elemanlı pencere 3'lü desenle karşılaştırılıyordu.
    expect(matchesPattern(["a", "b", "c", "d"], ["a", "b", "c"])).toBe(false);
    expect(matchesPattern(["a", "b", "c"], ["a", "b", "c", "d"])).toBe(false);
  });

  it("eksik basış eşleşmez", () => {
    expect(matchesPattern(["a", "b", "c"], ["a", "b"])).toBe(false);
  });
});

describe("appendToPin", () => {
  it("4 haneye kadar biriktirir", () => {
    let pin = "";
    for (const digit of ["1", "2", "3", "4"]) {
      pin = appendToPin(pin, digit);
    }
    expect(pin).toBe("1234");
  });

  it("5. basışı yok sayar", () => {
    expect(appendToPin("1234", "5")).toBe("1234");
    expect(appendToPin("1234", "5")).toHaveLength(PIN_LENGTH);
  });
});

describe("emojiChar", () => {
  it("bilinen id için karakter döndürür", () => {
    expect(emojiChar("panda")).toBe("🐼");
  });

  it("bilinmeyen veya eksik id için boş string döndürür", () => {
    expect(emojiChar("yok")).toBe("");
    expect(emojiChar(undefined)).toBe("");
  });

  it("katalogdaki her emoji id'si benzersiz", () => {
    expect(new Set(LOCK_EMOJIS.map((e) => e.id)).size).toBe(LOCK_EMOJIS.length);
  });
});
