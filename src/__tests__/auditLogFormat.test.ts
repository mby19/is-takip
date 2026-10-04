import { describe, it, expect } from "vitest";
import {
  describeAuditLog,
  groupLogsByDay,
  formatLogDate,
  formatLogTime,
  statusLabel,
} from "../utils/auditLogFormat";
import type { AuditLog } from "../types";

const log = (o: Partial<AuditLog>): AuditLog => ({
  id: 1,
  action_type: "INSERT",
  entity_table: "attendance",
  record_id: 1,
  old_data: null,
  new_data: null,
  created_at: "2026-09-11 20:40:00",
  ...o,
});

const names = (id: number) => ({ 1: "Ahmet Yılmaz", 2: "Murat Kaya" })[id];

describe("describeAuditLog", () => {
  it("puantaj eklemeyi kişi ve duruma çevirir", () => {
    const v = describeAuditLog(
      log({
        entity_table: "attendance",
        new_data: JSON.stringify({ worker_id: 1, date: "2026-09-03", status: "FULL" }),
      }),
      names,
    );
    expect(v.kind).toBe("attendance");
    expect(v.title).toBe("Ahmet Yılmaz · Tam gün");
    expect(v.subtitle).toBe("3 Eylül 2026");
    expect(v.tone).toBe("ok");
    expect(v.revertable).toBe(true);
  });

  it("puantaj değişiminde eski değeri ayrıntıda tutar", () => {
    const v = describeAuditLog(
      log({
        action_type: "UPDATE",
        entity_table: "attendance",
        old_data: JSON.stringify({ worker_id: 1, date: "2026-09-03", status: "FULL" }),
        new_data: JSON.stringify({ worker_id: 1, date: "2026-09-03", status: "ABSENT" }),
      }),
      names,
    );
    expect(v.title).toBe("Ahmet Yılmaz · Gelmedi");
    expect(v.details).toEqual([{ label: "Durum", value: "Gelmedi", was: "Tam gün", tone: "bad" }]);
  });

  it("ödemeyi tutarla birlikte özetler", () => {
    const v = describeAuditLog(
      log({
        entity_table: "payments",
        new_data: JSON.stringify({ worker_id: 2, amount: 1500, date: "2026-09-05" }),
      }),
      names,
    );
    expect(v.kind).toBe("payment");
    expect(v.title).toContain("Murat Kaya");
    expect(v.title).toContain("₺1.500");
  });

  it("gün verisinde değişen alanları listeler", () => {
    const v = describeAuditLog(
      log({
        action_type: "UPDATE",
        entity_table: "daily_metrics",
        old_data: JSON.stringify({
          date: "2026-09-03",
          production: 10,
          earned: 5000,
          expenses: 100,
        }),
        new_data: JSON.stringify({
          date: "2026-09-03",
          production: 16,
          earned: 5000,
          expenses: 100,
        }),
      }),
      names,
    );
    expect(v.kind).toBe("metrics");
    expect(v.details).toHaveLength(1);
    expect(v.details[0]).toMatchObject({ label: "Üretim", value: "16 palet", was: "10 palet" });
  });

  it("gün verisinde puantaj değişikliklerini de gösterir", () => {
    const v = describeAuditLog(
      log({
        action_type: "UPDATE",
        entity_table: "daily_metrics",
        old_data: JSON.stringify({
          date: "2026-09-03",
          production: 10,
          atts: [{ id: 1, name: "Ahmet", status: "YOK" }],
        }),
        new_data: JSON.stringify({
          date: "2026-09-03",
          production: 10,
          atts: [{ id: 1, name: "Ahmet", status: "FULL" }],
        }),
      }),
      names,
    );
    expect(v.title).toContain("1 kişide değişiklik");
    expect(v.details.some((d) => d.label === "Ahmet" && d.value === "Tam gün")).toBe(true);
  });

  it("dönem kilidini ayırt eder ve geri alınamaz sayar", () => {
    const v = describeAuditLog(
      log({
        action_type: "CLOSE_PERIOD",
        entity_table: "closed_periods",
        new_data: JSON.stringify({ period: "2026-09", label: "Eylül 2026" }),
      }),
    );
    expect(v.kind).toBe("period");
    expect(v.title).toBe("Dönem kapatıldı");
    expect(v.subtitle).toBe("Eylül 2026");
    expect(v.revertable).toBe(false);
  });

  it("yedekleme kayıtlarını tanır", () => {
    const v = describeAuditLog(
      log({
        action_type: "EXPORT",
        entity_table: "backup",
        new_data: JSON.stringify({ file: "y.json" }),
      }),
    );
    expect(v.kind).toBe("backup");
    expect(v.title).toBe("Yedek alındı");
  });

  it("eski pipe formatını da okur", () => {
    const v = describeAuditLog(
      log({ entity_table: "workers", new_data: "name=Ahmet|type=GUNLUK|wage=900" }),
    );
    expect(v.kind).toBe("worker");
    expect(v.title).toBe("Ahmet eklendi");
  });

  it("silinmiş çalışanın adını logdan alır", () => {
    const v = describeAuditLog(
      log({
        entity_table: "attendance",
        new_data: JSON.stringify({
          worker_id: 99,
          worker_name: "Eski Kişi",
          date: "2026-09-03",
          status: "FULL",
        }),
      }),
      names,
    );
    expect(v.title).toContain("Eski Kişi");
  });

  it("bilinmeyen tabloyu çökmeden karşılar", () => {
    const v = describeAuditLog(log({ entity_table: "bilinmeyen", action_type: "UPDATE" }));
    expect(v.kind).toBe("other");
    expect(v.revertable).toBe(false);
  });
});

describe("gruplama ve biçimleme", () => {
  it("kayıtları güne göre böler", () => {
    const groups = groupLogsByDay([
      log({ id: 1, created_at: "2026-09-11 20:40:00" }),
      log({ id: 2, created_at: "2026-09-11 09:10:00" }),
      log({ id: 3, created_at: "2026-09-10 18:00:00" }),
    ]);
    expect(groups).toHaveLength(2);
    expect(groups[0].logs).toHaveLength(2);
    expect(groups[1].logs).toHaveLength(1);
  });

  it("bugünü ve dünü adlandırır", () => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const key = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
    const groups = groupLogsByDay([log({ created_at: `${key} 10:00:00` })]);
    expect(groups[0].label).toBe("Bugün");
  });

  it("tarihi ve saati biçimler", () => {
    expect(formatLogDate("2026-09-03")).toBe("3 Eylül 2026");
    expect(formatLogTime("2026-09-11 20:40:12")).toBe("20:40");
    // Eski denetim kayıtlarında HOLIDAY kalmış olabilir; silinmiş bir kavramın
    // izini taşıdığı açıkça belirtilir, düz "İzin" diye gösterilmez.
    expect(statusLabel("HOLIDAY")).toBe("İzinli (eski kayıt)");
  });
});
