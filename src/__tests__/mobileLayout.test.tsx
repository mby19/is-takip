/**
 * Mobil kullanılabilirlik: takvim 360px'te nasıl davranmalı.
 *
 * Buradaki ölçütler sayısal değil, sözleşmeseldir: "hücre 44px'ten geniş"
 * demek `min-width: 2.75rem` demektir (44/16). jsdom CSS uygulamaz, bu yüzden
 * ölçüt inline `style` ve `class` üzerinden okunur — tarayıcıda hesaplanan
 * değerin kaynağı budur.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, within } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();
const getDb = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  fetchQuery: (...args: unknown[]) => fetchQuery(...args),
  executeTransaction: vi.fn(),
  getDb: (...args: unknown[]) => getDb(...args),
  getTriggerSetupError: () => null,
}));
vi.mock("../lib/appLock", () => ({ isLockEnabled: () => false }));
import App from "../App";
import { CalendarView } from "../components/CalendarView";
import { useWorkerStore } from "../stores/workerStore";
import { useAttendanceStore } from "../stores/attendanceStore";
import { useMetricsStore } from "../stores/metricsStore";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import type { Worker } from "../types";

const SOURCE_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readSource = (file: string) => readFileSync(resolve(SOURCE_DIR, file), "utf8");

/** 360px ekranı: küçük telefonların en yaygın genişliği. */
const NARROW_PHONE = 360;

const workers: Worker[] = Array.from({ length: 8 }, (_, i) => ({
  id: i + 1,
  name: `Çalışan ${i + 1}`,
  daily_wage: 600,
  worker_type: "GUNLUK" as const,
  is_active: true,
  created_at: "2026-01-01",
}));

/** inline `min-width: 2.75rem` → px. Tarayıcının yaptığı hesabın yerine geçer. */
const remToPx = (rem: string) => Number.parseFloat(rem) * 16;

const monthStart = new Date(2026, 4, 1); // Mayıs 2026

beforeEach(() => {
  getDb.mockReset().mockResolvedValue({});
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
});

afterEach(() => {
  vi.unstubAllGlobals();
  cleanup();
});

const renderCalendar = () =>
  render(<CalendarView currentDate={monthStart} onDayClick={vi.fn()} onWorkerClick={vi.fn()} />);

/**
 * Hücre artık bir sarmalayıcı `div` içinde: geri al düğmesi hücrenin köşesine
 * ayrı bir kardeş olarak yerleşiyor. Esnek ölçüler (`flex`/`min-width`) flex
 * çocuğu olan sarmalayıcıda duruyor, düğmede değil.
 */
const cellBox = (cell: HTMLElement) => cell.parentElement as HTMLElement;

describe("takvim — yatay taşma", () => {
  it("puantaj hücresi 44px dokunma hedefinden dar değil", () => {
    renderCalendar();
    const cell = screen.getByLabelText("Çalışan 1, 1 Mayıs Cuma: kayıt yok");
    const minWidth = cellBox(cell).style.minWidth;
    expect(remToPx(minWidth)).toBeGreaterThanOrEqual(44);
  });

  /**
   * Sekiz kişilik ekip 360px'i geçer — bu kasıtlı. Kullanıcının satırları
   * "sığdırmak" için küçültmesi gerekmiyor; yatay kaydırması yeterli.
   * Ölçüm render edilen satırdan gelir (jsdom CSS uygulamaz, bu yüzden taban
   * ölçüleri inline `style` üzerinden okunur).
   */
  it("360px ekranda 8 kişilik tablo yatay taşar", () => {
    renderCalendar();
    const day = screen.getByLabelText("1 Mayıs Cuma gününü aç");
    const side = screen.getByLabelText("1 Mayıs Cuma gününün verilerini düzenle");
    const first = screen.getByLabelText("Çalışan 1, 1 Mayıs Cuma: kayıt yok");

    const cells = screen.getAllByLabelText(/Çalışan \d+, 1 Mayıs Cuma: kayıt yok$/);
    const total =
      remToPx((day as HTMLElement).style.width) +
      remToPx((side as HTMLElement).style.width) +
      remToPx(cellBox(first).style.minWidth) * cells.length;

    expect(cells).toHaveLength(workers.length);
    expect(total).toBeGreaterThan(NARROW_PHONE);
  });

  it("gün sütunu yatay kaydırmada sabit kalır (sticky left)", () => {
    renderCalendar();
    const dayCell = screen.getByLabelText("1 Mayıs Cuma gününü aç");
    expect(dayCell.className).toContain("sticky");
    expect(dayCell.className).toContain("left-0");
  });

  it("sağ ölçü sütunu da sabittir — kaydırmada kaybolmaz", () => {
    renderCalendar();
    const sideCell = screen.getByLabelText("1 Mayıs Cuma gününün verilerini düzenle");
    expect(sideCell.className).toContain("sticky");
    expect(sideCell.className).toContain("right-0");
  });

  it("gövde kaydırma kapsayıcısı dokunma jestini ayırır", () => {
    const { container } = renderCalendar();
    // Başlık da `h-scroll-touch` taşır ama `overflow-hidden`; yatay kaydıran
    // yalnızca gövdedir.
    const scroller = container.querySelector(".h-scroll-touch.overflow-auto");
    expect(scroller).not.toBeNull();
  });

  it("başlık satırı gövdeyle aynı yatay kaydırmayı paylaşır", () => {
    // Başlık `overflow-hidden`: yalnızca gövdenin scrollLeft'i kopyalanır.
    // İkisi ayrı kaydırılabilir olsaydı başlık kaydırma sırasında geride kalırdı.
    const { container } = renderCalendar();
    const header = container.querySelector(".h-scroll-touch.overflow-hidden");
    expect(header).not.toBeNull();
  });
});

describe("takvim — dokunma hedefleri", () => {
  it("her etkileşimli hücre 44px sınıfını taşır", () => {
    renderCalendar();
    const cells = screen.getAllByLabelText(/kayıt yok$/);
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.className).toContain("tap-target");
  });

  it("gün ve sağ sütun düğmeleri de dokunma hedefidir", () => {
    renderCalendar();
    expect(screen.getByLabelText("1 Mayıs Cuma gününü aç").className).toContain("tap-target");
    expect(screen.getByLabelText("1 Mayıs Cuma gününün verilerini düzenle").className).toContain(
      "tap-target",
    );
  });

  it("yoğunluk düğmesi 44px sınıfını taşır", () => {
    renderCalendar();
    expect(screen.getByLabelText(/Satır yüksekliği/).className).toContain("tap-target");
  });

  it("sütun başlığı düğmeleri de dokunma hedefidir", () => {
    renderCalendar();
    expect(screen.getByTitle("Çalışan 1").className).toContain("tap-target");
  });
});

describe("takvim — saha paletiyle birlikte", () => {
  /**
   * Saha (güneş) paleti güneşte okunabilirlik için kontrastı yükseltir;
   * bizim işimiz dokunma hedefini aynı ölçekte tutmak. Çip görsel olarak 28px
   * kalır ama DOKUNMA hedefi hücredir ve 44px'ten geniş olmaz.
   */
  it("durum çipi hücrenin içinde kalır, hedefi daraltmaz", () => {
    renderCalendar();
    const cell = screen.getByLabelText("Çalışan 1, 1 Mayıs Cuma: kayıt yok");
    const minWidth = cellBox(cell).style.minWidth;
    expect(remToPx(minWidth)).toBeGreaterThanOrEqual(44);
    expect(cell.className).toContain("tap-target");
  });
});

describe("prefers-reduced-motion", () => {
  const stubMatchMedia = (reduce: boolean) =>
    vi.stubGlobal(
      "matchMedia",
      vi.fn((query: string) => ({
        matches: reduce && query.includes("prefers-reduced-motion"),
        media: query,
        addEventListener() {},
        removeEventListener() {},
        addListener() {},
        removeListener() {},
        onchange: null,
        dispatchEvent: () => false,
      })),
    );

  const stubScrollIntoView = () => {
    const spy = vi.fn();
    // jsdom scrollIntoView uygulamıyor; çağrının ARGÜMANI ölçülüyor.
    Element.prototype.scrollIntoView = spy;
    return spy;
  };

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("bugünün satırına kayarken animasyon uygulanmaz", async () => {
    stubMatchMedia(true);
    const scrollIntoView = stubScrollIntoView();

    // Bugünün AYINDA olması şart: kaydırma yalnızca o ayda tetiklenir.
    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

    render(<CalendarView currentDate={thisMonth} onDayClick={vi.fn()} />);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "auto" }));
  });

  it("normal kullanıcıda kayma animasyonu korunur", async () => {
    stubMatchMedia(false);
    const scrollIntoView = stubScrollIntoView();

    const now = new Date();
    const thisMonth = new Date(now.getFullYear(), now.getMonth(), 15);

    render(<CalendarView currentDate={thisMonth} onDayClick={vi.fn()} />);
    await act(async () => {
      vi.advanceTimersByTime(400);
    });

    expect(scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ behavior: "smooth" }));
  });
});

describe("dikey kullanım — görünür alan", () => {
  it("uygulama kabuğu 100vh değil 100dvh kullanır", () => {
    // 100vh mobil tarayıcıda adres/jest çubuğu yüksekliğini içerir; alt
    // navigasyon ekranın dışına taşar ve son satır gizlenir.
    const app = readSource("App.tsx");
    expect(app).not.toMatch(/h-screen/);
    expect(app.match(/h-dvh/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it("alt navigasyon güvenli alanı kullanır", () => {
    const app = readSource("App.tsx");
    expect(app).toContain("pb-safe-nav");
  });
});

describe("alt navigasyon", () => {
  it("dört sekmenin her biri dokunma hedefi taşır", async () => {
    render(<App />);
    const nav = await screen.findByLabelText("Ana menü");

    for (const label of ["Takvim", "Kişiler", "Ay Sonu", "Ayarlar"]) {
      const tab = within(nav).getByRole("button", { name: label });
      // `tap-target` genişliği her cihazda 44px'te tutar; sınıfı taşıyan her
      // sekme bu tabanı alır.
      expect(tab.className).toContain("tap-target");
    }
  });

  it("ikon üstte, etiket altta — dört sekme yan yana sığar", async () => {
    render(<App />);
    const nav = await screen.findByLabelText("Ana menü");
    const tab = within(nav).getByRole("button", { name: "Ay Sonu" });

    // Dikey düzen olmadan dört sekme 360px'te sığmazdı: ikon+etiket yan yana
    // her sekmeyi ~90px'e çıkarıyordu (4×90 + px-4 = 392px).
    expect(tab.className).toContain("flex-col");
    expect(within(tab).getByText("Ay Sonu")).toBeInTheDocument();
  });

  it("alt navigasyon güvenli alanı kullanır", async () => {
    render(<App />);
    const nav = await screen.findByLabelText("Ana menü");
    // Çentikli cihazda jest çubuğu sekmelerin üstüne binmesin.
    expect(nav.className).toContain("pb-safe-nav");
  });
});
