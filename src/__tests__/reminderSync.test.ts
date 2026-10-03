import { describe, it, expect, beforeEach, vi } from "vitest";

const fetchQuery = vi.fn();

vi.mock("../lib/db", () => ({
  executeQuery: vi.fn(),
  executeTransaction: vi.fn(),
  fetchQuery: (...a: unknown[]) => fetchQuery(...a),
  getDb: vi.fn(),
  getTriggerSetupError: () => null,
}));

const sendNotification = vi.fn();
const cancel = vi.fn();
const registerActionTypes = vi.fn();
const isPermissionGranted = vi.fn();

vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: (...a: unknown[]) => sendNotification(...a),
  cancel: (...a: unknown[]) => cancel(...a),
  registerActionTypes: (...a: unknown[]) => registerActionTypes(...a),
  isPermissionGranted: (...a: unknown[]) => isPermissionGranted(...a),
  Schedule: { at: (at: Date) => ({ kind: "at", at }) },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: (cmd: string) => {
    if (cmd === "plugin:notification|is_permission_granted") return isPermissionGranted();
    throw new Error(`beklenmeyen komut: ${cmd}`);
  },
}));

import {
  buildSignature,
  currentTimeZoneSignature,
  isDayComplete,
  isMobilePlatform,
  planReminders,
  resetReminderSync,
  syncReminders,
} from "../lib/reminder";
import { useReminderStore } from "../stores/reminderStore";

const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Mobile Safari/537.36";

const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17 Safari/605.1.15";

/** jsdom'da localStorage yok; ayar yazmak için basit taklit. */
const memoryStorage = () => {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as Storage;
};

/** 40 aktif çalışan, n tanesi için kayıt var. */
const dayCounts = (active: number, recorded: number) => {
  fetchQuery.mockResolvedValue([{ active, recorded }]);
};

beforeEach(() => {
  fetchQuery.mockReset();
  sendNotification.mockReset();
  cancel.mockReset().mockResolvedValue(undefined);
  registerActionTypes.mockReset().mockResolvedValue(undefined);
  isPermissionGranted.mockReset().mockResolvedValue(null);
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("navigator", { userAgent: ANDROID_UA });
  useReminderStore.setState({ enabled: true, time: "18:00" });
  resetReminderSync();
});

describe("günün dolu sayılma ölçütü", () => {
  it("40 çalışandan 1'i işaretlenince gün dolu sayılmaz", () => {
    expect(isDayComplete(40, 1)).toBe(false);
  });

  it("40/40 kayıt varsa gün doludur", () => {
    expect(isDayComplete(40, 40)).toBe(true);
  });

  it("pasif çalışanların kaydı sayılmaz", () => {
    // recorded yalnız AKTİF çalışanları kapsar (SQL join'i) → 39/40.
    expect(isDayComplete(40, 39)).toBe(false);
  });

  it("aktif çalışan yoksa gün dolu sayılmaz", () => {
    expect(isDayComplete(0, 0)).toBe(false);
  });
});

describe("bildirim planı «bugün dolu» ölçütüyle", () => {
  const now = new Date("2026-05-10T09:00:00");

  it("1/40 kayıt varsa bugünün bildirimi yine kurulur", () => {
    const plan = planReminders({ time: "18:00", filledToday: false, now, daysAhead: 2 });
    expect(plan).toHaveLength(2);
    expect(plan[0].isToday).toBe(true);
  });

  it("40/40 kayıt varsa bugün atlanır", () => {
    const plan = planReminders({ time: "18:00", filledToday: true, now, daysAhead: 2 });
    expect(plan).toHaveLength(1);
    expect(plan[0].isToday).toBe(false);
  });
});

describe("platform tespiti", () => {
  it("masaüstü user agent'ı mobil sayılmaz", () => {
    expect(isMobilePlatform(DESKTOP_UA)).toBe(false);
  });

  it("Android user agent'ı mobildir", () => {
    expect(isMobilePlatform(ANDROID_UA)).toBe(true);
  });
});

describe("senkronizasyon imzası", () => {
  const base = {
    enabled: true,
    time: "18:00",
    today: "2026-05-10",
    filledToday: false,
    timeZone: "Europe/Istanbul@180",
  };

  it("saat dilimi değişince imza değişir", () => {
    expect(buildSignature({ ...base, timeZone: "Europe/Istanbul@180" })).not.toBe(
      buildSignature({ ...base, timeZone: "Europe/Berlin@120" }),
    );
  });

  it("aynı girdi aynı imzayı verir", () => {
    expect(buildSignature(base)).toBe(buildSignature({ ...base }));
  });

  it("ofset bilgisini içerir", () => {
    expect(currentTimeZoneSignature(new Date("2026-05-10T09:00:00"))).toMatch(/@/);
  });
});

describe("syncReminders", () => {
  it("masaüstünde iptal komutunu çağırmaz", async () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA });

    expect(await syncReminders()).toBe("masaustu-desteklenmiyor");

    expect(cancel).not.toHaveBeenCalled();
    expect(sendNotification).not.toHaveBeenCalled();
  });

  it("masaüstünde veritabanına da sorgu atmaz", async () => {
    vi.stubGlobal("navigator", { userAgent: DESKTOP_UA });

    await syncReminders();

    expect(fetchQuery).not.toHaveBeenCalled();
  });

  it("izni reddedilmişse imzayı yazmaz, sonraki çağrıda yeniden dener", async () => {
    dayCounts(40, 0);
    isPermissionGranted.mockResolvedValue(false);

    expect(await syncReminders()).toBe("izin-yok");
    expect(sendNotification).not.toHaveBeenCalled();

    // İmza yazılmadığı için aynı durumda tekrar kurulum denenir.
    expect(await syncReminders()).toBe("izin-yok");
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("izin sonradan açılırsa hatırlatma kurulur", async () => {
    dayCounts(40, 0);
    isPermissionGranted.mockResolvedValue(false);
    await syncReminders();

    isPermissionGranted.mockResolvedValue(true);

    expect(await syncReminders()).toBe("kuruldu");
    expect(sendNotification).toHaveBeenCalled();
  });

  it("kurulum başarısız olunca imza sıfırlanır ve hata Sentry'ye düşmez tekrar", async () => {
    dayCounts(40, 0);
    cancel.mockRejectedValue(new Error("channel yok"));

    expect(await syncReminders()).toBe("hata");

    cancel.mockResolvedValue(undefined);
    expect(await syncReminders()).toBe("kuruldu");
  });

  it("başarılı kurulumdan sonra aynı imzayla tekrar kurmaz", async () => {
    dayCounts(40, 0);

    expect(await syncReminders()).toBe("kuruldu");
    const count = sendNotification.mock.calls.length;

    expect(await syncReminders()).toBe("değişiklik-yok");
    expect(sendNotification.mock.calls).toHaveLength(count);
  });

  it("40/40 dolu günde yalnız yarın ve öbür günler planlanır", async () => {
    dayCounts(40, 40);

    expect(await syncReminders()).toBe("kuruldu");

    const todayFired = sendNotification.mock.calls.some(([arg]) => {
      const at = (arg.schedule as { at: Date }).at;
      return at.toDateString() === new Date().toDateString();
    });
    expect(todayFired).toBe(false);
  });
});
