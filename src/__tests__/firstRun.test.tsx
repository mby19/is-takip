import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const executeQuery = vi.fn();
const fetchQuery = vi.fn();
const importDatabase = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: (...args: unknown[]) => executeQuery(...args),
  fetchQuery: (...args: unknown[]) => fetchQuery(...args),
  executeTransaction: vi.fn(),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));
vi.mock("../lib/backup", () => ({
  importDatabase: (...args: unknown[]) => importDatabase(...args),
}));
vi.mock("../lib/appLock", () => ({ isLockEnabled: () => false }));

import App from "../App";
import { WorkersScreen } from "../components/WorkersScreen";
import { useWorkerStore } from "../stores/workerStore";
import type { Worker } from "../types";

const worker = (id: number, name: string): Worker => ({
  id,
  name,
  daily_wage: 900,
  worker_type: "GUNLUK",
  is_active: true,
  created_at: "2026-01-01",
});

beforeEach(() => {
  executeQuery.mockReset().mockResolvedValue({ rowsAffected: 1 });
  fetchQuery.mockReset().mockResolvedValue([]);
  importDatabase.mockReset().mockResolvedValue({
    workers: 3,
    attendance: 12,
  });
  useWorkerStore.setState({ workers: [], isLoading: false, error: null });
  window.history.replaceState(null, "", "/");
});

afterEach(cleanup);

/**
 * jsdom `window.location.reload`'u uygulamaz; geri yükleme akışı sayfa
 * yenilemesiyle bitiyor. Yenileme çağrısını sayma yerine taklit edip
 * geri yüklemenin **başarıyla** tamamlandığını doğruluyoruz.
 */
const stubReload = () => {
  const reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  return reload;
};

const chooseBackupFile = async (content: string) => {
  const input = screen.getByLabelText("Yedek dosyası seç") as HTMLInputElement;
  const file = new File([content], "is_takip_backup_2026.json", { type: "application/json" });
  fireEvent.change(input, { target: { files: [file] } });
};

describe("İlk açılış — boş durum", () => {
  it("boş takvimde ekibin nereye ekleneceğini doğrudan gösterir", async () => {
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Başlangıç" })).toBeInTheDocument(),
    );

    expect(screen.getByRole("button", { name: /Personel Ekle/ })).toBeInTheDocument();

    // Düğme yalnızca yönlendirme metni değil: Kişiler ekranına geçmeli.
    fireEvent.click(screen.getByRole("button", { name: /Personel Ekle/ }));
    expect(await screen.findByRole("heading", { name: "Ekip" })).toBeInTheDocument();
  });

  it("başka cihazda kullanılmışsa yedekten geri yükleme yolunu sunar", async () => {
    const reload = stubReload();
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Başlangıç" })).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Başka cihazda mı kullandınız\? Yedekten geri yükle/ }),
    );

    await chooseBackupFile(JSON.stringify({ version: 4 }));

    await waitFor(() =>
      expect(importDatabase).toHaveBeenCalledWith(JSON.stringify({ version: 4 })),
    );
    // Geri yükleme bitince uygulama kendini yeniler; eski boş ekran kalırsa
    // kullanıcı yedeklenmiş veriyi göremez.
    expect(reload).toHaveBeenCalled();
  });

  it("bozuk yedekte sessizce yutulmaz, nedeni ekranda gösterir", async () => {
    stubReload();
    importDatabase.mockRejectedValue(new Error("yedek biçimi tanınmıyor"));
    render(<App />);
    await waitFor(() =>
      expect(screen.getByRole("region", { name: "Başlangıç" })).toBeInTheDocument(),
    );

    fireEvent.click(
      screen.getByRole("button", { name: /Başka cihazda mı kullandınız\? Yedekten geri yükle/ }),
    );
    await chooseBackupFile("{bozuk");

    expect(await screen.findByText(/Geri yükleme başarısız/)).toHaveTextContent(
      "yedek biçimi tanınmıyor",
    );
  });
});

describe("Kişiler ekranı — ekip boşken", () => {
  it("ekip yokken yedek yolunu hatırlatır", () => {
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    expect(screen.getByText(/Bu cihazda henüz veri yok/)).toBeInTheDocument();
    // Ekibi kurma yolu her durumda ekranda durmalı.
    expect(screen.getByRole("button", { name: /Yeni Kişi Ekle/ })).toBeInTheDocument();
  });

  it("ekip varken bu hatırlatıcı kaybolur", () => {
    useWorkerStore.setState({ workers: [worker(1, "Ayşe")], isLoading: false, error: null });
    render(<WorkersScreen onWorkerClick={vi.fn()} />);

    expect(screen.queryByText(/Bu cihazda henüz veri yok/)).not.toBeInTheDocument();
  });
});
