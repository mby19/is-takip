import { describe, it, expect } from "vitest";
import { validateBackup, summarizeBackupFile, BACKUP_FORMAT_VERSION } from "../lib/backup";

const v1Backup = {
  version: 1,
  exported_at: "2026-01-15T14:30:00.000Z",
  workers: [
    {
      id: 1,
      name: "Ahmet Yılmaz",
      daily_wage: 600,
      worker_type: "GUNLUK",
      created_at: "2026-01-01T00:00:00.000Z",
      is_active: true,
    },
  ],
  attendance: [{ id: 1, worker_id: 1, date: "2026-01-02", status: "FULL" }],
  daily_metrics: [
    {
      id: 1,
      date: "2026-01-02",
      production_amount: 10,
      total_earned: 5000,
      extra_expenses: 200,
      is_holiday: 0,
    },
  ],
  payments: [{ id: 1, worker_id: 1, amount: 1000, date: "2026-01-10", description: null }],
  audit_logs: [],
};

describe("validateBackup", () => {
  it("geçerli bir v1 yedeğini kabul eder", () => {
    const result = validateBackup(v1Backup);
    expect(result.version).toBe(1);
    expect(result.workers).toHaveLength(1);
    expect(result.attendance).toHaveLength(1);
    expect(result.payments[0].description).toBeNull();
  });

  it("dönem kilidi alanı olmayan eski yedeği kabul eder", () => {
    const result = validateBackup(v1Backup);
    expect(result.closed_periods).toEqual([]);
  });

  it("dönem kilitlerini korur", () => {
    const result = validateBackup({
      ...v1Backup,
      closed_periods: [{ period: "2026-01", closed_at: "2026-02-01 09:00:00", note: null }],
    });
    expect(result.closed_periods).toEqual([
      { period: "2026-01", closed_at: "2026-02-01 09:00:00", note: null },
    ]);
  });

  it("v1 yedeğinde eksik ücret geçmişini çalışanlardan üretir", () => {
    const result = validateBackup(v1Backup);
    expect(result.rates).toHaveLength(1);
    expect(result.rates[0]).toMatchObject({
      worker_id: 1,
      valid_from: "2000-01-01",
      daily_wage: 600,
      worker_type: "GUNLUK",
    });
  });

  it("v2 yedeğindeki ücret geçmişini olduğu gibi alır", () => {
    const result = validateBackup({
      ...v1Backup,
      version: 2,
      worker_rate_history: [
        { worker_id: 1, valid_from: "2026-03-01", daily_wage: 750, worker_type: "GUNLUK" },
      ],
    });
    // v1-v3 yedeğinde `id` yoktur; `null` gelir ve geri yüklemede SQLite
    // yeni değer atar (bkz. `worker_rate_history` id'si neden yedekte).
    expect(result.rates).toEqual([
      {
        id: null,
        worker_id: 1,
        valid_from: "2026-03-01",
        daily_wage: 750,
        worker_type: "GUNLUK",
      },
    ]);
  });

  it("v4 yedeğindeki ücret geçmişi id'sini KORUR (denetim kaydı eşleşmesi)", () => {
    const result = validateBackup({
      ...v1Backup,
      version: BACKUP_FORMAT_VERSION,
      worker_rate_history: [
        { id: 42, worker_id: 1, valid_from: "2026-03-01", daily_wage: 750, worker_type: "GUNLUK" },
      ],
    });
    expect(result.rates[0]).toMatchObject({ id: 42, worker_id: 1, daily_wage: 750 });
  });

  it("sürüm alanı yoksa v1 varsayar", () => {
    const { version: _drop, ...noVersion } = v1Backup;
    expect(validateBackup(noVersion).version).toBe(1);
  });

  it("desteklenenden yeni bir biçimi REDDEDER (veri silinmeden)", () => {
    expect(() => validateBackup({ ...v1Backup, version: BACKUP_FORMAT_VERSION + 1 })).toThrow(
      /daha yeni bir uygulama sürümüyle/i,
    );
  });

  it("bilinmeyen puantaj durumunu reddeder", () => {
    expect(() =>
      validateBackup({
        ...v1Backup,
        attendance: [{ id: 1, worker_id: 1, date: "2026-01-02", status: "SICK_LEAVE" }],
      }),
    ).toThrow(/bilinmeyen puantaj durumu/i);
  });

  it("eski yedeklerdeki HOLIDAY durumunu ABSENT'a çevirir", () => {
    // Tatil kaldırıldı ama eski yedek dosyalarında HOLIDAY kayıtları olabilir.
    // Yedek reddedilmemeli; kayıt "Yok" (ABSENT) anlamına çevrilmeli.
    const result = validateBackup({
      ...v1Backup,
      attendance: [{ id: 1, worker_id: 1, date: "2026-01-02", status: "HOLIDAY" }],
    });
    expect(result.attendance[0].status).toBe("ABSENT");
  });

  it("bilinmeyen çalışan tipini reddeder", () => {
    expect(() =>
      validateBackup({
        ...v1Backup,
        workers: [{ ...v1Backup.workers[0], worker_type: "TASERON" }],
      }),
    ).toThrow(/bilinmeyen çalışan tipi/i);
  });

  it("sayısal olmayan tutarı reddeder", () => {
    expect(() =>
      validateBackup({ ...v1Backup, payments: [{ ...v1Backup.payments[0], amount: "bin lira" }] }),
    ).toThrow(/geçersiz/i);
  });

  it("tablo içermeyen nesneyi reddeder", () => {
    expect(() => validateBackup({ version: 1, exported_at: "x" })).toThrow(/veri tabloları/i);
  });

  it("nesne olmayan girdiyi reddeder", () => {
    expect(() => validateBackup(null)).toThrow();
    expect(() => validateBackup([1, 2, 3])).toThrow();
  });

  it("liste beklenen alan liste değilse reddeder", () => {
    expect(() => validateBackup({ ...v1Backup, workers: { id: 1 } })).toThrow(/liste değil/i);
  });

  it("boş açıklamayı ve eksik alanları varsayılanlarla tamamlar", () => {
    const result = validateBackup({
      ...v1Backup,
      daily_metrics: [{ id: 5, date: "2026-02-01" }],
    });
    expect(result.daily_metrics[0]).toMatchObject({
      production_amount: 0,
      total_earned: 0,
      extra_expenses: 0,
      is_holiday: 0,
    });
  });
});

describe("summarizeBackupFile", () => {
  it("dosya içeriğinden sayıları çıkarır", () => {
    const summary = summarizeBackupFile(JSON.stringify(v1Backup));
    expect(summary).toMatchObject({
      version: 1,
      workers: 1,
      attendance: 1,
      daily_metrics: 1,
      payments: 1,
      audit_logs: 0,
    });
  });

  it("dönem kilitlerini sayar", () => {
    const summary = summarizeBackupFile(
      JSON.stringify({ ...v1Backup, closed_periods: [{ period: "2026-01", closed_at: null }] }),
    );
    expect(summary.closed_periods).toBe(1);
  });

  it("bozuk JSON'da hata verir", () => {
    expect(() => summarizeBackupFile("{ bu json değil")).toThrow();
  });
});
