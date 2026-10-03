import { describe, it, expect } from "vitest";
import {
  hasAllAttendanceRecorded,
  type CoverageAttendance,
  type CoverageWorker,
} from "../lib/attendanceCoverage";

const TODAY = "2026-10-01";

/** 40 kişilik ekip — gerçek saha ölçeği. */
const team = (size: number): CoverageWorker[] =>
  Array.from({ length: size }, (_, i) => ({ id: i + 1, is_active: true }));

const recorded = (ids: number[], date = TODAY): CoverageAttendance[] =>
  ids.map((id) => ({ worker_id: id, date }));

describe("bugün girildi ölçütü", () => {
  it("40 kişilik ekipte tek kişi girildiğinde gün dolmuş sayılmaz", () => {
    expect(hasAllAttendanceRecorded(team(40), recorded([1]), TODAY)).toBe(false);
  });

  it("herkes girildiğinde gün dolmuş sayılır", () => {
    const all = team(40).map((w) => w.id);
    expect(hasAllAttendanceRecorded(team(40), recorded(all), TODAY)).toBe(true);
  });

  it("39/40 kayıtta uyarı açık kalır", () => {
    const all = team(40).map((w) => w.id);
    expect(hasAllAttendanceRecorded(team(40), recorded(all.slice(0, 39)), TODAY)).toBe(false);
  });

  it("hiç kayıt yoksa uyarı açıktır", () => {
    expect(hasAllAttendanceRecorded(team(40), [], TODAY)).toBe(false);
  });
});

describe("arşivlenmiş çalışanlar", () => {
  const withArchive = (size: number, archivedCount: number): CoverageWorker[] => [
    ...team(size),
    ...Array.from({ length: archivedCount }, (_, i) => ({
      id: 1000 + i,
      is_active: false,
    })),
  ];

  it("puantajsız arşivli çalışan uyarıyı etkilemez", () => {
    // Aktif 3 kişi girildi, arşivli 2 kişinin bugün kaydı yok.
    const workers = withArchive(3, 2);
    expect(hasAllAttendanceRecorded(workers, recorded([1, 2, 3]), TODAY)).toBe(true);
  });

  it("arşivli çalışanın varlığı tek başına eksik sayılmaz", () => {
    const workers = withArchive(3, 2);
    expect(hasAllAttendanceRecorded(workers, [], TODAY)).toBe(false);
  });

  it("arşivli çalışan puantajı aktif eksikliğini kapatmaz", () => {
    // Aktif 1, 2, 3; arşivli 9. Yalnızca arşivli 9 ve aktif 1 kayıtlı.
    const workers = withArchive(3, 1);
    expect(hasAllAttendanceRecorded(workers, recorded([1, 1000]), TODAY)).toBe(false);
  });

  it("is_active 0 (SQLite) de arşiv sayılır", () => {
    const workers: CoverageWorker[] = [
      { id: 1, is_active: true },
      { id: 2, is_active: 0 },
    ];
    expect(hasAllAttendanceRecorded(workers, recorded([1]), TODAY)).toBe(true);
  });

  it("aktif çalışan yoksa uyarı gerekmez", () => {
    const workers: CoverageWorker[] = [
      { id: 1, is_active: false },
      { id: 2, is_active: false },
    ];
    expect(hasAllAttendanceRecorded(workers, [], TODAY)).toBe(true);
  });
});

describe("diğer günler", () => {
  it("başka güne ait kayıtlar bugünü sayılmaz", () => {
    expect(hasAllAttendanceRecorded(team(2), recorded([1, 2], "2026-09-30"), TODAY)).toBe(false);
  });

  it("string worker_id kabul edilir", () => {
    const rows: CoverageAttendance[] = [
      { worker_id: "1", date: TODAY },
      { worker_id: "2", date: TODAY },
    ];
    expect(hasAllAttendanceRecorded(team(2), rows, TODAY)).toBe(true);
  });
});
