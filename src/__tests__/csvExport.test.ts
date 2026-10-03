import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CSV_BOM,
  buildBusinessSummaryCsv,
  buildExportCsv,
  buildWorkersCsv,
  escapeCsvField,
  exportFileName,
  formatCsvMoney,
  formatQuantity,
  toCsv,
  writeCsvFile,
  type ExportInput,
} from "../lib/csvExport";
import { calculatePeriodEarnings, buildPeriodIndex } from "../lib/periodStats";
import type { Attendance, DailyMetric, Payment, Worker, WorkerType } from "../types";

const isTauri = vi.fn(() => false);
const saveFileWithPicker = vi.fn();
const saveTextFileToDownloads = vi.fn();

vi.mock("../lib/tauri", () => ({
  isTauri: () => isTauri(),
  saveFileWithPicker: (name: string, data: unknown) => saveFileWithPicker(name, data),
  saveTextFileToDownloads: (name: string, data: unknown) => saveTextFileToDownloads(name, data),
}));

const worker = (id: number, name: string, type: WorkerType = "GUNLUK", wage = 1000): Worker => ({
  id,
  name,
  daily_wage: wage,
  worker_type: type,
  is_active: true,
  created_at: "2026-01-01",
});

const att = (
  workerId: number,
  date: string,
  status: Attendance["status"] = "FULL",
): Attendance => ({
  id: 0,
  worker_id: workerId,
  date,
  status,
});

const metric = (date: string, earned: number, expenses = 0, production = 100): DailyMetric => ({
  id: 0,
  date,
  production_amount: production,
  total_earned: earned,
  extra_expenses: expenses,
  is_holiday: false,
});

const payment = (workerId: number, amount: number, date: string, description = ""): Payment => ({
  id: 0,
  worker_id: workerId,
  amount,
  date,
  description,
});

const baseInput = (over: Partial<ExportInput> = {}): ExportInput => ({
  workers: [],
  attendance: [],
  metrics: [],
  payments: [],
  rateHistory: [],
  scope: { kind: "all" },
  ...over,
});

/** BOM düşülmüş gövdeyi satırlara böler. */
const lines = (csv: string): string[] => csv.slice(CSV_BOM.length).split("\r\n");

/**
 * RFC 4180'a göre alan sayar. `split(";")` yeterli DEĞİL: tırnak içindeki
 * ayraç alan ayırmaz — testin kendisi de bu tuzağa düşmemeli.
 */
const countFields = (row: string): number => {
  let fields = 1;
  let quoted = false;
  for (let i = 0; i < row.length; i++) {
    const ch = row[i];
    if (ch === '"') {
      if (quoted && row[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (ch === ";" && !quoted) fields++;
  }
  return fields;
};

beforeEach(() => {
  isTauri.mockReturnValue(false);
  saveFileWithPicker.mockReset();
  saveTextFileToDownloads.mockReset();
});

describe("biçim kuralları — Türkiye / Excel", () => {
  it("ayraç noktalı virgül, satır sonu CRLF", () => {
    const csv = toCsv(["A", "B"], [["1", "2"]]);
    expect(csv).toBe("A;B\r\n1;2");
  });

  it("dosya UTF-8 BOM ile başlar", () => {
    expect(buildExportCsv(baseInput()).charCodeAt(0)).toBe(0xfeff);
    expect(CSV_BOM).toBe("﻿");
  });

  it("para nokta ondalıklı, binlik ayracı ve negatif sıfır yok", () => {
    expect(formatCsvMoney(1234.5)).toBe("1234.50");
    expect(formatCsvMoney(1234567.891)).toBe("1234567.89");
    expect(formatCsvMoney(-0.001)).toBe("0.00");
    expect(formatCsvMoney(-0)).toBe("0.00");
    expect(Object.is(Number(formatCsvMoney(-0.001)), -0)).toBe(false);
    expect(formatCsvMoney(-1500)).toBe("-1500.00");
  });

  it("miktar sondaki gereksiz sıfırları atar", () => {
    expect(formatQuantity(12)).toBe("12");
    expect(formatQuantity(12.5)).toBe("12.5");
    expect(formatQuantity(-0.004)).toBe("0");
  });

  it("Türkçe karakterler bozulmadan çıkar", () => {
    const csv = buildWorkersCsv([worker(1, "İbrahim Şükrü Çağlayan", "ORTAK", 0)]);
    expect(csv).toContain("İbrahim Şükrü Çağlayan");
    expect(csv).toContain("Ortak");
  });
});

describe("RFC 4180 kaçışı", () => {
  it("ayraç, tırnak ve satır sonu içeren alanı tırnaklar", () => {
    expect(escapeCsvField("Ali;Veli")).toBe('"Ali;Veli"');
    expect(escapeCsvField('Ali "Kaya"')).toBe('"Ali ""Kaya"""');
    expect(escapeCsvField("Ali\r\nVeli")).toBe('"Ali\r\nVeli"');
  });

  it("kaçış gerektirmeyen alana dokunmaz", () => {
    expect(escapeCsvField("Ali Veli")).toBe("Ali Veli");
  });

  it("isimde ayraç ve tırnak olsa bile sütun sayısı kaymaz", () => {
    const csv = buildExportCsv(baseInput({ workers: [worker(1, 'Ayşe; "Yılmaz"')] }));
    const [, header, data] = lines(csv);
    expect(countFields(header!)).toBe(5);
    expect(countFields(data!)).toBe(5);
    expect(data).toContain('"Ayşe; ""Yılmaz"""');
    expect(buildWorkersCsv([worker(1, 'Ayşe; "Yılmaz"')])).toContain('"Ayşe; ""Yılmaz"""');
  });

  it("başlıktaki noktalı virgül de kaçırılır", () => {
    expect(toCsv(["A;B"], [])).toBe('"A;B"');
  });
});

describe("kapsam", () => {
  const pool = [worker(1, "Ali"), worker(2, "Veli", "ORTAK", 0)];

  it("tek ay kapsamı başka aya ait puantaj ve ödemeyi dışarıda bırakır", () => {
    const csv = buildExportCsv(
      baseInput({
        workers: pool,
        attendance: [att(1, "2026-05-04"), att(1, "2026-06-04")],
        payments: [payment(1, 500, "2026-05-10"), payment(1, 700, "2026-06-10")],
        scope: { kind: "month", period: "2026-05" },
      }),
    );
    expect(csv).toContain("2026-05-04");
    expect(csv).not.toContain("2026-06-04");
    expect(csv).toContain("500.00");
    expect(csv).not.toContain("700.00");
  });

  it("tek çalışan kapsamı başka çalışanın kayıtlarını içermez", () => {
    const csv = buildExportCsv(
      baseInput({
        workers: pool,
        attendance: [att(1, "2026-05-04"), att(2, "2026-05-04")],
        scope: { kind: "worker", workerId: 1 },
      }),
    );
    expect(csv).toContain("Ali");
    expect(csv).not.toContain("Veli");
  });

  it("tüm veri kapsamı her iki çalışanı da içerir", () => {
    const csv = buildExportCsv(baseInput({ workers: pool }));
    expect(csv).toContain("Ali");
    expect(csv).toContain("Veli");
  });

  it("dosya adı kapsamı yansıtır ve isimdeki boşluk alt çizgiye döner", () => {
    expect(exportFileName({ kind: "all" })).toBe("is_takip_tum_veriler.csv");
    expect(exportFileName({ kind: "month", period: "2026-05" })).toBe("is_takip_2026-05.csv");
    expect(exportFileName({ kind: "worker", workerId: 1 }, "Şükrü Çağlar")).toBe(
      "is_takip_Şükrü_Çağlar.csv",
    );
  });
});

describe("tutarlar hesap katmanından gelir", () => {
  const pool = [worker(1, "Ali"), worker(2, "Veli", "ORTAK", 0), worker(3, "Ayşe", "ORTAK", 0)];
  const attendance = [att(1, "2026-05-04"), att(2, "2026-05-04"), att(3, "2026-05-04")];
  const metrics = [metric("2026-05-04", 5000, 0, 20)];

  it("dökümdeki hakediş hesap katmanının verdiğiyle birebir aynıdır", () => {
    const periodEarnings = calculatePeriodEarnings(
      pool,
      new Date(2026, 4, 1),
      buildPeriodIndex(attendance, metrics),
      [],
    );
    const csv = buildExportCsv(
      baseInput({
        workers: pool,
        attendance,
        metrics,
        scope: { kind: "month", period: "2026-05" },
      }),
    );
    const body = csv.slice(CSV_BOM.length);

    expect(periodEarnings.earned.get(1)).toBe(1000);
    for (const earned of [periodEarnings.earned.get(1)!, periodEarnings.earned.get(2)!]) {
      expect(body).toContain(formatCsvMoney(earned));
    }
    // ORTAK'lar kârı paylaşır: (5000 − 1000) / 2 = 2000.
    expect(periodEarnings.earned.get(2)).toBe(2000);
    expect(body).toContain("2000.00");
  });

  it("ortak olmayan çalışanın ortak payı 0'dır", () => {
    const csv = buildExportCsv(
      baseInput({
        workers: pool,
        attendance,
        metrics,
        scope: { kind: "month", period: "2026-05" },
      }),
    );
    const summary = csv.slice(CSV_BOM.length).split("Ay Sonu Dökümü\r\n")[1]?.split("\r\n\r\n")[0];
    expect(summary).toBeDefined();
    const aliRow = summary!.split("\r\n").find((l) => l.startsWith("Ali"))!;
    expect(aliRow.split(";")[5]).toBe("0.00");
  });
});

describe("undistributed (K3) CSV'de", () => {
  it("zarar döneminde dağıtılmayan zarar ayrı satır olarak çıkar", () => {
    const pool = [worker(1, "Ali", "GUNLUK", 1000), worker(2, "Veli", "ORTAK", 0)];
    const attendance = [att(1, "2026-05-04"), att(2, "2026-05-04")];
    // Ciro 100, gider 300, yevmiye 1000 → net kâr −1200; zarar ortaklara dağıtılmaz.
    const metrics = [metric("2026-05-04", 100, 300, 1)];

    const csv = buildExportCsv(
      baseInput({
        workers: pool,
        attendance,
        metrics,
        scope: { kind: "month", period: "2026-05" },
      }),
    );
    const business = csv.slice(CSV_BOM.length).split("İşletme Özeti\r\n")[1]!;
    expect(business).toContain("undistributed");
    expect(business).toContain("2026-05");
    expect(business).toContain("-1200.00");

    const periodEarnings = calculatePeriodEarnings(
      pool,
      new Date(2026, 4, 1),
      buildPeriodIndex(attendance, metrics),
      [],
    );
    expect(periodEarnings.undistributed).toBe(-1200);
    expect(business).toContain(formatCsvMoney(periodEarnings.undistributed));
  });

  it("başlık hem kârı hem zararı doğru adlandırır", () => {
    const csv = buildBusinessSummaryCsv([
      { period: "2026-05", netProfit: 3500, wageCost: 1000, undistributed: 0 },
    ]);
    expect(csv).toBe(
      "Dönem;Net Kâr;Yevmiye Maliyeti;Dağıtılmayan Kâr/Zarar (undistributed)\r\n2026-05;3500.00;1000.00;0.00",
    );
  });

  it("ortak yokken oluşan kâr da 'Dağıtılmayan Kâr/Zarar' sütununa yazılır", () => {
    const pool = [worker(1, "Ali", "GUNLUK", 1000)];
    const attendance = [att(1, "2026-05-04")];
    const metrics = [metric("2026-05-04", 5000, 0, 0)];
    const csv = buildExportCsv(
      baseInput({
        workers: pool,
        attendance,
        metrics,
        scope: { kind: "month", period: "2026-05" },
      }),
    );
    const business = csv.slice(CSV_BOM.length).split("İşletme Özeti\r\n")[1]!;
    // Ciro 5000 − yevmiye 1000 = 4000 kâr; ortak yok → tamamı dağıtılmaz.
    expect(business).toContain("4000.00");
  });

  it("işletme özeti dönem başına TEK satırdır — çalışan sayısıyla çarpılmaz", () => {
    const pool = [worker(1, "Ali", "GUNLUK", 1000), worker(2, "Veli", "ORTAK", 0)];
    const attendance = [att(1, "2026-05-04"), att(2, "2026-05-04")];
    const metrics = [metric("2026-05-04", 0, 0, 0)];
    const csv = buildExportCsv(
      baseInput({
        workers: pool,
        attendance,
        metrics,
        scope: { kind: "month", period: "2026-05" },
      }),
    );
    const business = csv.slice(CSV_BOM.length).split("İşletme Özeti\r\n")[1]!;
    expect(business.trim().split("\r\n").filter(Boolean).length).toBe(2); // başlık + 1 satır
  });
});

describe("writeCsvFile", () => {
  it("web'de Blob indirmesi yapar ve dosya adını döndürür", async () => {
    const createObjectURL = vi.fn(() => "blob:csv");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { ...URL, createObjectURL, revokeObjectURL });

    const click = vi.fn();
    const createElement = vi.spyOn(document, "createElement");
    createElement.mockImplementation((tag: string) => {
      const el = document.createElementNS("http://www.w3.org/1999/xhtml", tag) as HTMLAnchorElement;
      if (tag === "a") el.click = click;
      return el;
    });

    const saved = await writeCsvFile("is_takip.csv", "a;b");

    expect(saved).toBe("is_takip.csv");
    expect(click).toHaveBeenCalledTimes(1);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:csv");
    expect(saveFileWithPicker).not.toHaveBeenCalled();

    createElement.mockRestore();
    vi.unstubAllGlobals();
  });

  it("Tauri'de kaydetme diyaloğunu kullanır", async () => {
    isTauri.mockReturnValue(true);
    saveFileWithPicker.mockResolvedValue("/home/kullanici/is_takip.csv");

    const saved = await writeCsvFile("is_takip.csv", "a;b");

    expect(saved).toBe("/home/kullanici/is_takip.csv");
    expect(saveFileWithPicker).toHaveBeenCalledWith("is_takip.csv", "a;b");
    expect(saveTextFileToDownloads).not.toHaveBeenCalled();
  });

  it("diyalog açılamazsa İndirilenler'e düşer, dosya kaybolmaz", async () => {
    isTauri.mockReturnValue(true);
    saveFileWithPicker.mockRejectedValue(new Error("izin yok"));
    saveTextFileToDownloads.mockResolvedValue(undefined);

    const saved = await writeCsvFile("is_takip.csv", "a;b");

    expect(saved).toBe("is_takip.csv");
    expect(saveTextFileToDownloads).toHaveBeenCalledWith("is_takip.csv", "a;b");
  });

  it("kullanıcı diyaloğu iptal ederse null döner, hiçbir yere yazılmaz", async () => {
    isTauri.mockReturnValue(true);
    saveFileWithPicker.mockResolvedValue(null);

    expect(await writeCsvFile("is_takip.csv", "a;b")).toBeNull();
    expect(saveTextFileToDownloads).not.toHaveBeenCalled();
  });
});
