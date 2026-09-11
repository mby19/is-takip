import { describe, it, expect } from "vitest";
import {
  WORKER_COLORS,
  WORKER_COLOR_KEYS,
  resolveWorkerColor,
  resolveWorkerColorKey,
  normalizeShortLabel,
  SHORT_LABEL_MAX,
} from "../lib/workerAppearance";

describe("çalışan görünümü", () => {
  it("seçilmiş rengi kullanır", () => {
    expect(resolveWorkerColorKey({ id: 1, color: "rose" })).toBe("rose");
    expect(resolveWorkerColor({ id: 1, color: "rose" })).toBe(WORKER_COLORS.rose);
  });

  it("renk seçilmemişse id'den kararlı biçimde türetir", () => {
    const a = resolveWorkerColorKey({ id: 7, color: null });
    const b = resolveWorkerColorKey({ id: 7, color: null });
    expect(a).toBe(b);
    expect(WORKER_COLOR_KEYS).toContain(a);
  });

  it("farklı kişilere farklı renk verir", () => {
    const keys = [1, 2, 3, 4, 5, 6].map((id) => resolveWorkerColorKey({ id, color: null }));
    expect(new Set(keys).size).toBe(6);
  });

  it("bilinmeyen renk anahtarını yok sayar", () => {
    expect(WORKER_COLOR_KEYS).toContain(resolveWorkerColorKey({ id: 3, color: "fuchsia" }));
  });

  it("kısa etiketi kırpar ve büyütür", () => {
    expect(normalizeShortLabel("  meto  ")).toBe("METO".slice(0, SHORT_LABEL_MAX));
    expect(normalizeShortLabel("ışık")).toBe("IŞI");
    expect(normalizeShortLabel("")).toBe("");
  });
});
