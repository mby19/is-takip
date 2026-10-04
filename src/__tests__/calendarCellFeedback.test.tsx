import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();
const executeTransaction = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  fetchQuery: (...args: unknown[]) => fetchQuery(...args),
  executeTransaction: (...args: unknown[]) => executeTransaction(...args),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

import { CalendarView } from "../components/CalendarView";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { useCellFeedbackStore, FLASH_WINDOW, UNDO_WINDOW } from "../hooks/useCellFeedback";
import type { Worker } from "../types";

const workers: Worker[] = Array.from({ length: 3 }, (_, i) => ({
  id: i + 1,
  name: `Çalışan ${i + 1}`,
  daily_wage: 600,
  worker_type: "GUNLUK" as const,
  is_active: true,
  created_at: "2026-01-01",
}));

const MONTH = new Date(2026, 4, 1); // Mayıs 2026

const attendance = (date: string, workerId: number, status: "FULL" | "HALF" | "ABSENT") => ({
  id: workerId,
  worker_id: workerId,
  date,
  status,
});

/** jsdom `navigator.vibrate` sağlamıyor; dokunmatik geri bildirim ölçülmeli. */
const vibrate = vi.fn(() => true);
const stubVibrate = () => {
  Object.defineProperty(window.navigator, "vibrate", { value: vibrate, configurable: true });
};

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  executeTransaction.mockReset().mockResolvedValue(undefined);
  // Takvim açılışta ayın verisini yeniden çeker; store'u yansıtmayan bir mock
  // testteki tohum puantajları sessizce siler.
  fetchQuery
    .mockReset()
    .mockImplementation(() =>
      Promise.resolve().then(() => useAttendanceStore.getState().attendances),
    );
  vibrate.mockClear();
  stubVibrate();

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
  useCellFeedbackStore.setState({ entries: {} });
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

const renderCalendar = () => render(<CalendarView currentDate={MONTH} onDayClick={vi.fn()} />);

/** Yalnız durum hücresi; "geri al" düğmesi de `Çalışan 1, …` ile başlıyor. */
const CELL_1 = /^Çalışan 1, 10 Mayıs Pazar: (Tam|Yarım|Yok|kayıt yok)$/;
const UNDO_LABEL = "Çalışan 1, 10 Mayıs Pazar değişikliğini geri al";

/** Hücrenin parlama katmanı; ikon değil, `aria-hidden` olan yeşil/gri/kırmızı kaplama. */
const flashLayer = () =>
  screen.getByLabelText(CELL_1).querySelector<HTMLElement>('span[aria-hidden="true"]');

const tap = async (label: string) => {
  await act(async () => {
    fireEvent.click(screen.getByLabelText(label));
  });
};

describe("puantaj hücresi geri bildirimi", () => {
  it("dokunuşta ekranı kapatan toast yerine titreşim üretir", async () => {
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");

    expect(vibrate).toHaveBeenCalledWith(15);
    // Kalabalık toast yerine tek hücre: bildirim listesine hiçbir şey girmez.
    expect(useToastStore.getState().toasts).toHaveLength(0);
  });

  it("başarılı dokunuşta hücre yeşil parlar", async () => {
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");

    const flash = flashLayer();
    expect(flash).toBeInTheDocument();
    expect(flash?.className).toContain("bg-ok/45");
    // `prefers-reduced-motion` altında da görünür kalır: statik renk değişimi.
    expect(flash?.className).toContain("motion-reduce:animate-none");
  });

  it("temizlemede hücre gri parlar", async () => {
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    // FULL → HALF → ABSENT → boş
    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");
    await tap("Çalışan 1, 10 Mayıs Pazar: Yarım");
    await tap("Çalışan 1, 10 Mayıs Pazar: Yok");

    expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: kayıt yok")).toBeInTheDocument();
    expect(flashLayer()?.className).toContain("bg-muted-foreground/35");
  });

  it("parlama söner ama geri al düğmesi üç saniye daha kalır", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
      renderCalendar();

      await tap("Çalışan 1, 10 Mayıs Pazar: Tam");
      expect(flashLayer()).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(FLASH_WINDOW);
      });
      expect(flashLayer()).toBeNull();
      expect(screen.getByLabelText(UNDO_LABEL)).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(UNDO_WINDOW);
      });
      expect(screen.queryByLabelText(UNDO_LABEL)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("hücredeki geri al düğmesi durumu eski haline döndürür", async () => {
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");
    expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Yarım")).toBeInTheDocument();

    await tap(UNDO_LABEL);

    await waitFor(() =>
      expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Tam")).toBeInTheDocument(),
    );
    // Zincir kendini kapatır: düğme bir daha çıkmaz.
    expect(screen.queryByLabelText(UNDO_LABEL)).toBeNull();
  });

  it("ardışık dokunuşlarda geri alma zincirin ilk durumuna döner", async () => {
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");
    await tap("Çalışan 1, 10 Mayıs Pazar: Yarım");
    // Tam → Yarım → Yok; tek geri al düğmesi iki değişikliği birden çözer.
    expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Yok")).toBeInTheDocument();

    await tap(UNDO_LABEL);

    await waitFor(() =>
      expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Tam")).toBeInTheDocument(),
    );
  });

  it("geri al düğmesi dokunuşu puantaj döngüsünü ilerletmez", async () => {
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");
    await tap(UNDO_LABEL);

    // Düğme hücrenin üstünde; tıklamak yalnız geri alma olmalı.
    await waitFor(() =>
      expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Tam")).toBeInTheDocument(),
    );
  });

  it("yazma hatasında kırmızı parlar, titreşir ve hata bildirimi gösterir", async () => {
    executeTransaction.mockRejectedValueOnce(new Error("veritabanı kapalı"));
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");

    expect(flashLayer()?.className).toContain("bg-bad/45");
    expect(vibrate).toHaveBeenCalledWith([40, 60, 40]);
    expect(useToastStore.getState().toasts[0]).toMatchObject({
      type: "error",
      message: expect.stringContaining("veritabanı kapalı"),
    });
  });

  it("titreşimi desteklemeyen cihazda hata fırlatmaz", async () => {
    // @ts-expect-error — jsdom'da varsayılan olarak yok, bilerek siliniyor.
    delete window.navigator.vibrate;
    useAttendanceStore.setState({ attendances: [attendance("2026-05-10", 1, "FULL")] });
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: Tam");

    expect(screen.getByLabelText("Çalışan 1, 10 Mayıs Pazar: Yarım")).toBeInTheDocument();
  });

  it("bir hücreye dokunmak diğer hücrelerde geri bildirim bırakmaz", async () => {
    renderCalendar();

    await tap("Çalışan 1, 10 Mayıs Pazar: kayıt yok");

    expect(screen.getByLabelText(UNDO_LABEL)).toBeInTheDocument();
    expect(screen.queryByLabelText("Çalışan 2, 10 Mayıs Pazar değişikliğini geri al")).toBeNull();
  });
});

describe("takvim etiketleri", () => {
  it("lejantta üç durum vardır, izin yoktur", () => {
    renderCalendar();
    const legend = screen.getByText("Yarım").closest("div");
    expect(legend?.textContent).toContain("Tam");
    expect(legend?.textContent).toContain("Yok");
    expect(legend?.textContent).not.toContain("İzin");
  });

  it("palet yerine üretim yazıyordur", () => {
    renderCalendar();
    // Üstteki istatistik kartı ve sağ sütun başlığı.
    expect(screen.getAllByText("Üretim")).toHaveLength(2);
    expect(screen.getByLabelText(/Sağ sütun: Üretim/)).toBeInTheDocument();
  });
});
