import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, act, waitFor } from "@testing-library/react";

const getDb = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  fetchQuery: vi.fn().mockResolvedValue([]),
  executeTransaction: vi.fn().mockResolvedValue(undefined),
  getDb: () => getDb(),
  getTriggerSetupError: () => null,
}));
vi.mock("../lib/appLock", () => ({ isLockEnabled: () => false }));
vi.mock("../lib/backup", () => ({ importDatabase: vi.fn() }));

import App from "../App";
import { ToastContainer } from "../components/ToastContainer";
import { useToastStore } from "../stores/toastStore";

/**
 * Erişilebilirlik — canlı bölge ve "İçeriğe atla" bağlantısı.
 *
 * İki bulgu:
 * 1. ToastContainer'da iç içe iki canlı bölge vardı (kökte `aria-live="polite"`
 *    + kartta `role="alert"`) → aynı mesaj bazı okuyucularda iki kez okunur.
 * 2. Klavyeyle gelen kullanıcıyı içeriğe atlayan bir bağlantı yoktu.
 *
 * Gerçek ekran okuyucu jsdom'da yok; ölçülebilir olan DOM yapısıdır: her
 * mesajın tam olarak bir canlı bölgeye sahip olması ve skip link'in ilk odak
 * durağı olması.
 */

/** Bir düğümün kendisi de dâhil, üzerindeki canlı bölge rolü taşıyan öğeler. */
const LIVE_REGION = "[aria-live], [role='alert'], [role='status'], [role='log'], [role='marquee']";

const liveRegionCount = (node: Element) => {
  let count = 0;
  for (let el: Element | null = node; el; el = el.parentElement) {
    if (el.matches(LIVE_REGION)) count++;
  }
  return count;
};

beforeEach(() => {
  getDb.mockReset().mockResolvedValue({});
  useToastStore.setState({ toasts: [] });
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

describe("Toast — mesaj başına tek canlı bölge", () => {
  const addToast = (message: string, type: "success" | "error" | "info") =>
    act(() => void useToastStore.getState().addToast(message, type));

  it("bir hata ve iki bilgi bildirimi her biri tek canlı bölgede", async () => {
    render(<ToastContainer />);

    await addToast("Yedek geri yüklendi", "success");
    await addToast("Veritabanı açılamadı", "error");
    await addToast("Kayıt silindi", "info");

    for (const message of ["Yedek geri yüklendi", "Veritabanı açılamadı", "Kayıt silindi"]) {
      const toast = screen.getByText(message).parentElement;
      expect(toast).not.toBeNull();
      expect(liveRegionCount(toast as Element)).toBe(1);
    }

    // `role="alert"` kendi canlı bölgesini yaratır; hiçbir yerde bulunmamalı.
    expect(document.querySelectorAll("[role='alert']")).toHaveLength(0);
    expect(document.querySelectorAll(LIVE_REGION)).toHaveLength(2);
  });

  it("hata assertive, diğerleri polite bölgede duyurulur", async () => {
    render(<ToastContainer />);

    await addToast("Veritabanı açılamadı", "error");
    await addToast("Kayıt silindi", "info");

    const regionOf = (message: string) => {
      const toast = screen.getByText(message).parentElement as Element;
      for (let el: Element | null = toast; el; el = el.parentElement) {
        if (el.matches(LIVE_REGION)) return el;
      }
      throw new Error(`${message} canlı bölge içinde değil`);
    };

    expect(regionOf("Veritabanı açılamadı")).toHaveAttribute("aria-live", "assertive");
    expect(regionOf("Kayıt silindi")).toHaveAttribute("aria-live", "polite");
  });
});

describe("İçeriğe atla bağlantısı", () => {
  const FOCUSABLE =
    "a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])";

  const renderApp = async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Ana menü")).toBeInTheDocument());
    return screen.getByRole("link", { name: "İçeriğe atla" });
  };

  it("bağlantı var ve hedefi DOM'da", async () => {
    const link = await renderApp();

    expect(link).toHaveAttribute("href", "#main-content");

    const target = document.getElementById("main-content");
    expect(target).not.toBeNull();
    // Klavye odağı `main` üzerine taşınabilsin; `tabIndex={-1}` olmadan
    // bağlantı çalışır ama odak hedefte kalmaz.
    expect(target).toHaveAttribute("tabindex", "-1");
  });

  it("ilk odaklanabilir öğedir", async () => {
    const link = await renderApp();

    const focusable = Array.from(document.querySelectorAll<HTMLElement>(FOCUSABLE));
    expect(focusable[0]).toBe(link);
  });

  it("odaklanana kadar görünmez, odaklanınca görünür", async () => {
    const link = await renderApp();

    expect(link.className).toContain("sr-only");
    expect(link.className).toContain("focus:not-sr-only");
  });
});
