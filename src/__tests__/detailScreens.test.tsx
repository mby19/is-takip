import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, fireEvent } from "@testing-library/react";
import { subMonths, format } from "date-fns";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...a: unknown[]) => executeQuery(...a),
  fetchQuery: (...a: unknown[]) => fetchQuery(...a),
  executeTransaction: vi.fn(),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
  fetchAll: vi.fn(),
}));

import { WorkerDetailView } from "../components/WorkerDetailView";
import { MonthSummaryScreen } from "../components/MonthSummaryScreen";
import { useWorkerStore } from "../stores/workerStore";
import { usePeriodStore } from "../stores/periodStore";
import { usePaymentStore } from "../stores/paymentStore";
import { useToastStore } from "../stores/toastStore";
import type { Worker } from "../types";

const workerA: Worker = {
  id: 1,
  name: "Ahmet Yılmaz",
  daily_wage: 1500,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
};

const now = new Date();
const THIS_MONTH = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
const THIS_MONTH_DAY = `${THIS_MONTH}-10`;
const TODAY = format(now, "yyyy-MM-dd");

/** `monthsBack` ay önceki dönem anahtarı (`YYYY-MM`). */
const addMonthsAgo = (monthsBack: number): string => format(subMonths(now, monthsBack), "yyyy-MM");

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  useWorkerStore.setState({
    workers: [workerA],
    rateHistory: [
      { id: 1, worker_id: 1, valid_from: "2025-01-01", daily_wage: 1000, worker_type: "GUNLUK" },
      { id: 2, worker_id: 1, valid_from: "2026-06-01", daily_wage: 1500, worker_type: "GUNLUK" },
    ],
    isLoading: false,
    error: null,
  });
  usePeriodStore.setState({
    closed: [],
    closedLoaded: true,
    error: null,
    earliestDataPeriod: "2026-01",
    isLoading: false,
  });
  usePaymentStore.setState({
    payments: [],
    loadedWorkerId: null,
    paymentsByWorker: {},
    inFlightAdds: {},
    isLoading: false,
    error: null,
  });
  useToastStore.setState({ toasts: [] });
});

describe("WorkerDetailView / MonthSummaryScreen", () => {
  it("WorkerDetailView: store her iki çalışanın ödemesini taşısa da yalnız A'nınki görünür", async () => {
    // Kötü senaryo: store ayrımı yapmamış, iki çalışanın ödemesi de yüklü.
    fetchQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM payments")) {
        return Promise.resolve([
          { id: 1, worker_id: 1, amount: 500, date: THIS_MONTH_DAY, description: "avans" },
          { id: 2, worker_id: 2, amount: 9999, date: THIS_MONTH_DAY, description: "BAŞKASI" },
        ]);
      }
      return Promise.resolve([]);
    });
    await act(async () => {
      render(<WorkerDetailView worker={workerA} onBack={() => {}} />);
    });

    expect(screen.queryByText("BAŞKASI")).toBeNull();
    expect(screen.getByText("avans")).toBeTruthy();
    expect(screen.getByText(/Yevmiye geçmişi/)).toBeTruthy();
    expect(screen.getByText("01 Haz 2026")).toBeTruthy();
    expect(screen.getByText("01 Oca 2025")).toBeTruthy();
  });

  it("WorkerDetailView: kilitli dönemde ödeme butonu ve ücret kaydı engellenir", async () => {
    const closedNow = new Date();
    usePeriodStore.setState({
      closed: [
        {
          period: `${closedNow.getFullYear()}-${String(closedNow.getMonth() + 1).padStart(2, "0")}`,
          closed_at: "",
          note: null,
        },
      ],
      closedLoaded: true,
    });

    await act(async () => {
      render(<WorkerDetailView worker={workerA} onBack={() => {}} />);
    });

    const payBtn = screen.getByRole("button", { name: /Ödeme Yap/ });
    expect(payBtn.hasAttribute("disabled")).toBe(true);
    expect(screen.getByText(/kapatıldı/)).toBeTruthy();
  });

  it("WorkerDetailView: arşivli çalışana ödeme girilemez", async () => {
    const archived = { ...workerA, is_active: false };
    await act(async () => {
      render(<WorkerDetailView worker={archived} onBack={() => {}} />);
    });
    const payBtn = screen.getByRole("button", { name: /Arşivde/ });
    expect(payBtn.hasAttribute("disabled")).toBe(true);
  });

  it("MonthSummaryScreen: borç satırı due ile eşit olsa da görünür", async () => {
    await act(async () => {
      render(<MonthSummaryScreen onWorkerClick={() => {}} />);
    });
    expect(screen.getByText(/Tüm dönemler dahil kalan borç/)).toBeTruthy();
  });

  it("MonthSummaryScreen: ortak yokken oluşan kârı «Dağıtılmayan kâr» satırında gösterir", async () => {
    // Yalnız günlükçü var; ciro girilmiş ama ortak yok → kâr dağıtılmaz.
    fetchQuery.mockImplementation((sql: string) => {
      if (sql.includes("FROM attendance WHERE date >=")) {
        return Promise.resolve([{ id: 1, worker_id: 1, date: TODAY, status: "FULL" }]);
      }
      if (sql.includes("FROM daily_metrics WHERE date >=")) {
        return Promise.resolve([
          {
            id: 1,
            date: TODAY,
            production_amount: 0,
            total_earned: 5000,
            extra_expenses: 0,
            is_holiday: false,
          },
        ]);
      }
      if (sql.includes("MIN(date)")) {
        return Promise.resolve([{ earliest: null }]);
      }
      return Promise.resolve([]);
    });

    await act(async () => {
      render(<MonthSummaryScreen onWorkerClick={() => {}} />);
    });

    // Ciro 5000 − yevmiye 1500 = 3500 kâr; hiçbir yere dağıtılmıyordu.
    const row = screen.getByText(/Dağıtılmayan kâr/i);
    expect(row.parentElement?.parentElement?.textContent).toContain("₺3.500");
  });

  it("WorkerDetailView: bakiyeyi aşan ödeme onay diyaloğu açmadan kaydedilmez (K1)", async () => {
    await act(async () => {
      render(<WorkerDetailView worker={workerA} onBack={() => {}} />);
    });

    // Bakiye 0'a yakın, ödeme çok büyük → aşım onayı gerekir.
    fireEvent.click(screen.getByRole("button", { name: /Ödeme Yap/ }));
    fireEvent.change(screen.getByPlaceholderText("Örn: 2000"), {
      target: { value: "500000" },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kaydet" }));
    });

    expect(screen.getByText("Bakiye aşılıyor")).toBeTruthy();
    // Onay verilmeden hiçbir INSERT denenmemeli.
    const inserts = executeQuery.mock.calls.filter((c) => String(c[0]).includes("INSERT"));
    expect(inserts).toHaveLength(0);
  });

  it("WorkerDetailView: geçmişe yürüyen ücret değişikliği onay diyaloğu açar (K2)", async () => {
    await act(async () => {
      render(<WorkerDetailView worker={workerA} onBack={() => {}} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Çalışanı düzenle" }));
    const wageInput = screen.getByPlaceholderText("Örn: 1500");
    fireEvent.change(wageInput, { target: { value: "2500" } });
    fireEvent.change(screen.getByDisplayValue(TODAY), {
      target: { value: `${addMonthsAgo(2)}-01` },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Değişiklikleri Kaydet" }));
    });

    expect(screen.getByText("Geçmiş hakedişleri değiştir")).toBeTruthy();
    const transactions = executeQuery.mock.calls.filter((c) => String(c[0]).includes("UPDATE"));
    expect(transactions).toHaveLength(0);
  });

  it("WorkerDetailView: bu ayın 12'si ücret değişikliği onay diyaloğu açmaz", async () => {
    await act(async () => {
      render(<WorkerDetailView worker={workerA} onBack={() => {}} />);
    });

    fireEvent.click(screen.getByRole("button", { name: "Çalışanı düzenle" }));
    fireEvent.change(screen.getByPlaceholderText("Örn: 1500"), { target: { value: "2500" } });
    fireEvent.change(screen.getByDisplayValue(TODAY), {
      target: { value: `${THIS_MONTH}-12` },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Değişiklikleri Kaydet" }));
    });

    expect(screen.queryByText("Geçmiş hakedişleri değiştir")).toBeNull();
    const updates = executeQuery.mock.calls.filter((c) => String(c[0]).includes("UPDATE workers"));
    expect(updates).toHaveLength(1);
  });
});

afterEach(cleanup);
