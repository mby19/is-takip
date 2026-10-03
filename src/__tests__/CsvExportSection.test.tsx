import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import type * as CsvExportModule from "../lib/csvExport";

// `vi.mock` çağrıları hoist edilir; fabrikaların yakaladığı mock'lar bu yüzden
// `vi.hoisted` ile tanımlanmalı, aksi hâlde TDZ hatası verir.
const mocks = vi.hoisted(() => ({
  workerRepository: { findAll: vi.fn() },
  workerRateRepository: { findAll: vi.fn() },
  attendanceRepository: { findAll: vi.fn() },
  metricsRepository: { findAll: vi.fn() },
  paymentRepository: { findAll: vi.fn() },
  auditWrite: vi.fn(),
  writeCsvFile: vi.fn(),
  addToast: vi.fn(),
}));
const {
  workerRepository,
  workerRateRepository,
  attendanceRepository,
  metricsRepository,
  paymentRepository,
  auditWrite,
  writeCsvFile,
  addToast,
} = mocks;

vi.mock("../repositories/workerRepository", () => ({ workerRepository: mocks.workerRepository }));
vi.mock("../repositories/workerRateRepository", () => ({
  workerRateRepository: mocks.workerRateRepository,
}));
vi.mock("../repositories/attendanceRepository", () => ({
  attendanceRepository: mocks.attendanceRepository,
}));
vi.mock("../repositories/metricsRepository", () => ({
  metricsRepository: mocks.metricsRepository,
}));
vi.mock("../repositories/paymentRepository", () => ({
  paymentRepository: mocks.paymentRepository,
}));
vi.mock("../repositories/auditLogRepository", () => ({
  auditLogRepository: { write: (...a: unknown[]) => mocks.auditWrite(...a) },
}));
vi.mock("../lib/csvExport", async (importOriginal) => {
  const actual = await importOriginal<typeof CsvExportModule>();
  return {
    ...actual,
    writeCsvFile: (name: string, csv: string) => mocks.writeCsvFile(name, csv),
  };
});
vi.mock("../stores/toastStore", () => ({
  useToastStore: (sel: (s: { addToast: unknown }) => unknown) => sel({ addToast: mocks.addToast }),
}));
vi.mock("../stores/periodStore", () => ({
  usePeriodStore: (
    sel: (s: { earliestDataPeriod: string | null; fetchClosedPeriods: () => void }) => unknown,
  ) => sel({ earliestDataPeriod: null, fetchClosedPeriods: () => {} }),
}));

import { CsvExportSection } from "../components/CsvExportSection";
import { useWorkerStore } from "../stores/workerStore";

const workers = [
  {
    id: 1,
    name: "İbrahim Şükrü",
    daily_wage: 1000,
    worker_type: "GUNLUK" as const,
    created_at: "2026-01-01",
    is_active: true,
  },
  {
    id: 2,
    name: "Veli; Ortak",
    daily_wage: 0,
    worker_type: "ORTAK" as const,
    created_at: "2026-01-01",
    is_active: false,
  },
];

beforeEach(() => {
  for (const mock of [
    workerRepository,
    workerRateRepository,
    attendanceRepository,
    metricsRepository,
    paymentRepository,
  ]) {
    mock.findAll.mockReset().mockResolvedValue([]);
  }
  auditWrite.mockReset().mockResolvedValue(undefined);
  writeCsvFile.mockReset().mockResolvedValue("is_takip_tum_veriler.csv");
  addToast.mockReset();
  useWorkerStore.setState({ workers, fetchWorkers: async () => {} });
});

afterEach(cleanup);

const exportNow = async () => {
  fireEvent.click(screen.getByRole("button", { name: /CSV İndir/ }));
  await waitFor(() => expect(writeCsvFile).toHaveBeenCalled());
};

describe("CsvExportSection", () => {
  it("tüm veri kapsamında BOM'lu CSV yazar ve dosya adını bildirir", async () => {
    workerRepository.findAll.mockResolvedValue(workers);
    attendanceRepository.findAll.mockResolvedValue([
      { id: 1, worker_id: 1, date: "2026-05-04", status: "FULL" },
    ]);
    metricsRepository.findAll.mockResolvedValue([
      {
        id: 1,
        date: "2026-05-04",
        production_amount: 10,
        total_earned: 5000,
        extra_expenses: 0,
        is_holiday: false,
      },
    ]);

    render(<CsvExportSection />);
    await exportNow();

    const [fileName, csv] = writeCsvFile.mock.calls[0] as [string, string];
    expect(fileName).toBe("is_takip_tum_veriler.csv");
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv).toContain("İbrahim Şükrü");
    // İsimdeki ayraç kaçırılmış olmalı.
    expect(csv).toContain('"Veli; Ortak"');
    expect(addToast).toHaveBeenCalledWith(expect.stringContaining("dışa aktarıldı"), "success");
    expect(auditWrite).toHaveBeenCalledWith(
      "EXPORT",
      "csv",
      0,
      expect.stringContaining("is_takip_tum_veriler.csv"),
    );
  });

  it("tek çalışan seçilmeden dosya üretmez ve nedenini söyler", async () => {
    render(<CsvExportSection />);
    fireEvent.click(screen.getByRole("button", { name: "Tek Çalışan" }));
    fireEvent.click(screen.getByRole("button", { name: /CSV İndir/ }));

    expect(writeCsvFile).not.toHaveBeenCalled();
    expect(addToast).toHaveBeenCalledWith("Dışa aktarılacak çalışanı seçin.", "error");
  });

  it("tek çalışan kapsamında dosya adı çalışan adını taşır", async () => {
    workerRepository.findAll.mockResolvedValue(workers);
    render(<CsvExportSection />);

    fireEvent.click(screen.getByRole("button", { name: "Tek Çalışan" }));
    fireEvent.change(screen.getByLabelText("Çalışan"), { target: { value: "2" } });
    await exportNow();

    expect(writeCsvFile.mock.calls[0]![0]).toBe("is_takip_Veli_Ortak.csv");
  });

  it("kullanıcı iptal ederse başarı bildirimi vermez, denetim kaydı yazmaz", async () => {
    workerRepository.findAll.mockResolvedValue(workers);
    writeCsvFile.mockResolvedValue(null);

    render(<CsvExportSection />);
    fireEvent.click(screen.getByRole("button", { name: /CSV İndir/ }));

    await waitFor(() => expect(addToast).toHaveBeenCalledWith("Dışa aktarım iptal edildi", "info"));
    expect(auditWrite).not.toHaveBeenCalled();
  });

  it("dışa aktarım hatasında hatayı kullanıcıya ve izleme katmanına taşır", async () => {
    workerRepository.findAll.mockRejectedValue(new Error("veritabanı kilitli"));
    render(<CsvExportSection />);

    fireEvent.click(screen.getByRole("button", { name: /CSV İndir/ }));

    await waitFor(() =>
      expect(addToast).toHaveBeenCalledWith("Dışa aktarılamadı: veritabanı kilitli", "error"),
    );
    expect(writeCsvFile).not.toHaveBeenCalled();
  });
});
