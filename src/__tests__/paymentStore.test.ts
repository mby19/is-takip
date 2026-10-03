import { describe, it, expect, vi, beforeEach } from "vitest";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...a: unknown[]) => executeQuery(...a),
  fetchQuery: (...a: unknown[]) => fetchQuery(...a),
  executeTransaction: vi.fn(),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

import { PaymentOverpayError, usePaymentStore } from "../stores/paymentStore";
import { usePeriodStore } from "../stores/periodStore";
import type { Payment } from "../types";

const pay = (over: Partial<Payment> = {}): Payment => ({
  id: 1,
  worker_id: 1,
  amount: 500,
  date: "2026-09-10",
  description: "avans",
  ...over,
});

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  usePeriodStore.setState({ closed: [], earliestDataPeriod: null, isLoading: false });
  usePaymentStore.setState({
    payments: [],
    loadedWorkerId: null,
    paymentsByWorker: {},
    inFlightAdds: {},
    isLoading: false,
    error: null,
  });
});

describe("deletePayment", () => {
  it("store'da kayıt yoksa repository'ye gitmeden hata fırlatır", async () => {
    usePaymentStore.setState({ loadedWorkerId: 1, payments: [pay({ id: 7 })] });
    await expect(usePaymentStore.getState().deletePayment(999, 1)).rejects.toThrow(
      "Ödeme kaydı bulunamadı",
    );
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("DELETE sorgusunu worker_id ile sınırlar", async () => {
    usePaymentStore.setState({ loadedWorkerId: 1, payments: [pay({ id: 7 })] });
    await usePaymentStore.getState().deletePayment(7, 1);
    expect(executeQuery).toHaveBeenCalledWith(
      "DELETE FROM payments WHERE id = ? AND worker_id = ?",
      [7, 1],
    );
  });

  it("başka çalışanın önbelleğindeki kaydı bulamaz", async () => {
    usePaymentStore.setState({
      loadedWorkerId: 2,
      payments: [],
      paymentsByWorker: { 1: [pay({ id: 7, worker_id: 1 })] },
    });
    await expect(usePaymentStore.getState().deletePayment(7, 2)).rejects.toThrow(
      "Ödeme kaydı bulunamadı",
    );
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("hiçbir satır silinmediyse sessizce geçmez", async () => {
    usePaymentStore.setState({ loadedWorkerId: 1, payments: [pay({ id: 7 })] });
    executeQuery.mockResolvedValueOnce({ rowsAffected: 0 });
    await expect(usePaymentStore.getState().deletePayment(7, 1)).rejects.toThrow(
      "Ödeme kaydı bulunamadı",
    );
  });
});

describe("addPayment", () => {
  it("negatif, sıfır ve NaN tutarı reddeder, repository'ye gitmez", async () => {
    for (const amount of [-100, 0, NaN]) {
      await expect(usePaymentStore.getState().addPayment(1, amount, "2026-09-10")).rejects.toThrow(
        "Geçerli bir tutar giriniz",
      );
    }
    expect(executeQuery).not.toHaveBeenCalled();
    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("aynı çalışan+tarih için uçuşta ikinci isteği reddeder", async () => {
    const gate = Promise.withResolvers<unknown>();
    executeQuery.mockImplementationOnce(() => gate.promise);

    const first = usePaymentStore.getState().addPayment(1, 500, "2026-09-10", "avans");
    await expect(
      usePaymentStore.getState().addPayment(1, 500, "2026-09-10", "avans"),
    ).rejects.toThrow("kaydediliyor");

    gate.resolve({ rowsAffected: 1 });
    await first;
  });

  it("repository katmanındaki birebir aynı kaydı da reddeder", async () => {
    // İlk SELECT (duplicate kontrolü) eşleşme döndürür → INSERT yapılmamalı.
    fetchQuery.mockResolvedValueOnce([{ id: 3 }]);
    await expect(
      usePaymentStore.getState().addPayment(1, 500, "2026-09-10", "avans"),
    ).rejects.toThrow("zaten kayıtlı");
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("bakiyeyi aşan ödemeyi onaysız reddeder, kayıt oluşmaz (K1)", async () => {
    // Bileşen atlanırsa koruma store katmanında durmalı: 50.000 ₺ bakiyeye
    // 500.000 ₺ ödeme yazılamaz.
    await expect(
      usePaymentStore.getState().addPayment(1, 500000, "2026-09-10", "avans", { balance: 50000 }),
    ).rejects.toThrow(PaymentOverpayError);

    expect(executeQuery).not.toHaveBeenCalled();
    expect(usePaymentStore.getState().error).toBeTruthy();
  });

  it("aşım hatası aşan tutarı taşır (ekran aynı sayıyı gösterir)", async () => {
    const err = await usePaymentStore
      .getState()
      .addPayment(1, 500000, "2026-09-10", "avans", { balance: 50000 })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(PaymentOverpayError);
    // Tolerans: max(50.000 × %20, 2.000) = 10.000 → aşım 500.000 − 50.000 − 10.000
    expect((err as PaymentOverpayError).excess).toBe(440000);
  });

  it("onay verilirse aşan ödeme yazılır", async () => {
    await expect(
      usePaymentStore
        .getState()
        .addPayment(1, 500000, "2026-09-10", "avans", { balance: 50000, confirmed: true }),
    ).resolves.toBeUndefined();

    expect(executeQuery).toHaveBeenCalled();
  });

  it("tolerans içindeki meşru avans onaysız geçer", async () => {
    await expect(
      usePaymentStore.getState().addPayment(1, 55000, "2026-09-10", "avans", { balance: 50000 }),
    ).resolves.toBeUndefined();

    expect(executeQuery).toHaveBeenCalled();
  });

  it("bakiye verilmemişse aşım kontrolü yapılmaz (çağıran bakiyeyi bilmiyordur)", async () => {
    await expect(
      usePaymentStore.getState().addPayment(1, 999999, "2026-09-10", "avans"),
    ).resolves.toBeUndefined();

    expect(executeQuery).toHaveBeenCalled();
  });

  it("bakiye zaten negatifse yine de bakiyeyi aşan ödeme onay ister", async () => {
    // Tolerans `max(bakiye × %20, 2.000)`: negatif bakiyede taban geçerli
    // olur, yani 2.000 ₺'ya kadar küçük ödemeler geçer — kuralın kendisi.
    // Bakiyeyi gerçekten aşan ödeme ise onay ister.
    await expect(
      usePaymentStore.getState().addPayment(1, 5000, "2026-09-10", "avans", { balance: -500 }),
    ).rejects.toThrow(PaymentOverpayError);
  });

  it("negatif bakiyede küçük ödeme tolerans içinde onaysız geçer", async () => {
    await expect(
      usePaymentStore.getState().addPayment(1, 100, "2026-09-10", "avans", { balance: -500 }),
    ).resolves.toBeUndefined();
  });

  it("bayat bakiyeye bakmaz: toplam ödemeyi veritabanından okur (K1, PROBE-Q)", async () => {
    // Bakiye 50.000, ekranda 20.000 ödeme yapıldı ama liste tazelenmedi;
    // ikinci ödeme 40.000. Gerçek bakiye 30.000 → aşım onayı gerekir.
    fetchQuery.mockImplementation((sql: unknown) =>
      Promise.resolve(String(sql).includes("SUM(amount)") ? [{ total: 20000 }] : []),
    );

    await expect(
      usePaymentStore
        .getState()
        .addPayment(1, 40000, "2026-09-11", "", { balance: 50000, paidTotal: 0 }),
    ).rejects.toThrow(PaymentOverpayError);

    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("tazelenmiş bakiyede aşım yoksa yazma onaysız geçer", async () => {
    // Aynı senaryonun negatif kontrolü: 25.000 ödeme gerçek bakiyede
    // (30.000) tolerans içinde.
    fetchQuery.mockImplementation((sql: unknown) =>
      Promise.resolve(String(sql).includes("SUM(amount)") ? [{ total: 20000 }] : []),
    );

    await expect(
      usePaymentStore
        .getState()
        .addPayment(1, 25000, "2026-09-11", "", { balance: 50000, paidTotal: 0 }),
    ).resolves.toBeUndefined();

    expect(executeQuery).toHaveBeenCalled();
  });

  it("tazelenmiş bakiyede aşım onaylanırsa yazar", async () => {
    fetchQuery.mockImplementation((sql: unknown) =>
      Promise.resolve(String(sql).includes("SUM(amount)") ? [{ total: 20000 }] : []),
    );

    await expect(
      usePaymentStore
        .getState()
        .addPayment(1, 40000, "2026-09-11", "", { balance: 50000, paidTotal: 0, confirmed: true }),
    ).resolves.toBeUndefined();

    expect(executeQuery).toHaveBeenCalled();
  });

  it("farklı tarihlerde aynı çalışana ikinci ödemeyi de reddeder", async () => {
    // Aşım kontrolü bakiyeye bakar; iki ödeme aynı anda girerse ikisi de aynı
    // bakiyeye bakar ve ikisi de onaysız geçebilirdi.
    const gate = Promise.withResolvers<unknown>();
    executeQuery.mockImplementationOnce(() => gate.promise);

    const first = usePaymentStore.getState().addPayment(1, 500, "2026-09-10", "avans");
    await expect(
      usePaymentStore.getState().addPayment(1, 500, "2026-09-11", "avans"),
    ).rejects.toThrow("kaydediliyor");

    gate.resolve({ rowsAffected: 1 });
    await first;
  });
});

describe("fetchWorkerPayments", () => {
  it("çalışan değişince önceki çalışanın ödemelerini anında temizler", async () => {
    const gateA = Promise.withResolvers<unknown[]>();
    fetchQuery.mockImplementationOnce(() => gateA.promise);
    const pending = usePaymentStore.getState().fetchWorkerPayments(1);
    usePaymentStore.setState({
      loadedWorkerId: 1,
      payments: [pay({ id: 1, worker_id: 1 })],
      paymentsByWorker: { 1: [pay({ id: 1, worker_id: 1 })] },
    });
    gateA.resolve([]);

    const other = usePaymentStore.getState().fetchWorkerPayments(2);
    // B'nin fetch'i başlamış olmasına rağmen A'nın ödemeleri görünmemeli.
    expect(usePaymentStore.getState().payments).toEqual([]);
    expect(usePaymentStore.getState().loadedWorkerId).toBe(2);

    await Promise.all([pending, other]);
  });

  it("geç gelen yanıt yeni çalışana ait veriyi ezmez", async () => {
    const gateLate = Promise.withResolvers<Payment[]>();
    fetchQuery.mockImplementationOnce(() => gateLate.promise);
    const a = usePaymentStore.getState().fetchWorkerPayments(1);

    fetchQuery.mockResolvedValueOnce([pay({ id: 2, worker_id: 2 })]);
    await usePaymentStore.getState().fetchWorkerPayments(2);
    expect(usePaymentStore.getState().loadedWorkerId).toBe(2);

    gateLate.resolve([pay({ id: 1, worker_id: 1 })]);
    await a;
    expect(usePaymentStore.getState().payments).toEqual([pay({ id: 2, worker_id: 2 })]);
  });
});
