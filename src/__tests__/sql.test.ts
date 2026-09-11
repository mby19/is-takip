import { describe, it, expect } from "vitest";
import { sqlLiteral, escapeSqlString, buildTransactionScript } from "../lib/sql";

describe("sqlLiteral", () => {
  it("null ve undefined için NULL üretir", () => {
    expect(sqlLiteral(null)).toBe("NULL");
    expect(sqlLiteral(undefined)).toBe("NULL");
  });

  it("sayıları olduğu gibi yazar", () => {
    expect(sqlLiteral(0)).toBe("0");
    expect(sqlLiteral(-12.5)).toBe("-12.5");
  });

  it("sonsuz ve NaN değerleri reddeder", () => {
    expect(() => sqlLiteral(NaN)).toThrow();
    expect(() => sqlLiteral(Infinity)).toThrow();
  });

  it("boolean değerleri 1/0 yapar", () => {
    expect(sqlLiteral(true)).toBe("1");
    expect(sqlLiteral(false)).toBe("0");
  });

  it("metinleri tek tırnak içine alır", () => {
    expect(sqlLiteral("Ahmet")).toBe("'Ahmet'");
  });

  it("tek tırnağı ikiye katlayarak kaçırır", () => {
    expect(sqlLiteral("O'Brien")).toBe("'O''Brien'");
    expect(escapeSqlString("a'b'c")).toBe("a''b''c");
  });

  it("SQL enjeksiyon denemesini zararsız bir metne çevirir", () => {
    const evil = "'; DROP TABLE workers; --";
    expect(sqlLiteral(evil)).toBe("'''; DROP TABLE workers; --'");
  });

  it("NUL karakteri içeren metni reddeder", () => {
    expect(() => sqlLiteral("a\0b")).toThrow();
  });
});

describe("buildTransactionScript", () => {
  it("ifadeleri BEGIN/COMMIT arasına alır", () => {
    const script = buildTransactionScript([
      "DELETE FROM workers",
      "INSERT INTO workers VALUES (1)",
    ]);
    expect(script.startsWith("BEGIN IMMEDIATE;")).toBe(true);
    expect(script.trimEnd().endsWith("COMMIT;")).toBe(true);
    expect(script).toContain("DELETE FROM workers;");
  });

  it("zaten noktalı virgülle biten ifadeleri iki kez sonlandırmaz", () => {
    expect(buildTransactionScript(["DELETE FROM a;"])).not.toContain("DELETE FROM a;;");
  });

  it("boş ifadeleri atlar", () => {
    expect(buildTransactionScript(["", "   ", "SELECT 1"])).toBe(
      "BEGIN IMMEDIATE;\nSELECT 1;\nCOMMIT;",
    );
  });
});
