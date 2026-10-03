import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { ErrorBoundary } from "../components/ErrorBoundary";
import { APP_VERSION } from "../lib/appInfo";

const writeText = vi.fn();

/** Kontrollü biçimde hata fırlatan alt bileşen. */
function Boom({ shouldThrow }: { shouldThrow: boolean }) {
  if (shouldThrow) throw new Error("puantaj kaydedilemedi: 12.500,00 TL");
  return <p>uygulama çalışıyor</p>;
}

beforeEach(() => {
  writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { writeText },
  });
  // React, render hatasını konsola yazar; test çıktısını okunmaz hale getirir.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const crash = () =>
  render(
    <ErrorBoundary>
      <Boom shouldThrow />
    </ErrorBoundary>,
  );

describe("ErrorBoundary — hata ekranı", () => {
  it("çökme ekranında sürümü gösterir", () => {
    // Sürüm olmadan "hangi sürümde?" sorusu cevapsız kalır ve hata
    // bildirimi işe yaramaz.
    crash();

    expect(screen.getByText("Beklenmeyen Bir Hata Oluştu")).toBeInTheDocument();
    // Sürüm iki yerde görünür: başlık satırı ve kopyalanacak rapor.
    expect(screen.getAllByText(/^Sürüm/).length).toBeGreaterThan(0);
  });

  it("hata bildirimini panoya kopyalar", async () => {
    crash();

    fireEvent.click(screen.getByRole("button", { name: /panoya kopyala/i }));

    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = writeText.mock.calls[0][0] as string;
    // Rapor üç şeyi de taşımalı: sürüm, hata metni, cihaz.
    expect(copied).toContain(`Sürüm: ${APP_VERSION}`);
    expect(copied).toContain("puantaj kaydedilemedi");
    expect(copied).toContain(navigator.userAgent);

    expect(await screen.findByRole("button", { name: /panoya kopyalandı/i })).toBeInTheDocument();
  });

  it("kopyalama başarısız olursa 'kopyalandı' demez, metin ekranda kalır", async () => {
    writeText.mockRejectedValue(new Error("pano izni yok"));
    crash();

    fireEvent.click(screen.getByRole("button", { name: /panoya kopyala/i }));

    // Yanlış onay, kullanıcının desteğe yapıştıracağı bilginin gitmediği
    // anlamına gelir — en kötü hata bu yüzden sessiz kalmak.
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /panoya kopyalandı/i })).not.toBeInTheDocument(),
    );
    // Rapor yine de ekranda seçilebilir durumda.
    expect(screen.getByText(/Sürüm:/)).toBeInTheDocument();
  });

  it("yeniden başlatınca kopyalandı durumu sıfırlanır", async () => {
    const reload = vi.fn();
    Object.defineProperty(window, "location", {
      configurable: true,
      value: { ...window.location, reload },
    });
    crash();
    fireEvent.click(screen.getByRole("button", { name: /panoya kopyala/i }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /panoya kopyalandı/i })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole("button", { name: /Yeniden Başlat/ }));

    expect(reload).toHaveBeenCalled();
  });
});
