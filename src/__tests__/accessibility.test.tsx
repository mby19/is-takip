import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  fetchQuery: (...args: unknown[]) => fetchQuery(...args),
  executeTransaction: vi.fn(),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
  fetchAll: vi.fn(),
}));

import { CalendarView } from "../components/CalendarView";
import { DayDetailSheet } from "../components/DayDetailSheet";
import { WorkerDetailView } from "../components/WorkerDetailView";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { usePaymentStore } from "../stores/paymentStore";
import { useToastStore } from "../stores/toastStore";
import type { Worker } from "../types";

/**
 * Erişilebilirlik testleri.
 *
 * Kapsam: kullanıcıyı ENGELLEYEN üç sınıf — klavyeyle kullanılamayan takvim
 * ızgarası (binlerce Tab durağı), modal odak tuzağı ve erişilebilir adı
 * olmayan form alanları (ekran okuyucu / sesli komut).
 */

const workers: Worker[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  name: i === 0 ? "Ahmet Yılmaz" : `Çalışan ${i + 1}`,
  daily_wage: 600,
  worker_type: "GUNLUK" as const,
  is_active: true,
  created_at: "2026-01-01",
}));

/** Mayıs 2026 — 31 gün, 6 kişi: ızgara 31 × 8 hücre + başlık satırı. */
const MONTH = new Date(2026, 4, 1);
const DATE = "2026-05-10";

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  // Takvim açılışta ayın verisini yeniden çeker; store'u yansıtmayan bir mock
  // testteki tohum puantajları sessizce siler.
  fetchQuery
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve().then(() => useAttendanceStore.getState().attendances),
    );

  useWorkerStore.setState({ workers, rateHistory: [], isLoading: false, error: null });
  useAttendanceStore.setState({ attendances: [], isLoading: false, error: null });
  useMetricsStore.setState({ metrics: [], isLoading: false, error: null });
  usePeriodStore.setState({
    closed: [],
    closedLoaded: true,
    earliestDataPeriod: null,
    isLoading: false,
    error: null,
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

  // jsdom ResizeObserver sağlamıyor; takvim "kaç sütun görünüyor" sayacı için kullanıyor.
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const renderCalendar = () => render(<CalendarView currentDate={MONTH} onDayClick={vi.fn()} />);

const gridCells = () => Array.from(document.querySelectorAll<HTMLElement>("[data-cal-cell]"));

describe("Takvim ızgarası — roving tabindex", () => {
  it("ızgarada tek Tab durağı vardır (31 gün × kişi hücreleri değil)", () => {
    renderCalendar();
    const cells = gridCells();
    // 31 gün × (gün + 6 kişi + sağ sütun) + başlıkta (6 kişi + sağ sütun).
    expect(cells).toHaveLength(31 * 8 + 7);

    const tabStops = cells.filter((c) => c.getAttribute("tabindex") === "0");
    expect(tabStops).toHaveLength(1);
    // Kalanı Tab sırasından düşer; tıklanabilirlikleri korunur.
    expect(cells.filter((c) => c.getAttribute("tabindex") === "-1")).toHaveLength(cells.length - 1);
  });

  it("ok tuşları hücreden hücreye odak taşır ve Tab durağı odakla birlikte yürür", () => {
    renderCalendar();
    const first = document.querySelector<HTMLElement>('[data-cal-cell="1-0"]');
    expect(first?.getAttribute("tabindex")).toBe("0");
    first?.focus();
    expect(document.activeElement).toBe(first);

    // Sağ: gün sütunundan 1. kişiye.
    fireEvent.keyDown(first!, { key: "ArrowRight" });
    const workerCell = document.querySelector<HTMLElement>('[data-cal-cell="1-1"]');
    expect(document.activeElement).toBe(workerCell);
    expect(workerCell?.getAttribute("tabindex")).toBe("0");
    expect(first?.getAttribute("tabindex")).toBe("-1");

    // Aşağı: aynı sütunda 2. güne.
    fireEvent.keyDown(workerCell!, { key: "ArrowDown" });
    const below = document.querySelector<HTMLElement>('[data-cal-cell="2-1"]');
    expect(document.activeElement).toBe(below);
    expect(below?.getAttribute("tabindex")).toBe("0");
  });

  it("kapanmış dönemde devre dışı hücreler gezinmede atlanır", () => {
    usePeriodStore.setState({
      closed: [{ period: "2026-05", closed_at: "2026-06-01", note: null }],
      closedLoaded: true,
      earliestDataPeriod: null,
      isLoading: false,
      error: null,
    });
    renderCalendar();

    const dayButton = document.querySelector<HTMLElement>('[data-cal-cell="1-0"]');
    dayButton?.focus();
    fireEvent.keyDown(dayButton!, { key: "ArrowRight" });

    // Kişi hücreleri disabled — ok tuşu doğrudan sağ sütuna geçer.
    expect(document.activeElement).toBe(document.querySelector('[data-cal-cell="1-7"]'));
  });

  it("ızgaradaki her hücre erişilebilir ad taşır", () => {
    renderCalendar();
    for (const cell of gridCells()) {
      expect(cell, cell.getAttribute("data-cal-cell") ?? undefined).toHaveAccessibleName();
    }
  });
});

describe("Form alanları görünür etiketlerine bağlı", () => {
  const renderDetail = () => render(<WorkerDetailView worker={workers[0]} onBack={vi.fn()} />);

  it("düzenleme diyaloğundaki alanlar etiketleriyle ilişkili", async () => {
    renderDetail();
    const editButton = await screen.findByRole("button", { name: "Çalışanı düzenle" });
    await act(async () => {
      fireEvent.click(editButton);
    });

    // getByLabelText yalnızca gerçekten BAĞLI etiketleri bulur.
    expect(await screen.findByLabelText("İsim Soyisim")).toBeInTheDocument();
    expect(screen.getByLabelText("Günlük Yevmiye (₺)")).toBeInTheDocument();

    // Ücret değişince tarih alanı açılır; o da bağlı olmalı.
    await act(async () => {
      fireEvent.change(screen.getByLabelText("Günlük Yevmiye (₺)"), {
        target: { value: "2000" },
      });
    });
    expect(await screen.findByLabelText("Bu tarihten itibaren geçerli")).toBeInTheDocument();
  });

  it("ödeme diyaloğundaki alanlar etiketleriyle ilişkili", async () => {
    renderDetail();
    // Gövde veri yüklenirken iskelet gösterir; düğme gelince tıkla.
    const payButton = await screen.findByRole("button", { name: /Ödeme Yap/ });
    await act(async () => {
      fireEvent.click(payButton);
    });

    expect(await screen.findByLabelText("Tutar (₺)")).toBeInTheDocument();
    expect(screen.getByLabelText("Ödeme Tarihi")).toBeInTheDocument();
    expect(screen.getByLabelText("Açıklama (Opsiyonel)")).toBeInTheDocument();
  });
});

describe("Odak görünürlüğü (CSS)", () => {
  const CSS = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"),
    "utf8",
  );

  it("klavye odağı global bir halkayla görünür", () => {
    // `--ring` her temada tanımlı; bare düğmeler tarayıcı varsayılanına
    // bırakılmıyor. Kendi halkasını kuran bileşenler utilities katmanındaki
    // `outline-none` ile bunu geçersiz kılar.
    const rule = /:focus-visible\s*\{([^}]*)\}/.exec(CSS);
    expect(rule).not.toBeNull();
    expect(rule?.[1]).toContain("outline: 2px solid hsl(var(--ring))");
    expect(rule?.[1]).toContain("outline-offset: 2px");
  });
});

describe("Modal odak tuzağı", () => {
  it("DayDetailSheet açıkken odak pencerenin içinde kalır", async () => {
    render(<DayDetailSheet isOpen dateStr={DATE} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");

    // Radix FocusScope odak korumasının iki uç noktası.
    expect(document.querySelectorAll("[data-radix-focus-guard]")).toHaveLength(2);
    // Arka plan erişilebilirlik ağacından düşer.
    expect(document.querySelectorAll("[aria-hidden]").length).toBeGreaterThan(0);
    expect(dialog.contains(document.activeElement)).toBe(true);

    for (let i = 0; i < 15; i++) {
      fireEvent.keyDown(document, { key: "Tab" });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it("penceredeki etkileşimli öğelerin tamamı erişilebilir ad taşır", async () => {
    render(<DayDetailSheet isOpen dateStr={DATE} onClose={vi.fn()} />);
    const dialog = await screen.findByRole("dialog");

    for (const button of dialog.querySelectorAll("button")) {
      expect(button).toHaveAccessibleName();
    }
    for (const field of dialog.querySelectorAll("input, select, textarea")) {
      expect(field).toHaveAccessibleName();
    }
  });
});
