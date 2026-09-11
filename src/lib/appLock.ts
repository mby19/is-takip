/**
 * Uygulama kilidi için kimlik doğrulama.
 *
 * Emoji deseni ve kurtarma PIN'i artık düz metin olarak değil, cihaza özel
 * rastgele bir tuz ile SHA-256 özeti olarak saklanır. Böylece cihaza fiziksel
 * erişimi olan biri localStorage'ı okuyup deseni/PIN'i doğrudan göremez.
 *
 * Not: Bu, yerel bir uygulamada saldırganı tamamen durdurmaz (veritabanı
 * dosyası zaten açık); amaç, kilidin gözle okunabilir olmasını engellemek ve
 * kaba kuvvet denemesini yavaşlatmaktır.
 */

const KEYS = {
  enabled: "appLockEnabled",
  salt: "appLockSalt",
  sequence: "appLockSequenceHash",
  pin: "appLockPinHash",
  failures: "appLockFailures",
  lockedUntil: "appLockLockedUntil",
  // Eski (düz metin) anahtarlar — geçiş sırasında temizlenir.
  legacySequence: "appLockSequence",
  legacyPin: "appLockPin",
} as const;

const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 60_000;

const toHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const getSalt = (): string => {
  let salt = localStorage.getItem(KEYS.salt);
  if (!salt) {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    salt = toHex(bytes.buffer);
    localStorage.setItem(KEYS.salt, salt);
  }
  return salt;
};

export const hashSecret = async (value: string): Promise<string> => {
  const data = new TextEncoder().encode(`${getSalt()}:${value}`);
  return toHex(await crypto.subtle.digest("SHA-256", data));
};

export const isLockEnabled = (): boolean => localStorage.getItem(KEYS.enabled) === "true";

export const hasRecoveryPin = (): boolean => !!localStorage.getItem(KEYS.pin);

/** Kilidi kurar. Desen ve PIN yalnızca özet olarak saklanır. */
export const configureLock = async (sequence: string[], pin: string): Promise<void> => {
  localStorage.setItem(KEYS.sequence, await hashSecret(sequence.join("-")));
  localStorage.setItem(KEYS.pin, await hashSecret(pin));
  localStorage.setItem(KEYS.enabled, "true");
  localStorage.removeItem(KEYS.legacySequence);
  localStorage.removeItem(KEYS.legacyPin);
  clearFailures();
};

export const disableLock = (): void => {
  localStorage.removeItem(KEYS.enabled);
  localStorage.removeItem(KEYS.sequence);
  localStorage.removeItem(KEYS.pin);
  localStorage.removeItem(KEYS.legacySequence);
  localStorage.removeItem(KEYS.legacyPin);
  clearFailures();
};

/** Kalan kilitlenme süresi (saniye). 0 ise deneme yapılabilir. */
export const lockoutSecondsLeft = (): number => {
  const until = Number(localStorage.getItem(KEYS.lockedUntil) || 0);
  if (!until) return 0;
  const left = Math.ceil((until - Date.now()) / 1000);
  return left > 0 ? left : 0;
};

export const failureCount = (): number => Number(localStorage.getItem(KEYS.failures) || 0);

const clearFailures = (): void => {
  localStorage.removeItem(KEYS.failures);
  localStorage.removeItem(KEYS.lockedUntil);
};

const registerFailure = (): void => {
  const next = failureCount() + 1;
  localStorage.setItem(KEYS.failures, String(next));
  if (next >= MAX_ATTEMPTS) {
    localStorage.setItem(KEYS.lockedUntil, String(Date.now() + LOCKOUT_MS));
    localStorage.setItem(KEYS.failures, "0");
  }
};

export interface VerifyResult {
  ok: boolean;
  /** Kilitlenme aktifse kalan saniye. */
  lockedFor: number;
  attemptsLeft: number;
}

const verify = async (value: string, storageKey: string, legacyKey?: string): Promise<boolean> => {
  const stored = localStorage.getItem(storageKey);
  if (stored) return (await hashSecret(value)) === stored;

  // Geçiş: eski düz metin kayıt varsa bir kez doğrula ve hemen özete çevir.
  if (legacyKey) {
    const legacy = localStorage.getItem(legacyKey);
    if (legacy && legacy === value) {
      localStorage.setItem(storageKey, await hashSecret(value));
      localStorage.removeItem(legacyKey);
      return true;
    }
  }
  return false;
};

export const verifySequence = async (sequence: string[]): Promise<VerifyResult> => {
  const lockedFor = lockoutSecondsLeft();
  if (lockedFor > 0) return { ok: false, lockedFor, attemptsLeft: 0 };

  // Eski format desen dizisini JSON olarak saklıyordu.
  const legacyRaw = localStorage.getItem(KEYS.legacySequence);
  if (legacyRaw && !localStorage.getItem(KEYS.sequence)) {
    try {
      const legacy: string[] = JSON.parse(legacyRaw);
      if (legacy.length === sequence.length && legacy.every((v, i) => v === sequence[i])) {
        localStorage.setItem(KEYS.sequence, await hashSecret(sequence.join("-")));
        localStorage.removeItem(KEYS.legacySequence);
        clearFailures();
        return { ok: true, lockedFor: 0, attemptsLeft: MAX_ATTEMPTS };
      }
    } catch {
      /* bozuk eski kayıt yok sayılır */
    }
  }

  const ok = await verify(sequence.join("-"), KEYS.sequence);
  if (ok) clearFailures();
  else registerFailure();

  return {
    ok,
    lockedFor: lockoutSecondsLeft(),
    attemptsLeft: Math.max(MAX_ATTEMPTS - failureCount(), 0),
  };
};

export const verifyPin = async (pin: string): Promise<VerifyResult> => {
  const lockedFor = lockoutSecondsLeft();
  if (lockedFor > 0) return { ok: false, lockedFor, attemptsLeft: 0 };

  const ok = await verify(pin, KEYS.pin, KEYS.legacyPin);
  if (ok) clearFailures();
  else registerFailure();

  return {
    ok,
    lockedFor: lockoutSecondsLeft(),
    attemptsLeft: Math.max(MAX_ATTEMPTS - failureCount(), 0),
  };
};

export const LOCK_MAX_ATTEMPTS = MAX_ATTEMPTS;
