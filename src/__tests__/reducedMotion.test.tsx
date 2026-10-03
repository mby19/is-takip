import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import { useState } from "react";
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

import { useAnimatedCounter } from "../hooks/useAnimatedCounter";
import { CalendarView } from "../components/CalendarView";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import type { Worker } from "../types";

/**
 * `prefers-reduced-motion` davranışının gerçek testleri.
 *
 * CSS animasyonları global kural susturuyor; ama iki hareket JS'ten geliyor
 * ve CSS'le kapatılamaz: sayacın rAF döngüsü (DOM'a doğrudan yazar) ve
 * takvimin yumuşak kaydırması. İkisi de burada doğrudan denenir.
 */

const CSS = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../index.css"), "utf8");

/** `matchMedia` taklidi — reduce tercihini test başına belirler. */
const stubMotion = (reduce: boolean) => {
  vi.stubGlobal(
    "matchMedia",
    vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("prefers-reduced-motion") ? reduce : false,
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
};

const Counter = ({ value }: { value: number }) => {
  const [node, setNode] = useState<HTMLSpanElement | null>(null);
  useAnimatedCounter(node, value, (n) => `₺${n}`);
  return <span ref={setNode} data-testid="counter" />;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe("useAnimatedCounter — prefers-reduced-motion", () => {
  it("reduce açıkken animasyon kurmaz, hedef değeri tek yazımda yazar", () => {
    stubMotion(true);
    const raf = vi.spyOn(window, "requestAnimationFrame");

    render(<Counter value={1000} />);

    expect(screen.getByTestId("counter")).toHaveTextContent("₺1000");
    expect(raf).not.toHaveBeenCalled();
  });

  it("reduce açıkken hedef değişince değer yine anında güncellenir", () => {
    stubMotion(true);
    const { rerender } = render(<Counter value={1000} />);
    rerender(<Counter value={750} />);
    expect(screen.getByTestId("counter")).toHaveTextContent("₺750");
  });

  it("reduce kapalıyken animasyon kareleri planlar", () => {
    stubMotion(false);
    const raf = vi.spyOn(window, "requestAnimationFrame").mockImplementation(() => 0); // kareleri yürütmeye gerek yok

    render(<Counter value={1000} />);

    expect(raf).toHaveBeenCalled();
  });
});

describe("Takvim kaydırması — prefers-reduced-motion", () => {
  const workers: Worker[] = Array.from({ length: 3 }, (_, i) => ({
    id: i + 1,
    name: `Çalışan ${i + 1}`,
    daily_wage: 600,
    worker_type: "GUNLUK" as const,
    is_active: true,
    created_at: "2026-01-01",
  }));

  let scrollSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
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
    useToastStore.setState({ toasts: [] });
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );
    // jsdom kaydırmayı uygulamıyor; prototipe taklit ekleyip çağrıyı ölçüyoruz.
    scrollSpy = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      writable: true,
      value: scrollSpy,
    });
  });

  afterEach(() => {
    delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
  });

  it.each([
    [true, "auto"],
    [false, "smooth"],
  ] as const)("reduce=%s → behavior %s", async (reduce, behavior) => {
    stubMotion(reduce);
    // Bugünün satırı yalnızca içinde bulunulan ayda kaydırılır.
    render(<CalendarView currentDate={new Date()} onDayClick={vi.fn()} />);

    await waitFor(() =>
      expect(scrollSpy).toHaveBeenCalledWith(expect.objectContaining({ behavior })),
    );
  });
});

describe("CSS — prefers-reduced-motion kuralı", () => {
  const block = CSS.slice(CSS.indexOf("@media (prefers-reduced-motion: reduce)"));

  it("tanımlı ve animasyonu susturuyor", () => {
    expect(block).not.toBe("");
    expect(block).toContain("animation-duration: 0.01ms !important");
    expect(block).toContain("animation-iteration-count: 1 !important");
  });

  it("geçişleri de susturuyor (sheet/modal açılış kapanışları)", () => {
    expect(block).toContain("transition-duration: 0.01ms !important");
    expect(block).toContain("scroll-behavior: auto !important");
  });
});
