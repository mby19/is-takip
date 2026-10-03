import { describe, expect, it, vi, beforeEach } from "vitest";
import type { Worker, Payment } from "../types";
import type { WorkerStats } from "../utils/calculations";
import { exportWorkerReport } from "../lib/workerReport";

/** Bir `new JsPDF()` örneğini temsil eden sahte belge. */
interface FakeDoc {
  texts: string[];
  tables: Record<string, unknown>[];
  saved: string | null;
  fonts: string[];
  lastAutoTable: { finalY: number } | false;
  setFontSize: (size: number) => void;
  setFont: (name: string, style?: string) => void;
  text: (text: string, x: number, y: number) => void;
  splitTextToSize: (text: string, maxWidth: number) => string[];
  output: (type: "arraybuffer") => ArrayBuffer;
  save: (name: string) => void;
}

/** applyPlugin'in takacağı üyelerin okunduğu prototip. */
const proto: Record<string, unknown> = {};
let current: FakeDoc;

class FakeJsPDF {
  static API = proto;
  constructor() {
    current = Object.create(proto) as FakeDoc;
    current.texts = [];
    current.tables = [];
    current.saved = null;
    current.fonts = [];
    current.lastAutoTable = false;
    current.setFontSize = () => {};
    current.setFont = (name: string, style?: string) => {
      current.fonts.push(style ? `${name}/${style}` : name);
    };
    current.text = (text: string) => {
      current.texts.push(text);
    };
    current.splitTextToSize = (text: string, maxWidth: number) => {
      // jsPDF gerçekte satırı keser; testte sarma davranışı yeterli.
      const perLine = Math.max(1, Math.floor(maxWidth / 4));
      const out: string[] = [];
      for (let i = 0; i < text.length; i += perLine) out.push(text.slice(i, i + perLine));
      return out;
    };
    current.output = () => new ArrayBuffer(8);
    current.save = (name: string) => {
      current.saved = name;
    };
    return current;
  }
}

vi.mock("jspdf", () => ({ default: FakeJsPDF }));

/**
 * jspdf-autotable'ın `applyPlugin` davranışının minimal karşılığı: metotları
 * `jsPDF.API` (yani prototip) üzerine koyar. Tabloyu gerçekten çizmez, yalnızca
 * çağrı argümanlarını kaydeder ve `lastAutoTable`'ı günceller.
 */
const applyPlugin = vi.fn((JsPDF: { API: Record<string, unknown> }) => {
  JsPDF.API.autoTable = function (options: Record<string, unknown>) {
    current.tables.push(options);
    current.lastAutoTable = { finalY: 120 };
  };
  JsPDF.API.lastAutoTable = false;
});

vi.mock("jspdf-autotable", () => ({ applyPlugin }));

const isTauri = vi.fn(() => false);

vi.mock("../lib/tauri", () => ({
  isTauri: () => isTauri(),
  saveFileToDownloads: vi.fn(),
  saveFileWithPicker: vi.fn(),
}));

const worker: Worker = {
  id: 3,
  name: "Şükrü Çağlar",
  daily_wage: 900,
  worker_type: "GUNLUK",
  created_at: "2026-01-01",
  is_active: true,
};

const stats: WorkerStats = {
  totalEarnedInMonth: 18000,
  paidInMonth: 5000,
  periodBalance: 13000,
  totalEarnedAllTime: 54000,
  totalPaid: 20000,
  balance: 34000,
  dailyBreakdown: [
    { date: "2026-09-01", dayName: "Pzt", dayNum: "01", status: "FULL", earned: 900 },
    { date: "2026-09-02", dayName: "Sal", dayNum: "02", status: "HALF", earned: 450 },
  ],
  fullDays: 1,
  halfDays: 1,
  absentDays: 0,
  holidayDays: 0,
};

const payments: Payment[] = [
  { id: 1, worker_id: 3, amount: 2500, date: "2026-09-10", description: "Nakit avans" },
];

const month = new Date(2026, 8, 15);

/** Belgeye yazılan tüm metinler (başlıklar + tablo hücreleri). */
const allText = () =>
  [...current.texts, ...current.tables.map((t) => JSON.stringify(t))].join("\n");

beforeEach(() => {
  // `new JsPDF()` çağrılmayan testlerde önceki belgenin durumu sızmasın.
  current = { saved: null } as unknown as FakeDoc;
  for (const key of Object.keys(proto)) delete proto[key];
  applyPlugin.mockImplementation((JsPDF: { API: Record<string, unknown> }) => {
    JsPDF.API.autoTable = function (options: Record<string, unknown>) {
      current.tables.push(options);
      current.lastAutoTable = { finalY: 120 };
    };
    JsPDF.API.lastAutoTable = false;
  });
  isTauri.mockReturnValue(false);
});

describe("exportWorkerReport", () => {
  it("Türkçe karakterleri WinAnsi'e düşürebilir hâle getirir ve belgede uyarır", async () => {
    const saved = await exportWorkerReport(worker, month, stats, payments);

    expect(saved).toBe("Şükrü_Çağlar_2026-09_Raporu.pdf");
    // Kalıcı harfler aynen, cp1252 dışı olanlar sadeleştirilmiş hâlde.
    expect(current.texts[0]).toBe("Aylik Çalisma ve Hakedis Dökümü");
    expect(current.texts.some((x) => x.startsWith("Çalisan: Sükrü Çaglar"))).toBe(true);
    // Belgeye hiçbir cp1252 dışı karakter sızmaz.
    expect(allText()).not.toMatch(/[ğışİĞŞ₺]/);
    // Dönüşüm yapıldığı için uyarı satırı belgeye girdi.
    expect(current.texts.some((x) => x.startsWith("Not:"))).toBe(true);
  });

  it("para birimini yalnızca TL suffix'i olarak yazar", async () => {
    await exportWorkerReport(worker, month, stats, payments);

    expect(current.texts.some((x) => x.includes("18.000 TL"))).toBe(true);
    expect(allText()).not.toContain("₺");
  });

  it("eklenti yüklenemezse anlamlı hata verir ve dosya kaydetmez", async () => {
    applyPlugin.mockImplementationOnce(() => {
      throw new Error("plugin yok");
    });

    await expect(exportWorkerReport(worker, month, stats, payments)).rejects.toThrow(/plugin yok/);
    expect(current.saved).toBeNull();
  });

  it("autoTable yüzeyi yoksa jspdf-autotable hatası verir", async () => {
    applyPlugin.mockImplementationOnce((JsPDF: { API: Record<string, unknown> }) => {
      // applyPlugin çalışır ama autoTable'ı takmaz (yarım yükleme).
      JsPDF.API.lastAutoTable = false;
    });

    await expect(exportWorkerReport(worker, month, stats, payments)).rejects.toThrow(
      /jspdf-autotable/,
    );
    expect(current.saved).toBeNull();
  });

  it("lastAutoTable false ise tablo sonrası yedeğe düşer", async () => {
    applyPlugin.mockImplementationOnce((JsPDF: { API: Record<string, unknown> }) => {
      JsPDF.API.autoTable = function (options: Record<string, unknown>) {
        current.tables.push(options);
        // lastAutoTable güncellenmiyor → false kalıyor.
      };
      JsPDF.API.lastAutoTable = false;
    });

    await exportWorkerReport(worker, month, stats, payments);

    // Ödeme tablosu 1. tablonun bitişi olan 68'e göre konumlanır, 120'ye göre değil.
    expect(current.tables[1]?.startY).toBe(88);
  });
});
