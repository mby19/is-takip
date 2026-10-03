import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("../lib/db", () => ({
  executeQuery: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  fetchQuery: vi.fn().mockResolvedValue([]),
  executeTransaction: vi.fn().mockResolvedValue(undefined),
  getDb: vi.fn().mockRejectedValue(new Error("testte bağlantı açılmaz")),
  getTriggerSetupError: () => null,
}));

import { WorkersScreen } from "../components/WorkersScreen";
import { useWorkerStore } from "../stores/workerStore";
import type { Worker } from "../types";

const worker = (id: number, name: string, extra: Partial<Worker> = {}): Worker => ({
  id,
  name,
  daily_wage: 900,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
  ...extra,
});

const TEAM: Worker[] = [
  worker(1, "Ayşe"),
  worker(2, "Berna"),
  worker(3, "Çetin"),
  worker(4, "Şahin"),
  worker(5, "Zeynep"),
  worker(6, "Mehmet", { short_label: "MM" }),
];

/** Ekranda listelenen çalışan isimlerini DOM sırasıyla döndürür. */
const listedNames = (pool: readonly Worker[] = TEAM) =>
  screen
    .getAllByRole("button")
    .map((b) => b.textContent ?? "")
    .map((text) => pool.find((w) => text.includes(w.name)))
    .filter((w): w is Worker => Boolean(w))
    .map((w) => w.name);

const visibleNames = () => listedNames();
const searchBox = () => screen.getByLabelText("Kişi ara");

// Not: Ekip listesinin TÜRKÇE ALFABET SIRASI repository'de (`workerRepository
// .findAll`) üretilir ve gerçek SQLite üzerinde doğrulanır
// (`workerSorting.test.ts`). Ekranda sıralama yapılmaz; ekran store'daki
// sırayı olduğu gibi gösterir, arama o sırayı süzer.

beforeEach(() => {
  useWorkerStore.setState({
    workers: TEAM,
    isLoading: false,
    error: null,
  });
});

afterEach(cleanup);

describe("WorkersScreen — arama", () => {
  it("arama kutusu açılışta boş listeyi değiştirmez", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);
    expect(searchBox()).toHaveValue("");
    expect(visibleNames()).toHaveLength(TEAM.length);
    expect(screen.getByText("6 kişi aktif")).toBeInTheDocument();
  });

  it("isimde aksan ve büyük/küçük harf duyarsız arar", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    // Küçük harf, aksansız yazım: "sahin" → "Şahin", "cetin" → "Çetin".
    fireEvent.change(searchBox(), { target: { value: "sahin" } });
    expect(visibleNames()).toEqual(["Şahin"]);

    fireEvent.change(searchBox(), { target: { value: "SAHİN" } });
    expect(visibleNames()).toEqual(["Şahin"]);

    fireEvent.change(searchBox(), { target: { value: "cetin" } });
    expect(visibleNames()).toEqual(["Çetin"]);

    fireEvent.change(searchBox(), { target: { value: "ayse" } });
    expect(visibleNames()).toEqual(["Ayşe"]);
  });

  it("kısa etiket üzerinden de arar", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    fireEvent.change(searchBox(), { target: { value: "mm" } });

    expect(visibleNames()).toEqual(["Mehmet"]);
  });

  it("sonuç sayısını gösterir", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    // "e" geçenler: Ayşe, Berna, Çetin, Zeynep, Mehmet. "Şahin"de "e" yok.
    fireEvent.change(searchBox(), { target: { value: "e" } });

    expect(visibleNames()).toEqual(["Ayşe", "Berna", "Çetin", "Zeynep", "Mehmet"]);
    expect(screen.getByText("5 kişi bulundu")).toBeInTheDocument();
  });

  it("sonuç yoksa boş durum gösterir, temizle butonu listeyi geri getirir", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    fireEvent.change(searchBox(), { target: { value: "olmayan-kisi" } });

    expect(visibleNames()).toHaveLength(0);
    expect(screen.getByText(/için kişi bulunamadı/)).toBeInTheDocument();
    expect(screen.getByText("0 kişi bulundu")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Aramayı temizle"));

    expect(searchBox()).toHaveValue("");
    expect(visibleNames()).toHaveLength(TEAM.length);
  });

  it("arşivlenmiş çalışanlar aramaya girmez", () => {
    useWorkerStore.setState({
      workers: [...TEAM, worker(7, "Yusuf", { is_active: false })],
    });
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    fireEvent.change(searchBox(), { target: { value: "yusuf" } });

    expect(visibleNames()).toHaveLength(0);
    expect(screen.getByText(/için kişi bulunamadı/)).toBeInTheDocument();
  });
});

describe("WorkersScreen — arama klavye kısayolları", () => {
  it("'/' arama kutusuna odaklanır", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);
    expect(searchBox()).not.toHaveFocus();

    fireEvent.keyDown(window, { key: "/" });

    expect(searchBox()).toHaveFocus();
  });

  it("Cmd/Ctrl+F arama kutusuna odaklanır", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    fireEvent.keyDown(window, { key: "f", metaKey: true });
    expect(searchBox()).toHaveFocus();

    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.keyDown(window, { key: "f", ctrlKey: true });
    expect(searchBox()).toHaveFocus();
  });

  it("metin alanına yazarken '/' kısayolu devreye girmez", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);
    // `fireEvent.change` jsdom'da odaklamaz; kısayol testi odaklı alan varsayıyor.
    searchBox().focus();
    fireEvent.change(searchBox(), { target: { value: "Ay" } });

    // Yazarken `/` bir karakterdir: global kısayol metni yutmaz, odağı
    // kaçırmaz. `fireEvent.keyDown` tuşu DOM'a yazmaz, bu yüzden buradaki
    // iddia "kısayol `preventDefault` yapmadı" — yani yazma engellenmedi.
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    fireEvent(searchBox(), event);

    expect(event.defaultPrevented).toBe(false);
    expect(searchBox()).toHaveValue("Ay");
    expect(searchBox()).toHaveFocus();
  });

  it("Escape arama metnini temizler", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    fireEvent.change(searchBox(), { target: { value: "şahin" } });
    expect(visibleNames()).toEqual(["Şahin"]);

    fireEvent.keyDown(searchBox(), { key: "Escape" });

    expect(searchBox()).toHaveValue("");
    expect(visibleNames()).toHaveLength(TEAM.length);
  });

  it("Escape global geri işleyicisini tetiklemez (preventDefault)", () => {
    const onBack = vi.fn();
    window.addEventListener("keydown", onBack);
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    fireEvent.change(searchBox(), { target: { value: "şahin" } });
    const event = new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });
    fireEvent(searchBox(), event);

    expect(event.defaultPrevented).toBe(true);
    window.removeEventListener("keydown", onBack);
  });
});
