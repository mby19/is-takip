import { describe, it, expect } from "vitest";
import { parseLogData } from "../utils/parseLogData";

describe("parseLogData", () => {
  it("returns null for null/undefined input", () => {
    expect(parseLogData(null)).toBeNull();
    expect(parseLogData("")).toBeNull();
    expect(parseLogData("   ")).toBeNull();
  });

  it("parses pipe-delimited key=value format", () => {
    const result = parseLogData("date=2026-05-01|production=50|earned=1500");
    expect(result).toEqual({
      date: "2026-05-01",
      production: "50",
      earned: "1500",
    });
  });

  it("parses JSON format (old logs)", () => {
    const result = parseLogData('{"name":"Ahmet","status":"FULL"}');
    expect(result).toEqual({ name: "Ahmet", status: "FULL" });
  });

  it("parses Worker: prefix format", () => {
    const result = parseLogData("Worker: Ali");
    expect(result).toEqual({ name: "Ali" });
  });

  it("parses Attendance: format", () => {
    const result = parseLogData("Attendance: FULL on 2026-05-01");
    expect(result).toEqual({ status: "FULL", date: "2026-05-01" });
  });

  it("parses Old/New: status format", () => {
    const result = parseLogData("Old: FULL");
    expect(result).toEqual({ status: "FULL" });
  });

  it("parses Production: number format", () => {
    const result = parseLogData("Production: 50");
    expect(result).toEqual({ production: "50" });
  });

  it("falls back to _raw for unrecognized format", () => {
    const result = parseLogData("some random text");
    expect(result).toEqual({ _raw: "some random text" });
  });

  it("trims whitespace from input", () => {
    const result = parseLogData("  date=2026-05-01|amount=500  ");
    expect(result).toEqual({ date: "2026-05-01", amount: "500" });
  });

  it("handles pipe-delimited with empty parts gracefully", () => {
    const result = parseLogData("key=value||other=2");
    expect(result).toEqual({ key: "value", other: "2" });
  });

  it("returns raw for pipe-only string", () => {
    const result = parseLogData("|");
    expect(result).toEqual({ _raw: "|" });
  });
});
