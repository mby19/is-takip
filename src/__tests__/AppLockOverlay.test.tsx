import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as appLockModule from "../lib/appLock";
import { AppLockOverlay } from "../components/AppLockOverlay";

const verifySequence = vi.fn();
const verifyPin = vi.fn();

vi.mock("../lib/appLock", async (importOriginal) => {
  const actual = await importOriginal<typeof appLockModule>();
  return {
    ...actual,
    verifySequence: (...args: unknown[]) => verifySequence(...args),
    verifyPin: (...args: unknown[]) => verifyPin(...args),
  };
});

/** Ayar testleri için basit bir taklit — jsdom localStorage sağlamıyor. */
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, String(v)),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
};

const renderOverlay = (onUnlock = vi.fn()) => {
  render(<AppLockOverlay onUnlock={onUnlock} />);
  return onUnlock;
};

const tap = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("AppLockOverlay", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    verifySequence.mockReset().mockResolvedValue({ ok: false, lockedFor: 0, attemptsLeft: 4 });
    verifyPin.mockReset().mockResolvedValue({ ok: false, lockedFor: 0, attemptsLeft: 4 });
  });

  afterEach(() => {
    // Başarısız bir senaryodan kalan sahte zamanlayıcılar sızmaz.
    vi.useRealTimers();
  });

  it("modal dialog olarak sunulur", () => {
    renderOverlay();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Uygulama kilidi");
  });

  it("kısayollar buton içinde buton üretmez", () => {
    renderOverlay();
    const grid = screen.getByRole("toolbar", { name: "Kilit ekranı için resimler" });
    expect(grid.querySelectorAll("button button")).toHaveLength(0);
    expect(grid.querySelectorAll("button")).toHaveLength(9);
  });

  it("focus trap kurulur: arka plan aria-hidden olur, odak içeride kalır", () => {
    renderOverlay();
    const dialog = screen.getByRole("dialog");

    // Radix FocusScope odak korumasının iki uç noktası.
    expect(document.querySelectorAll("[data-radix-focus-guard]")).toHaveLength(2);
    // Arka plan erişilebilirlik ağacından düşer.
    expect(document.querySelectorAll("[aria-hidden]").length).toBeGreaterThan(0);
    expect(dialog.contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("klavye odağı gezindirir ve ızgarada tek Tab durağı vardır", () => {
    renderOverlay();
    const grid = screen.getByRole("toolbar", { name: "Kilit ekranı için resimler" });
    const tabbable = Array.from(grid.querySelectorAll("button")).filter(
      (b) => b.getAttribute("tabindex") === "0",
    );
    expect(tabbable).toHaveLength(1);

    const first = tabbable[0];
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    expect(grid.contains(document.activeElement)).toBe(true);
  });

  it("Escape kilit ekranını kapatmaz", () => {
    renderOverlay();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("4. basışta kilit kilitlenmez: doğrulama asla 4 eleman almaz", async () => {
    const onUnlock = renderOverlay();
    verifySequence.mockResolvedValue({ ok: true, lockedFor: 0, attemptsLeft: 5 });

    // 4 hızlı basış (LK2).
    for (const name of ["Panda", "Roket", "Elmas", "Taç"]) {
      tap(name);
    }

    await waitFor(() => expect(verifySequence).toHaveBeenCalled());
    // Pencere 3 elemanla sınırlı kalır; 4 elemana taşmaz.
    for (const call of verifySequence.mock.calls) {
      expect(call[0]).toHaveLength(3);
    }
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });

  it("doğru desen kilidi açar", async () => {
    const onUnlock = renderOverlay();
    verifySequence.mockResolvedValue({ ok: true, lockedFor: 0, attemptsLeft: 5 });

    for (const name of ["Panda", "Roket", "Elmas"]) {
      tap(name);
    }

    await waitFor(() => expect(verifySequence).toHaveBeenCalledTimes(1));
    expect(verifySequence.mock.calls[0][0]).toEqual(["panda", "rocket", "diamond"]);
    await waitFor(() => expect(onUnlock).toHaveBeenCalled());
  });

  it("doğrulama hatası yakalanır ve kullanıcıya bildirilir", async () => {
    renderOverlay();
    verifySequence.mockRejectedValue(new Error("crypto yok"));

    for (const name of ["Panda", "Roket", "Elmas"]) {
      tap(name);
    }

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("Doğrulama yapılamadı"),
    );
  });

  it("unmount sonrası zamanlayıcılar setState çağırmaz", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.useFakeTimers();

    const view = render(<AppLockOverlay onUnlock={vi.fn()} />);
    for (const name of ["Panda", "Roket", "Elmas"]) {
      tap(name);
    }
    view.unmount();

    // Temizlenmemiş zamanlayıcılar burada uyarı basardı.
    await vi.advanceTimersByTimeAsync(2000);
    expect(errors).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
