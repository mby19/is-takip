import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import * as appLockModule from "../lib/appLock";

/**
 * Entegrasyon uyarıları.
 *
 * Bu dosya, düzeltme ajanlarının ürettiği ama kimsenin bağlamadığı üç
 * davranışı kilitler:
 *   - Kilit açık değilken uygulama DOM'u mount edilmez (I2).
 *   - Dönem kilidi listesi yüklenemediğinde Ayarlar ekranı uyarır (I3).
 *   - Geçersiz hatırlatma saati reddedilip kullanıcıya bildirilir (I5).
 */

const getDb = vi.fn();
const journalModeWarning = vi.fn<() => string | null>();

vi.mock("../lib/db", () => ({
  executeQuery: vi.fn().mockResolvedValue({ rowsAffected: 1 }),
  fetchQuery: vi.fn().mockResolvedValue([]),
  executeTransaction: vi.fn().mockResolvedValue(undefined),
  getDb: () => getDb(),
  getTriggerSetupError: () => null,
  getSchemaReport: () => ({ repaired: [], failures: [], triggersDropped: false }),
  getJournalModeWarning: () => journalModeWarning(),
}));

vi.mock("../lib/appLock", async (importOriginal) => {
  const actual = await importOriginal<typeof appLockModule>();
  return { ...actual, isLockEnabled: () => true };
});
vi.mock("../lib/backup", () => ({ importDatabase: vi.fn() }));

const syncReminders = vi.fn();

vi.mock("../lib/reminder", () => ({
  ensureNotificationPermission: vi.fn().mockResolvedValue(true),
  resetReminderSync: vi.fn(),
  syncReminders: (...args: unknown[]) => syncReminders(...args),
}));

import App from "../App";
import { SettingsView } from "../components/SettingsView";
import { ReminderSection } from "../components/ReminderSection";
import { usePeriodStore } from "../stores/periodStore";
import { useToastStore } from "../stores/toastStore";
import { useReminderStore, INVALID_TIME_MESSAGE } from "../stores/reminderStore";

// jsdom bu kurulumda localStorage sağlamıyor; kilit ekranı açılışta okuyor.
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

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  getDb.mockReset().mockResolvedValue({});
  journalModeWarning.mockReset().mockReturnValue(null);
  syncReminders.mockReset().mockResolvedValue("kuruldu");
  usePeriodStore.setState({ closed: [], closedLoaded: true, error: null, isLoading: false });
  useReminderStore.setState({ enabled: true, time: "18:00" });
  useToastStore.getState().toasts.splice(0);
});

afterEach(cleanup);

describe("kilitliyken uygulama DOM'u", () => {
  it("kilit ekranı açıkken uygulama ağacını mount etmez", async () => {
    render(<App />);

    // Kilit ekranı görünür...
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    // ...ama çalışan/ödeme verisi DOM'da hiç yok.
    expect(screen.queryByLabelText("Ana menü")).not.toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Ana menü" })).not.toBeInTheDocument();
  });
});

describe("SettingsView veritabanı uyarıları", () => {
  it("dönem kilidi listesi yüklenemediğinde yazmanın neden kapalı olduğunu söyler", () => {
    // Kilitliyken tüm tarihler kapalı sayılır (fail-closed): kullanıcı hiçbir
    // şey kaydedemez. Bu yüzden uyarı şart.
    usePeriodStore.setState({ closedLoaded: false, error: "period tablosu okunamadı" });
    render(<SettingsView onBack={() => {}} onNavigateLogs={() => {}} />);

    expect(screen.getByText("Dönem kilidi verisi okunamadı")).toBeInTheDocument();
    expect(
      screen.getByText(/hiçbir puantaj, ücret veya ödeme kaydedemezsiniz/),
    ).toBeInTheDocument();
    expect(screen.getByText("period tablosu okunamadı")).toBeInTheDocument();
  });

  it("kilit listesi yüklenmemiş ama hata metni yoksa da uyarıyı gösterir", () => {
    usePeriodStore.setState({ closedLoaded: false, error: null });
    render(<SettingsView onBack={() => {}} onNavigateLogs={() => {}} />);

    expect(screen.getByText("Dönem kilidi verisi okunamadı")).toBeInTheDocument();
  });

  it("kilit listesi yüklendiyse bu uyarıyı göstermez", () => {
    render(<SettingsView onBack={() => {}} onNavigateLogs={() => {}} />);

    expect(screen.queryByText("Dönem kilidi verisi okunamadı")).not.toBeInTheDocument();
  });

  it("WAL açılamadığında günlük mod uyarısını gösterir", () => {
    journalModeWarning.mockReturnValue("database is locked");
    render(<SettingsView onBack={() => {}} onNavigateLogs={() => {}} />);

    expect(screen.getByText("Veritabanı günlük modu kapalı")).toBeInTheDocument();
    expect(screen.getByText("database is locked")).toBeInTheDocument();
  });
});

describe("ReminderSection saat doğrulama", () => {
  it("geçersiz saati reddedip kullanıcıya bildirir", () => {
    render(<ReminderSection />);
    const input = screen.getByLabelText("Hatırlatma saati");

    fireEvent.change(input, { target: { value: "99:99" } });

    expect(useToastStore.getState().toasts).toEqual([
      expect.objectContaining({ message: INVALID_TIME_MESSAGE, type: "error" }),
    ]);
    // Ayar eski değerinde kalır — kullanıcı bunu bildirimden anlar.
    expect(useReminderStore.getState().time).toBe("18:00");
  });

  it("geçerli saati kabul eder ve bildirim atmaz", () => {
    render(<ReminderSection />);
    const input = screen.getByLabelText("Hatırlatma saati");

    fireEvent.change(input, { target: { value: "09:30" } });

    expect(useToastStore.getState().toasts).toHaveLength(0);
    expect(useReminderStore.getState().time).toBe("09:30");
  });
});

describe("ReminderSection senkronizasyon sonucu", () => {
  it("kurulum başarısız olursa 'kuruldu' bildirimi atmaz", async () => {
    syncReminders.mockResolvedValue("izin-yok");
    // Ayar kapalı başlar: düğme AÇAR ve senkronizasyon yolunu çalıştırır.
    useReminderStore.setState({ enabled: false, time: "18:00" });
    render(<ReminderSection />);

    fireEvent.click(screen.getByRole("button", { name: /Hatırlatma kapalı/ }));
    await vi.waitFor(() => expect(syncReminders).toHaveBeenCalled());

    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages.some((m) => m.includes("her gün 18:00 için hatırlatma kuruldu"))).toBe(false);
    expect(messages.some((m) => m.includes("kurulamadı"))).toBe(true);
  });

  it("kurulum başarılı olursa 'kuruldu' bildirimi atar", async () => {
    syncReminders.mockResolvedValue("kuruldu");
    useReminderStore.setState({ enabled: false, time: "18:00" });
    render(<ReminderSection />);

    fireEvent.click(screen.getByRole("button", { name: /Hatırlatma kapalı/ }));
    await vi.waitFor(() => expect(syncReminders).toHaveBeenCalled());

    const messages = useToastStore.getState().toasts.map((t) => t.message);
    expect(messages).toContain("Her gün 18:00 için hatırlatma kuruldu");
  });
});
