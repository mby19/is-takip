import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, act, waitFor } from "@testing-library/react";

const getDb = vi.fn();
const importDatabase = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  fetchQuery: vi.fn().mockResolvedValue([]),
  executeTransaction: vi.fn().mockResolvedValue(undefined),
  getDb: () => getDb(),
  getTriggerSetupError: () => null,
}));
vi.mock("../lib/appLock", () => ({ isLockEnabled: () => false }));
vi.mock("../lib/backup", () => ({
  importDatabase: (...args: unknown[]) => importDatabase(...args),
}));

import App from "../App";

beforeEach(() => {
  getDb.mockReset().mockResolvedValue({});
  importDatabase.mockReset();
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

const pressEscape = async () => {
  await act(async () => {
    fireEvent.keyDown(document.body, { key: "Escape" });
  });
};

describe("App geri navigasyonu", () => {
  it("tab değiştirir", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Ana menü")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kişiler" }));
    });

    expect(await screen.findByRole("heading", { name: "Ekip" })).toBeInTheDocument();
  });

  it("kök ekranda Escape ekran değiştirmez, çıkış uyarısı verir", async () => {
    render(<App />);
    await waitFor(() => expect(screen.getByLabelText("Ana menü")).toBeInTheDocument());

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Kişiler" }));
    });
    await pressEscape();

    // Aynı ekranda kaldık ve kullanıcı çıkışın iki basışla olacağını öğrendi.
    expect(screen.getByRole("heading", { name: "Ekip" })).toBeInTheDocument();
    expect(await screen.findByText("Çıkmak için tekrar geri tuşuna basın")).toBeInTheDocument();
  });
});

describe("App veritabanı hatası ekranı", () => {
  beforeEach(() => {
    getDb.mockRejectedValue(new Error("veritabanı dosyası okunamadı"));
  });

  it("veriye erişilemediğinde kurtarma yolu sunar", async () => {
    render(<App />);

    expect(await screen.findByText("Veritabanı Açılamadı")).toBeInTheDocument();
    expect(screen.getByText(/veritabanı dosyası okunamadı/)).toBeInTheDocument();

    // Sonsuz yeniden deneme döngüsünden çıkan tek yol: yedekten geri yükleme.
    expect(screen.getByText("Yedekten Geri Yükle")).toBeInTheDocument();
  });
});
