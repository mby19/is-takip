import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";
import { createElement } from "react";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  fetchQuery: (...args: unknown[]) => fetchQuery(...args),
  executeTransaction: vi.fn(),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

/**
 * Çizilen hücre sayacı. Takvimde her puantajlı hücre bir durum ikonu çizer,
 * dolayısıyla bu sayaç "kaç hücre yeniden çizildi"yi tam olarak ölçer.
 *
 * `vi.hoisted` şart: `vi.mock` çağrıları yukarı kaldırılır ve takvim modülü
 * bu satırlardan önce yüklenir; sayaç da TDZ'ye düşmesin diye kaldırılmış
 * blokta yaşamalı.
 */
const counter = vi.hoisted(() => ({ cells: 0 }));

vi.mock("lucide-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("lucide-react")>();

  const counting = (name: "Check" | "Minus" | "X") => {
    const Counting = (props: Record<string, unknown>) => {
      counter.cells += 1;
      return createElement(actual[name], props);
    };
    Counting.displayName = name;
    return Counting;
  };

  return { ...actual, Check: counting("Check"), Minus: counting("Minus"), X: counting("X") };
});

import { CalendarView } from "../components/CalendarView";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import type { Worker } from "../types";

const workers: Worker[] = Array.from({ length: 6 }, (_, i) => ({
  id: i + 1,
  name: `Çalışan ${i + 1}`,
  daily_wage: 600,
  worker_type: "GUNLUK" as const,
  is_active: true,
  created_at: "2026-01-01",
}));

const MONTH = new Date(2026, 4, 1); // Mayıs 2026 — 31 gün

const attendance = (date: string, workerId: number, status: "FULL" | "HALF" | "ABSENT") => ({
  id: workerId,
  worker_id: workerId,
  date,
  status,
});

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  // Takvim açılışta ayın verisini yeniden çeker; store'u yansıtmayan bir mock
  // testteki tohum puantajları sessizce siler.
  fetchQuery
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve().then(() => useAttendanceStore.getState().attendances),
    );
  counter.cells = 0;
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
});

// jsdom ResizeObserver sağlamıyor; takvim "kaç sütun görünüyor" sayacı için kullanıyor.
beforeEach(() => {
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

const renderCalendar = (onDayClick = vi.fn()) => {
  render(<CalendarView currentDate={MONTH} onDayClick={onDayClick} />);
  return onDayClick;
};

describe("CalendarView", () => {
  it("ayın günlerini ve çalışan sütunlarını çizer", () => {
    renderCalendar();
    expect(screen.getByLabelText("1 Mayıs Cuma gününü aç")).toBeInTheDocument();
    expect(screen.getByLabelText("31 Mayıs Pazar gününü aç")).toBeInTheDocument();
    expect(screen.getByTitle("Çalışan 1")).toBeInTheDocument();
    expect(screen.getByTitle("Çalışan 6")).toBeInTheDocument();
  });

  it("hücreye dokununca durum ilerler ve hücrede geri al düğmesi çıkar", async () => {
    useAttendanceStore.setState({
      attendances: [attendance("2026-05-10", 1, "FULL")],
    });
    renderCalendar();

    const cell = screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Tam");
    await act(async () => {
      fireEvent.click(cell);
    });

    // Tam → Yarım
    expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Yarım")).toBeInTheDocument();
    // Geri alma ekranı kapatan toast'ta değil, dokunulan hücrenin köşesindedir.
    expect(
      screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar değişikliğini geri al"),
    ).toBeInTheDocument();
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("sütun başlığından çalışan detayı açılır", () => {
    const onWorkerClick = vi.fn();
    render(<CalendarView currentDate={MONTH} onDayClick={vi.fn()} onWorkerClick={onWorkerClick} />);

    fireEvent.click(screen.getByTitle("Çalışan 3"));
    expect(onWorkerClick).toHaveBeenCalledWith(expect.objectContaining({ id: 3 }));
  });

  it("gün düğmesi onDayClick'i doğru tarihle çağırır", () => {
    const onDayClick = renderCalendar();
    fireEvent.click(screen.getByLabelText("12 Mayıs Salı gününü aç"));
    expect(onDayClick).toHaveBeenCalledWith("2026-05-12");
  });

  it("kapanmış dönemde hücreler salt okunur", () => {
    usePeriodStore.setState({
      closed: [{ period: "2026-05", closed_at: "2026-06-01", note: null }],
      earliestDataPeriod: null,
      isLoading: false,
    });
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    expect(screen.getByText(/Bu dönem kapatıldı/)).toBeInTheDocument();
    const cell = screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Tam");
    expect(cell).toBeDisabled();
  });

  it("sağ sütun ölçüsü değiştirilebilir", () => {
    renderCalendar();
    const button = screen.getByLabelText(/Sağ sütun: Üretim/);
    fireEvent.click(button);
    expect(screen.getByLabelText(/Sağ sütun: Ciro/)).toBeInTheDocument();
  });
});

describe("memo etkinliği", () => {
  /**
   * Bir hücreye dokununca kaç hücrenin yeniden çizildiğini SAYAR.
   *
   * DOM düğümlerinin aynı kalması kanıt değildir: React, `memo` olmasa bile
   * çıktı değişmediyse düğümü yeniden kullanır. Tek güvenilir ölçüt, çizilen
   * hücre sayısıdır — 31 gün × 6 çalışan = 186 hücre.
   */
  it("bir hücreye dokununca yalnızca o günün hücreleri çizilir", async () => {
    renderCalendar();
    // Takvim boş puantajla açıldı: dolu hücre yok, ikon da çizilmedi.
    expect(counter.cells).toBe(0);

    // Tüm ayı dolu duruma getir → 31 gün × 6 çalışan hücre çizilir.
    await act(async () => {
      useAttendanceStore.setState({
        attendances: ["2026-05-05", "2026-05-10", "2026-05-20", "2026-05-31"].flatMap((date) =>
          workers.map((w) => attendance(date, w.id, "FULL")),
        ),
      });
    });
    expect(counter.cells).toBe(4 * workers.length);

    // 10 Mayıs'ta puantajı OLMAYAN bir hücreye dokun: o gün 6 hücrenin
    // tamamı yeniden çizilir, diğer 30 günün hiçbiri. Dokunulan hücre bir kez
    // daha çizilir — yeni durum için bir, hücre geri bildirimi (parlama +
    // geri al) için bir. Geri bildirim hücreye abone olduğu için yalnız onu
    // etkiler.
    counter.cells = 0;
    await act(async () => {
      fireEvent.click(screen.getByLabelText("Çalışan 3, 10 Mayıs Pazar: Tam"));
    });

    expect(counter.cells).toBe(workers.length + 1);
  });

  /**
   * Sayaç kareleri DOM'a yazdığı için grid'i yeniden çizmez.
   *
   * jsdom `requestAnimationFrame`'in zaman damgasını ilerletmediğinden kare
   * zamanı elle sürülüyor: `performance.now` ve rAF geri çağrısı birlikte
   * ilerletilir, böylece animasyon gerçekten birden fazla kare boyunca çalışır.
   */
  it("sayaç animasyonu sırasında hiçbir hücre yeniden çizilmez", async () => {
    let clock = 0;
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    const raf = vi
      .spyOn(window, "requestAnimationFrame")
      .mockImplementation((cb: FrameRequestCallback) => {
        setTimeout(() => {
          clock += 100;
          cb(clock);
        }, 0);
        return 0;
      });

    renderCalendar();

    // Hedef değer mount'ta sıfırdan animasyona başlar; sayaç DOM'a yazar.
    counter.cells = 0;
    await act(async () => {
      useMetricsStore.setState({
        metrics: [
          {
            id: 1,
            date: "2026-05-10",
            production_amount: 120,
            total_earned: 0,
            extra_expenses: 0,
          },
        ],
      });
    });

    // Animasyonun hedefe ulaşmasını bekle; bu sırada sayaç kareleri yazılır.
    await waitFor(() => expect(screen.getByText("120")).toBeInTheDocument(), { timeout: 3000 });

    // Hedefe ulaştı: değer DOM'a yazıldı, hiçbir hücre yeniden çizilmedi.
    expect(raf).toHaveBeenCalled();
    expect(counter.cells).toBe(0);
  });
});
