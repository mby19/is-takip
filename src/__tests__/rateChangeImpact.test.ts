import { describe, it, expect } from "vitest";

import {
  describeRateChangeImpact,
  periodsInRange,
  rateChangeImpact,
  type RateChangeImpactInput,
} from "../lib/rateChangeImpact";

const base = (over: Partial<RateChangeImpactInput> = {}): RateChangeImpactInput => ({
  effectiveFrom: "2026-05-01",
  today: "2026-10-02",
  earliestDataPeriod: "2026-01",
  closedPeriods: [],
  ...over,
});

describe("periodsInRange", () => {
  it("her iki ucu da dahil eder", () => {
    expect(periodsInRange("2026-11", "2027-02")).toEqual([
      "2026-11",
      "2026-12",
      "2027-01",
      "2027-02",
    ]);
  });

  it("ayrı yıl sınırında doğru ilerler", () => {
    expect(periodsInRange("2026-12", "2027-01")).toEqual(["2026-12", "2027-01"]);
  });

  it("from > to ise boş döner (sonsuz döngü olmaz)", () => {
    expect(periodsInRange("2026-05", "2026-04")).toEqual([]);
  });

  it("tek dönem aralığı tek eleman verir", () => {
    expect(periodsInRange("2026-05", "2026-05")).toEqual(["2026-05"]);
  });
});

describe("rateChangeImpact — güncel ve gelecek", () => {
  it("KİLİTLİ OLMAYAN bugünün ayında onay istemez", () => {
    // En sık kullanılan senaryo: ay ortası zam. Güncel ay kapalı değilse
    // geçmişte hesaplanan hakediş değişmiyor, onay diyaloğu yalnız yorar.
    const impact = rateChangeImpact(base({ effectiveFrom: "2026-10-12", today: "2026-10-02" }));
    expect(impact.requiresConfirmation).toBe(false);
    expect(impact.periods).toEqual([]);
    expect(describeRateChangeImpact(impact)).toBeNull();
  });

  it("bugünün ayı KAPALIYSA onay ister (kapalı döneme onaysız yazılamaz)", () => {
    // Güncel ay `PeriodLockSection`/`MonthSummaryScreen` ile kapatılabilir;
    // "güncel ay hiçbir zaman kilitli değildir" varsayımı yanlıştı.
    const impact = rateChangeImpact(
      base({ effectiveFrom: "2026-10-12", today: "2026-10-02", closedPeriods: ["2026-10"] }),
    );
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.closedPeriods).toEqual(["2026-10"]);
    expect(describeRateChangeImpact(impact)).toContain("kilitli olanlar: 2026-10");
  });

  it("ayın 1'i kilitliyse de onay ister", () => {
    expect(
      rateChangeImpact(base({ effectiveFrom: "2026-10-01", closedPeriods: ["2026-10"] }))
        .requiresConfirmation,
    ).toBe(true);
  });

  it("ayın 1'i de güncel ay sayılır — uyarı üretmez", () => {
    expect(rateChangeImpact(base({ effectiveFrom: "2026-10-01" })).requiresConfirmation).toBe(
      false,
    );
  });

  it("gelecek bir tarih uyarı üretmez", () => {
    const impact = rateChangeImpact(base({ effectiveFrom: "2026-11-15" }));
    expect(impact.requiresConfirmation).toBe(false);
    expect(describeRateChangeImpact(impact)).toBeNull();
  });

  it("veri hiç yoksa bile fail-closed: geçmişteki bir değişiklik onay ister", () => {
    // `earliestDataPeriod === null` "kesinlikle veri yok" demek DEĞİLDİR
    // (liste okunmamış da olabilir). Store'un `unknownImpact` davranışı ve
    // ekranın davranışı bu yüzden ayrışıyordu; tek kaynak fail-closed.
    const impact = rateChangeImpact(
      base({ effectiveFrom: "2026-05-01", earliestDataPeriod: null }),
    );
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.periods).toEqual([
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ]);
  });

  it("veri bilinmiyorken de gelecek tarih onay istemez", () => {
    expect(
      rateChangeImpact(base({ effectiveFrom: "2026-11-01", earliestDataPeriod: null }))
        .requiresConfirmation,
    ).toBe(false);
  });
});

describe("rateChangeImpact — geçmişe yürüme", () => {
  it("geçmiş bir tarihte veri varsa onay ister ve dönemleri listeler", () => {
    const impact = rateChangeImpact(base({ effectiveFrom: "2026-08-15" }));
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.periods).toEqual(["2026-08", "2026-09", "2026-10"]);
  });

  it("effectiveFrom verinin en eski döneminden eskiyse uyarı oradan başlar", () => {
    // `earliestDataPeriod`'ten önceki dönemler zaten yeni yevmiyeyle
    // hesaplanıyordu; onları uyarıya katmak yanlış olur.
    const impact = rateChangeImpact(
      base({ effectiveFrom: "2026-03-01", earliestDataPeriod: "2026-06" }),
    );
    expect(impact.periods).toEqual(["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"]);
  });

  it("veri yalnız güncel aydaysa uyarı aralığı o ayla sınırlı kalır", () => {
    // Veri Mayıs'ta yok; ilk kayıt Ekim'de. Yine de Ekim 1-2 günleri yeni
    // yevmiyeyle yeniden hesaplanacağı için onay gerekir — ama yalnız o ay.
    const impact = rateChangeImpact(
      base({ effectiveFrom: "2026-05-01", earliestDataPeriod: "2026-10", today: "2026-10-02" }),
    );
    expect(impact.requiresConfirmation).toBe(true);
    expect(impact.periods).toEqual(["2026-10"]);
  });

  it("etkilenen dönemler arasındaki kilitlileri ayrıca işaretler", () => {
    const impact = rateChangeImpact(
      base({ effectiveFrom: "2026-08-01", closedPeriods: ["2026-08", "2026-11"] }),
    );
    expect(impact.closedPeriods).toEqual(["2026-08"]);
    // Kilitli olmayanlar listede, kilitli olanlar yalnız ayrı alanda.
    expect(impact.periods).toContain("2026-09");
    expect(impact.closedPeriods).not.toContain("2026-09");
  });
});

describe("describeRateChangeImpact", () => {
  it("onay gerektirmiyorsa null döner", () => {
    expect(
      describeRateChangeImpact({ requiresConfirmation: false, periods: [], closedPeriods: [] }),
    ).toBeNull();
  });

  it("etkilenen dönem SAYISINI ve anahtarlarını verir", () => {
    const text = describeRateChangeImpact(rateChangeImpact(base({ effectiveFrom: "2026-05-01" })));
    expect(text).toBe("6 dönem etkilenecek: 2026-05, 2026-06, 2026-07, 2026-08, 2026-09, 2026-10");
  });

  it("kilitli dönem varsa onları ayrıca belirtir", () => {
    const text = describeRateChangeImpact(
      rateChangeImpact(base({ effectiveFrom: "2026-09-01", closedPeriods: ["2026-09"] })),
    );
    expect(text).toContain("2 dönem etkilenecek: 2026-09, 2026-10");
    expect(text).toContain("kilitli olanlar: 2026-09");
  });
});
