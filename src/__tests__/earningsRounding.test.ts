import { describe, it, expect } from "vitest";
import { allocateCents, roundMoney } from "../utils/earningsCalculator";
import {
  calculateWorkerStats,
  calculateBusinessTotals,
  createWorkerStatsContext,
} from "../utils/calculations";
import type { Worker, WorkerRate, Attendance, DailyMetric, Payment } from "../types";

/**
 * Para yuvarlama ve gün kümesi kuralları (ADR-0009).
 *
 * Buradaki testler kuruşun **kaybolmadığını** ve **yaratılmadığını** kanıtlar:
 * gün satırlarının toplamı gösterilen toplamla her zaman tutar.
 */

const MAY = new Date(2026, 4, 1);

function partner(id: number, name: string): Worker {
  return {
    id,
    name,
    daily_wage: 0,
    worker_type: "ORTAK",
    is_active: true,
    created_at: "2026-01-01",
  };
}

function daily(id: number, name: string, wage: number): Worker {
  return {
    id,
    name,
    daily_wage: wage,
    worker_type: "GUNLUK",
    is_active: true,
    created_at: "2026-01-01",
  };
}

function metric(date: string, total: number, expenses = 0): DailyMetric {
  return {
    id: 0,
    date,
    production_amount: total,
    total_earned: total,
    extra_expenses: expenses,
    is_holiday: false,
  };
}

function att(workerId: number, date: string, status: Attendance["status"] = "FULL"): Attendance {
  return { id: 0, worker_id: workerId, date, status };
}

const sum = (values: number[]): number => values.reduce((a, b) => a + b, 0);

describe("allocateCents — kuruş tahsisi", () => {
  it("toplamı korur: 3 × 33,3333 → 33,34 + 33,33 + 33,33", () => {
    const out = allocateCents([100 / 3, 100 / 3, 100 / 3]);
    expect(out).toEqual([33.34, 33.33, 33.33]);
    expect(sum(out)).toBe(100);
  });

  it("her sonucu kuruş hassasiyetinde tutar", () => {
    for (const raw of [33.3333, 7 / 3, 0.005, 1234.567, -19.999]) {
      for (const cents of allocateCents([raw])) {
        expect(Math.abs(cents * 100 - Math.round(cents * 100))).toBeLessThan(1e-9);
      }
    }
  });

  it("sıfır değerli günler kuruş yutmaz", () => {
    const out = allocateCents([0, 33.333, 0, 33.333, 0]);
    expect(out[0]).toBe(0);
    expect(out[2]).toBe(0);
    expect(out[4]).toBe(0);
    expect(sum(out)).toBe(66.67);
  });

  it("zararı da toplamı koruyarak dağıtır", () => {
    const out = allocateCents([-100 / 3, -100 / 3, -100 / 3]);
    expect(sum(out)).toBe(-100);
  });

  it("rastgele girdilerde Σ sonuç = round(Σ ham) ve toplam korunur", () => {
    // Deterministik sözde-rastgele: hata yeniden üretilebilsin diye seed'li.
    let seed = 20260501;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let trial = 0; trial < 500; trial++) {
      const n = 1 + Math.floor(next() * 8);
      const raw = Array.from({ length: n }, () => (next() * 2 - 1) * 10000);
      const out = allocateCents(raw);
      expect(sum(out)).toBeCloseTo(roundMoney(sum(raw)), 9);
      for (const cents of out) {
        expect(Math.abs(cents * 100 - Math.round(cents * 100))).toBeLessThan(1e-9);
      }
    }
  });
});

describe("CC1 — çok ortaklı kuruş yuvarlama senaryosu", () => {
  /** 3 ortak, 100,00 kâr: 33,3333 pay → kuruş üçe bölünemez. */
  const workers = [partner(1, "Ali"), partner(2, "Veli"), partner(3, "Ayşe")];
  const metrics = [metric("2026-05-05", 100)];
  const attendances = [att(1, "2026-05-05"), att(2, "2026-05-05"), att(3, "2026-05-05")];

  it("gün satırlarının toplamı gösterilen toplamla tutar", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, workers, []);
    const stats = workers.map((w) =>
      calculateWorkerStats(w, MAY, metrics, attendances, workers, [], [], ctx),
    );

    for (const s of stats) {
      const rowSum = sum(s.dailyBreakdown.map((d) => d.earned));
      expect(rowSum).toBe(s.totalEarnedInMonth);
    }

    // Klasik hata: 33,33 × 3 = 99,99 ≠ 100,00. Burada toplam 100,00'dir.
    const grandTotal = sum(stats.map((s) => s.totalEarnedInMonth));
    expect(grandTotal).toBe(100);
  });

  it("en büyük kalan payı alan gün bir kuruş fazla alır", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, workers, []);
    const stats = calculateWorkerStats(workers[0], MAY, metrics, attendances, workers, [], [], ctx);
    const day = stats.dailyBreakdown.find((d) => d.date === "2026-05-05");
    expect(day?.earned).toBe(33.34);
  });
});

describe("CC1 — çok günlü ve karışık kırılma", () => {
  /** 7 gün × 100,00 kâr, 3 ortak → her gün 33,3333; ay toplamı 700,00. */
  const partners = [partner(1, "Ali"), partner(2, "Veli"), partner(3, "Ayşe")];
  const days = Array.from({ length: 7 }, (_, i) => `2026-05-0${i + 1}`);
  const metrics = days.map((d) => metric(d, 100));
  const attendances = days.flatMap((d) => partners.map((p) => att(p.id, d)));

  it("gün toplamı ay toplamına birebir eşit olur", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, partners, []);
    for (const p of partners) {
      const stats = calculateWorkerStats(p, MAY, metrics, attendances, partners, [], [], ctx);
      expect(roundMoney(sum(stats.dailyBreakdown.map((d) => d.earned)))).toBe(
        stats.totalEarnedInMonth,
      );
    }
  });

  it("üç kişinin toplamı havuzun net kârına eşittir", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, partners, []);
    const total = sum(
      partners.map(
        (p) =>
          calculateWorkerStats(p, MAY, metrics, attendances, partners, [], [], ctx)
            .totalEarnedInMonth,
      ),
    );
    const biz = calculateBusinessTotals(ctx, "2026-05", partners);
    expect(biz.netProfit).toBe(700);
    expect(total).toBe(biz.netProfit);
  });

  it("yarım gün ağırlıklarında da toplam korunur", () => {
    const halfMetrics = [metric("2026-05-10", 500)];
    const halfAtt = [att(1, "2026-05-10", "HALF"), att(2, "2026-05-10", "FULL")];
    const ctx = createWorkerStatsContext(halfAtt, halfMetrics, partners, []);
    const total = sum(
      partners.map(
        (p) =>
          calculateWorkerStats(p, MAY, halfMetrics, halfAtt, partners, [], [], ctx)
            .totalEarnedInMonth,
      ),
    );
    // Ağırlıklar 0,5 + 1 → paylar 166,6667 ve 333,3333; toplam 500,00.
    expect(total).toBe(500);
  });

  it("yevmiyeli + ortak karışımında kişi toplamları = yevmiye + net kâr − zarar", () => {
    // Ciro 900,25 − gider 100,10 = 800,15 brüt; yevmiye 1000,50 → **zarar −200,35**.
    // Zarar ortaklara dağıtılmaz (ADR-0009 / K3), bu yüzden toplam kuralı
    // `wageCost + netProfit` değil `wageCost + netProfit − undistributed` olur.
    const mixed = [daily(1, "Ali", 1000.5), partner(2, "Veli"), partner(3, "Ayşe")];
    const m = [metric("2026-05-03", 900.25, 100.1)];
    const a = mixed.map((w) => att(w.id, "2026-05-03"));
    const ctx = createWorkerStatsContext(a, m, mixed, []);
    const total = sum(
      mixed.map((w) => calculateWorkerStats(w, MAY, m, a, mixed, [], [], ctx).totalEarnedInMonth),
    );
    const biz = calculateBusinessTotals(ctx, "2026-05", mixed);
    expect(biz.netProfit).toBe(-200.35);
    expect(biz.undistributed).toBe(-200.35);
    expect(roundMoney(total)).toBe(roundMoney(biz.wageCost + biz.netProfit - biz.undistributed));
  });
});

describe("CC2 — gün kümesi kuralı", () => {
  /**
   * 1 Mayıs: ciro girilmiş, puantaj yok.
   * 2 Mayıs: puantaj girilmiş, ciro **yok**.
   *
   * Eski davranışta ay sonu ekranı yalnız `daily_metrics` satırlarını gezdiği
   * için 2 Mayıs'ın yevmiyesi işletme toplamına girmiyor, kişi dökümüne
   * giriyordu; iki taraf tutmuyordu.
   */
  const workers = [partner(1, "Ali"), partner(2, "Veli"), daily(3, "Ayşe", 1000)];
  const metrics = [metric("2026-05-01", 300)];
  const attendances = [att(1, "2026-05-01"), att(2, "2026-05-01"), att(3, "2026-05-02")];

  it("puantajı olup cirosu olmayan gün de işletme toplamına girer", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, workers, []);
    const biz = calculateBusinessTotals(ctx, "2026-05", workers);
    expect(biz.days).toBe(2);
    expect(biz.wageCost).toBe(1000);
  });

  it("cirosu girilmemiş gün ortak havuzuna sahte zarar yazmaz", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, workers, []);
    const biz = calculateBusinessTotals(ctx, "2026-05", workers);
    // 1 Mayıs: 300 kâr. 2 Mayıs: yevmiye 1000 var ama ciro/gider yok → 0.
    expect(biz.netProfit).toBe(300);
  });

  it("kişi toplamları ile işletme toplamları birebir tutar", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, workers, []);
    const personTotal = sum(
      workers.map(
        (w) =>
          calculateWorkerStats(w, MAY, metrics, attendances, workers, [], [], ctx)
            .totalEarnedInMonth,
      ),
    );
    const biz = calculateBusinessTotals(ctx, "2026-05", workers);
    expect(personTotal).toBe(roundMoney(biz.wageCost + biz.netProfit));
    expect(personTotal).toBe(1300);
  });

  it("bağlamsız ve bağlamlı çağrılar aynı sonucu verir", () => {
    const ctx = createWorkerStatsContext(attendances, metrics, workers, []);
    for (const w of workers) {
      const withCtx = calculateWorkerStats(w, MAY, metrics, attendances, workers, [], [], ctx);
      const withoutCtx = calculateWorkerStats(w, MAY, metrics, attendances, workers, [], []);
      expect(withoutCtx.totalEarnedInMonth).toBe(withCtx.totalEarnedInMonth);
      expect(withoutCtx.totalEarnedAllTime).toBe(withCtx.totalEarnedAllTime);
      expect(sum(withoutCtx.dailyBreakdown.map((d) => d.earned))).toBe(withCtx.totalEarnedInMonth);
    }
  });
});

describe("CC4/CC5/CC6 — indeksli çözümleme", () => {
  it("zam sonrası eski ay eski yevmiyeyle hesaplanır", () => {
    const w = daily(1, "Ali", 5000);
    const history: WorkerRate[] = [
      { id: 1, worker_id: 1, valid_from: "2000-01-01", daily_wage: 600, worker_type: "GUNLUK" },
      { id: 2, worker_id: 1, valid_from: "2026-05-01", daily_wage: 900, worker_type: "GUNLUK" },
      { id: 3, worker_id: 1, valid_from: "2026-07-01", daily_wage: 1200, worker_type: "GUNLUK" },
    ];
    const a = [att(1, "2026-04-10"), att(1, "2026-05-10"), att(1, "2026-07-10")];

    const april = calculateWorkerStats(w, new Date(2026, 3, 1), [], a, [w], [], history);
    const may = calculateWorkerStats(w, new Date(2026, 4, 1), [], a, [w], [], history);
    const july = calculateWorkerStats(w, new Date(2026, 6, 1), [], a, [w], [], history);

    expect(april.totalEarnedInMonth).toBe(600);
    expect(may.totalEarnedInMonth).toBe(900);
    expect(july.totalEarnedInMonth).toBe(1200);
    expect(may.totalEarnedAllTime).toBe(2700);
  });

  it("paylaşılan bağlam, çalışanlar arasında ortak havuzu klonlamaz", () => {
    const w = partner(1, "Ali");
    const pool = [partner(1, "Ali"), partner(2, "Veli")];
    const m = [metric("2026-05-04", 100)];
    const a = [att(1, "2026-05-04"), att(2, "2026-05-04")];
    const ctx = createWorkerStatsContext(a, m, pool, []);

    // Aynı bağlamda tekrar tekrar çağırmak sonucu değiştirmemeli.
    const first = calculateWorkerStats(w, MAY, m, a, pool, [], [], ctx).totalEarnedInMonth;
    const second = calculateWorkerStats(w, MAY, m, a, pool, [], [], ctx).totalEarnedInMonth;
    expect(second).toBe(first);
    expect(ctx.poolFor(w)).toBe(pool);
  });

  it("havuzda olmayan çalışan için havuz bir kez genişletilir ve önbelleklenir", () => {
    const outsider = partner(9, "Dışarıdan");
    const pool = [partner(1, "Ali"), partner(2, "Veli")];
    const ctx = createWorkerStatsContext([], [], pool, []);
    const first = ctx.poolFor(outsider);
    expect(ctx.poolFor(outsider)).toBe(first);
    expect(first).toHaveLength(3);
  });
});

describe("bakiye aritmetiği", () => {
  it("periodBalance = ay hakedişi − ay ödemesi", () => {
    const w = daily(1, "Ali", 1000);
    const a = [att(1, "2026-05-10")];
    const payments: Payment[] = [
      { id: 1, worker_id: 1, amount: 250.5, date: "2026-05-15", description: "" },
      { id: 2, worker_id: 1, amount: 100, date: "2026-04-15", description: "" },
    ];
    const stats = calculateWorkerStats(w, MAY, [], a, [w], payments);
    expect(stats.totalEarnedInMonth).toBe(1000);
    expect(stats.paidInMonth).toBe(250.5);
    expect(stats.periodBalance).toBe(749.5);
    expect(stats.totalPaid).toBe(350.5);
  });

  it("yok gün kazanç üretmez ama devamsızlık olarak sayılır", () => {
    const w = daily(1, "Ali", 1000);
    const stats = calculateWorkerStats(w, MAY, [], [att(1, "2026-05-10", "ABSENT")], [w], []);
    expect(stats.totalEarnedInMonth).toBe(0);
    expect(stats.absentDays).toBe(1);
  });
});
