import { describe, it, expect } from "vitest";
import {
  validateBackup,
  isBackupFileName,
  isAutomaticBackupFileName,
  BACKUP_FORMAT_VERSION,
} from "../lib/backup";

/**
 * Bu dosya iki düzeltmeyi kilitler:
 *
 *  1) `audit_logs.reverted_at` yedeğe girer ve geri yüklemede korunur.
 *     Alan kaybolursa `canRevert = !reverted_at` tekrar true olur ve aynı
 *     işlem ikinci kez geri alınabilir — geri alma etkisi ikiye katlanır.
 *  2) Otomatik güvenlik yedekleri (`is_takip_otomatik_yedek_`) kullanıcıya
 *     listelenir; yalnız `is_takip_backup_` filtresi onları gizliyordu.
 */

const baseBackup = {
  version: BACKUP_FORMAT_VERSION,
  exported_at: "2026-03-01T09:00:00.000Z",
  workers: [
    {
      id: 1,
      name: "Ahmet Yılmaz",
      daily_wage: 600,
      worker_type: "GUNLUK",
      created_at: "2026-01-01 08:00:00",
      is_active: 1,
      color: null,
      short_label: null,
    },
  ],
  worker_rate_history: [],
  attendance: [{ id: 1, worker_id: 1, date: "2026-02-01", status: "FULL" }],
  daily_metrics: [],
  payments: [],
  closed_periods: [],
  audit_logs: [
    {
      id: 1,
      action_type: "UPDATE",
      entity_table: "payments",
      record_id: 7,
      old_data: "1000",
      new_data: "0",
      created_at: "2026-02-02 10:00:00",
      reverted_at: "2026-02-03 11:30:00",
    },
    {
      id: 2,
      action_type: "INSERT",
      entity_table: "attendance",
      record_id: 1,
      old_data: null,
      new_data: "FULL",
      created_at: "2026-02-01 09:00:00",
      reverted_at: null,
    },
  ],
};

describe("validateBackup — reverted_at", () => {
  it("geri alınmış kaydın reverted_at damgasını korur", () => {
    const result = validateBackup(baseBackup);
    expect(result.audit_logs[0].reverted_at).toBe("2026-02-03 11:30:00");
    expect(result.audit_logs[1].reverted_at).toBeNull();
  });

  it("null reverted_at değerini de kabul eder (geri alınmamış kayıt)", () => {
    const result = validateBackup({
      ...baseBackup,
      audit_logs: [
        {
          id: 5,
          action_type: "EXPORT",
          entity_table: "backup",
          record_id: 0,
          old_data: null,
          new_data: "{}",
          created_at: "2026-02-05 12:00:00",
          reverted_at: null,
        },
      ],
    });
    expect(result.audit_logs).toHaveLength(1);
    expect(result.audit_logs[0].reverted_at).toBeNull();
  });

  it("v3 yedeğinde reverted_at alanı eksikse REDDEDER (sessizce null yapılmaz)", () => {
    const { reverted_at: _dropped, ...withoutRevertColumn } = baseBackup.audit_logs[0];
    expect(() => validateBackup({ ...baseBackup, audit_logs: [withoutRevertColumn] })).toThrow(
      /reverted_at alanı eksik/i,
    );
  });

  it("reverted_at yanlış tipteyse reddeder", () => {
    expect(() =>
      validateBackup({
        ...baseBackup,
        audit_logs: [{ ...baseBackup.audit_logs[0], reverted_at: { yil: 2026 } }],
      }),
    ).toThrow(/reverted_at alanı metin veya null olmalı/i);
  });

  it("reverted_at sayısal değerini metne çevirir (SQLite sayı döndürebilir)", () => {
    const result = validateBackup({
      ...baseBackup,
      audit_logs: [{ ...baseBackup.audit_logs[0], reverted_at: 1770000000 }],
    });
    expect(result.audit_logs[0].reverted_at).toBe("1770000000");
  });

  it("reverted_at alanı olmayan eski (v2) yedeği geriye dönük uyumlu kabul eder", () => {
    const { reverted_at: _dropped, ...legacyLog } = baseBackup.audit_logs[0];
    const result = validateBackup({
      ...baseBackup,
      version: 2,
      audit_logs: [legacyLog],
    });
    expect(result.version).toBe(2);
    expect(result.audit_logs[0].reverted_at).toBeNull();
  });
});

describe("validateBackup — diğer alanlar sessizce yutulmaz", () => {
  it("null created_at'i metin 'null' olarak değil, gerçek NULL olarak korur", () => {
    const result = validateBackup({
      ...baseBackup,
      workers: [{ ...baseBackup.workers[0], created_at: null }],
    });
    expect(result.workers[0].created_at).toBeNull();
  });

  it("closed_periods.closed_at nesne tipinde gelirse reddeder", () => {
    expect(() =>
      validateBackup({
        ...baseBackup,
        closed_periods: [{ period: "2026-02", closed_at: ["2026-03-01"], note: null }],
      }),
    ).toThrow(/closed_periods.closed_at alanı metin veya null olmalı/i);
  });

  it("audit_logs.old_data nesne tipinde gelirse reddeder", () => {
    expect(() =>
      validateBackup({
        ...baseBackup,
        audit_logs: [{ ...baseBackup.audit_logs[0], old_data: { amount: 1000 } }],
      }),
    ).toThrow(/audit_logs.old_data alanı metin veya null olmalı/i);
  });
});

describe("yedek dosyası adı tanıma", () => {
  it("kullanıcının aldığı yedeği tanır", () => {
    expect(isBackupFileName("is_takip_backup_2026-03-01_10-20-30.json")).toBe(true);
    expect(isAutomaticBackupFileName("is_takip_backup_2026-03-01_10-20-30.json")).toBe(false);
  });

  it("geri yükleme öncesi otomatik güvenlik yedeğini tanır", () => {
    const name = "is_takip_otomatik_yedek_2026-03-01_10-20-30.json";
    expect(isBackupFileName(name)).toBe(true);
    expect(isAutomaticBackupFileName(name)).toBe(true);
  });

  it("json olmayan veya yedek olmayan dosyaları eler", () => {
    expect(isBackupFileName("is_takip_otomatik_yedek_2026-03-01_10-20-30.txt")).toBe(false);
    expect(isBackupFileName("fatura_2026-03-01.json")).toBe(false);
    expect(isAutomaticBackupFileName("fatura.json")).toBe(false);
  });
});
