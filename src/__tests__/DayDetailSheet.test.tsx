import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup, fireEvent, act } from "@testing-library/react";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  fetchQuery: (...args: unknown[]) => fetchQuery(...args),
  executeTransaction: vi.fn(),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

import { DayDetailSheet } from "../components/DayDetailSheet";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { useToastStore } from "../stores/toastStore";
import type { Worker } from "../types";

const workers: Worker[] = [
  {
    id: 1,
    name: "Ahmet Yılmaz",
    daily_wage: 600,
    worker_type: "GUNLUK",
    is_active: true,
    created_at: "2026-01-01",
  },
];

const DATE = "2026-05-10";

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);

  useWorkerStore.setState({ workers, rateHistory: [], isLoading: false, error: null });
  useAttendanceStore.setState({ attendances: [], isLoading: false, error: null });
  useMetricsStore.setState({ metrics: [], isLoading: false, error: null });
  useToastStore.setState({ toasts: [] });
});

afterEach(cleanup);

/** Tıklama + bekleyen state güncellemelerinin akması. */
const click = async (el: HTMLElement) => {
  await act(async () => {
    fireEvent.click(el);
  });
};

const renderSheet = (onClose = vi.fn()) => {
  render(<DayDetailSheet isOpen dateStr={DATE} onClose={onClose} />);
  return onClose;
};

describe("DayDetailSheet", () => {
  it("dört durum düğmesi gösterir (tatil dahil)", () => {
    renderSheet();
    expect(screen.getByRole("button", { name: "Ahmet Yılmaz: Tam" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ahmet Yılmaz: Yarım" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ahmet Yılmaz: Yok" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Ahmet Yılmaz: İzin" })).toBeInTheDocument();
  });

  it("resmî tatil anahtarı vardır ve durumu aria-pressed ile bildirir", async () => {
    renderSheet();
    const toggle = screen.getByRole("button", { name: "Tatil" });
    expect(toggle).toHaveAttribute("aria-pressed", "false");
    await click(toggle);
    expect(toggle).toHaveAttribute("aria-pressed", "true");
  });

  it("gün açıldığında otomatik olarak önceki günü kopyalamaz", () => {
    useAttendanceStore.setState({
      attendances: [{ id: 1, worker_id: 1, date: "2026-05-09", status: "FULL" }],
    });
    renderSheet();
    expect(screen.getByRole("button", { name: "Ahmet Yılmaz: Tam" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
  });

  it("«Dünü kopyala» düğmesi önceki günün puantajını forma doldurur", async () => {
    useAttendanceStore.setState({
      attendances: [{ id: 1, worker_id: 1, date: "2026-05-09", status: "FULL" }],
    });
    renderSheet();

    await click(screen.getByRole("button", { name: /Dünü kopyala/i }));
    expect(screen.getByRole("button", { name: "Ahmet Yılmaz: Tam" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("başarılı kayıtta pencereyi kapatır ve veritabanına yazar", async () => {
    const onClose = renderSheet();

    await click(screen.getByRole("button", { name: "Ahmet Yılmaz: Tam" }));
    await click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    const written = executeQuery.mock.calls.map((c) => String(c[0]));
    expect(written.some((q) => q.includes("INTO daily_metrics"))).toBe(true);
    expect(written.some((q) => q.includes("INTO attendance"))).toBe(true);
  });

  it("KRİTİK: kayıt başarısız olursa pencere kapanmaz ve hata gösterilir", async () => {
    executeQuery.mockRejectedValue(new Error("disk dolu"));
    const onClose = renderSheet();

    await click(screen.getByRole("button", { name: "Ahmet Yılmaz: Tam" }));
    await click(screen.getByRole("button", { name: "Kaydet" }));

    await waitFor(() =>
      expect(useToastStore.getState().toasts.some((t) => t.type === "error")).toBe(true),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(useToastStore.getState().toasts.find((t) => t.type === "error")?.message).toContain(
      "disk dolu",
    );
  });

  it("kaydedilmemiş değişiklik varken İptal uyarı gösterir, kapatmaz", async () => {
    const onClose = renderSheet();

    await click(screen.getByRole("button", { name: "Ahmet Yılmaz: Tam" }));
    await click(screen.getByRole("button", { name: "İptal" }));

    expect(await screen.findByText(/Değişiklikler kaydedilmedi/i)).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await click(screen.getByRole("button", { name: /Yine de Çık/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it("değişiklik yokken İptal doğrudan kapatır", async () => {
    const onClose = renderSheet();
    await click(screen.getByRole("button", { name: "İptal" }));
    expect(onClose).toHaveBeenCalled();
  });
});
