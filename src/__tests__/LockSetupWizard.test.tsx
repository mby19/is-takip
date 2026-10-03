import { describe, it, expect, beforeEach, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import * as appLockModule from "../lib/appLock";
import { LockSetupWizard } from "../components/LockSetupWizard";

const configureLock = vi.fn().mockResolvedValue(undefined);
const verifySequence = vi.fn();
const verifyPin = vi.fn();

vi.mock("../lib/appLock", async (importOriginal) => {
  const actual = await importOriginal<typeof appLockModule>();
  return {
    ...actual,
    configureLock: (...args: unknown[]) => configureLock(...args),
    verifySequence: (...args: unknown[]) => verifySequence(...args),
    verifyPin: (...args: unknown[]) => verifyPin(...args),
  };
});

/** Kurulum sihirbazını açar ve 1. adımdaki kısayol ızgarasını döndürür. */
const openWizard = () => {
  render(<LockSetupWizard />);
  fireEvent.click(screen.getByRole("button", { name: "Etkinleştir" }));
  return screen.getByRole("toolbar", { name: "Desen belirlemek için resimler" });
};

/** Kısayol ızgarasındaki bir butona basar. */
const tap = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

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

describe("LockSetupWizard — emoji deseni", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    configureLock.mockClear().mockResolvedValue(undefined);
    verifySequence.mockReset();
    verifyPin.mockReset();
  });

  it("kurulum sihirbazını açar", () => {
    expect(openWizard()).toBeInTheDocument();
  });

  it("kısayollar buton içinde buton üretmez ve 9 gerçek butondur", () => {
    const grid = openWizard();
    expect(grid.querySelectorAll("button button")).toHaveLength(0);
    expect(grid.querySelectorAll("button")).toHaveLength(9);
    expect(grid).toHaveAttribute("role", "toolbar");
  });

  it("klavye ile tamamlanabilir: ok tuşları gezinir, Enter seçer", () => {
    const grid = openWizard();

    // Roving tabindex: ızgarada tam olarak bir Tab durağı var.
    const tabbable = Array.from(grid.querySelectorAll("button")).filter(
      (b) => b.getAttribute("tabindex") === "0",
    );
    expect(tabbable).toHaveLength(1);

    // Ok tuşları odağı taşır (kaynak: EmojiPatternGrid).
    const first = tabbable[0];
    first.focus();
    expect(document.activeElement).toBe(first);
    fireEvent.keyDown(grid, { key: "ArrowRight" });
    const moved = document.activeElement as HTMLElement;
    expect(moved).not.toBe(first);
    expect(grid.contains(moved)).toBe(true);
  });

  it("4. basışta desen kilitlenmez ve son 3'lü doğru kabul edilir", async () => {
    openWizard();

    // 4 basış: pencere en eskiyi düşürür → [Roket, Elmas, Taç] (LK2).
    tap("Panda");
    tap("Roket");
    tap("Elmas");
    tap("Taç");

    await waitFor(() => expect(screen.getByText("Bir Daha Seç")).toBeInTheDocument());

    // Kullanıcı ekranda gördüğü son 3'lüyü onaylar.
    tap("Roket");
    tap("Elmas");
    tap("Taç");

    await waitFor(() =>
      expect(screen.getByText("Kurtarma Şifresi Belirleyin")).toBeInTheDocument(),
    );
    expect(
      screen.queryByText("Desenler eşleşmedi! Lütfen tekrar deneyin."),
    ).not.toBeInTheDocument();
  });

  it("eşleşmeyen desen hata mesajı gösterir", async () => {
    openWizard();

    tap("Panda");
    tap("Roket");
    tap("Elmas");
    await waitFor(() => expect(screen.getByText("Bir Daha Seç")).toBeInTheDocument());

    tap("Taç");
    tap("Roket");
    tap("Elmas");

    await waitFor(() =>
      expect(screen.getByText("Desenler eşleşmedi! Lütfen tekrar deneyin.")).toBeInTheDocument(),
    );
  });
});
