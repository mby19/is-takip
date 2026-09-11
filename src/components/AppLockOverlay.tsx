import { useState, useEffect } from "react";
import { Lock, ArrowLeft, ShieldAlert, Timer } from "lucide-react";
import {
  verifySequence,
  verifyPin,
  disableLock,
  lockoutSecondsLeft,
  LOCK_MAX_ATTEMPTS,
} from "../lib/appLock";

const EMOJIS = [
  { id: "panda", char: "🐼", name: "Panda" },
  { id: "rocket", char: "🚀", name: "Roket" },
  { id: "diamond", char: "💎", name: "Elmas" },
  { id: "unicorn", char: "🦄", name: "Unicorn" },
  { id: "clover", char: "🍀", name: "Yonca" },
  { id: "pizza", char: "🍕", name: "Pizza" },
  { id: "guitar", char: "🎸", name: "Gitar" },
  { id: "saturn", char: "🪐", name: "Satürn" },
  { id: "crown", char: "👑", name: "Taç" },
];

interface AppLockOverlayProps {
  onUnlock: () => void;
}

export function AppLockOverlay({ onUnlock }: AppLockOverlayProps) {
  const [selectedSequence, setSelectedSequence] = useState<string[]>([]);
  const [isShaking, setIsShaking] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoveryError, setRecoveryError] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(LOCK_MAX_ATTEMPTS);
  const [lockedFor, setLockedFor] = useState(() => lockoutSecondsLeft());
  const [busy, setBusy] = useState(false);

  // Kilitlenme süresi geri sayımı.
  useEffect(() => {
    if (lockedFor <= 0) return;
    const timer = setInterval(() => setLockedFor(lockoutSecondsLeft()), 1000);
    return () => clearInterval(timer);
  }, [lockedFor]);

  const isBlocked = lockedFor > 0 || busy || isExiting;

  const handleEmojiSelect = async (id: string) => {
    if (isBlocked || isShaking) return;

    const newSequence = [...selectedSequence, id];
    setSelectedSequence(newSequence);
    if (newSequence.length < 3) return;

    setBusy(true);
    try {
      const result = await verifySequence(newSequence);
      if (result.ok) {
        setIsExiting(true);
        setTimeout(onUnlock, 600);
        return;
      }

      setAttemptsLeft(result.attemptsLeft);
      setLockedFor(result.lockedFor);
      setIsShaking(true);
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      setTimeout(() => {
        setIsShaking(false);
        setSelectedSequence([]);
      }, 600);
    } finally {
      setBusy(false);
    }
  };

  const handlePinKeyPress = async (num: string) => {
    if (isBlocked || recoveryPin.length >= 4) return;

    const newPin = recoveryPin + num;
    setRecoveryError(false);
    setRecoveryPin(newPin);
    if (newPin.length < 4) return;

    setBusy(true);
    try {
      const result = await verifyPin(newPin);
      if (result.ok) {
        // Kurtarma PIN'i doğruysa kilit tamamen kaldırılır.
        disableLock();
        setIsExiting(true);
        setTimeout(() => {
          onUnlock();
          window.location.reload();
        }, 500);
        return;
      }

      setAttemptsLeft(result.attemptsLeft);
      setLockedFor(result.lockedFor);
      setRecoveryError(true);
      if (navigator.vibrate) navigator.vibrate(150);
      setTimeout(() => {
        setRecoveryPin("");
        setRecoveryError(false);
      }, 800);
    } finally {
      setBusy(false);
    }
  };

  const handlePinDelete = () => {
    if (recoveryPin.length > 0) setRecoveryPin(recoveryPin.slice(0, -1));
  };

  const lockoutNotice = lockedFor > 0 && (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
      <Timer className="w-4 h-4 shrink-0" />
      <span className="text-xs font-bold">
        Çok fazla hatalı deneme. {lockedFor} saniye sonra tekrar deneyin.
      </span>
    </div>
  );

  return (
    <div
      className={`absolute inset-0 z-9999 w-screen h-screen flex flex-col justify-center items-center bg-background/80 backdrop-blur-2xl transition-all duration-500 ease-in-out select-none ${
        isExiting ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
      }`}
      role="dialog"
      aria-modal="true"
      aria-label="Uygulama kilidi"
    >
      <div className="w-full max-w-md h-full flex flex-col items-center justify-between px-6 py-14 relative bg-background">
        {!isRecoveryMode ? (
          <>
            <div className="flex flex-col items-center text-center mt-6 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-float">
                <Lock className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-black tracking-tight">Kilitli</h2>
                <p className="text-xs text-muted-foreground font-semibold max-w-70">
                  Girmek için 3 resmi sırasıyla seç
                </p>
              </div>
            </div>

            <div className="flex justify-center items-center gap-4 my-6">
              {[0, 1, 2].map((idx) => {
                const isSelected = selectedSequence.length > idx;
                const emojiObj = EMOJIS.find((e) => e.id === selectedSequence[idx]);
                return (
                  <div
                    key={idx}
                    className={`w-12 h-12 rounded-xl flex items-center justify-center text-xl font-bold border-2 transition-all duration-300 ${
                      isShaking
                        ? "border-destructive bg-destructive/10 text-destructive animate-shake"
                        : isSelected
                          ? "border-amber-500 bg-amber-500/10 scale-110 shadow-md shadow-amber-500/10"
                          : "border-border bg-muted/40"
                    }`}
                  >
                    {isSelected && emojiObj ? emojiObj.char : ""}
                  </div>
                );
              })}
            </div>

            <div
              className={`grid grid-cols-3 gap-3.5 w-full max-w-[320px] transition-transform duration-300 ${
                isShaking ? "animate-shake" : ""
              }`}
            >
              {EMOJIS.map((emoji) => {
                const isPartiallySelected = selectedSequence.includes(emoji.id);
                return (
                  <button
                    key={emoji.id}
                    onClick={() => void handleEmojiSelect(emoji.id)}
                    disabled={isBlocked || isShaking}
                    aria-label={emoji.name}
                    className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-center transition-all duration-200 active:scale-90 disabled:opacity-50 ${
                      isPartiallySelected
                        ? "border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/5 scale-95"
                        : "border-border bg-card/75 hover:border-amber-400/50 hover:bg-amber-400/5"
                    }`}
                  >
                    <span className="text-3xl filter drop-shadow-sm mb-1">{emoji.char}</span>
                    <span className="text-[10px] font-black uppercase tracking-wider text-muted-foreground/70">
                      {emoji.name}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="flex flex-col items-center gap-3 mt-6 w-full">
              {lockoutNotice}
              {lockedFor === 0 && attemptsLeft < LOCK_MAX_ATTEMPTS && (
                <p className="text-[11px] font-bold text-muted-foreground">
                  Kalan deneme: {attemptsLeft}/{LOCK_MAX_ATTEMPTS}
                </p>
              )}
              <button
                onClick={() => setIsRecoveryMode(true)}
                className="text-xs font-black text-primary/80 hover:text-primary transition-colors tracking-wide underline py-2"
              >
                Şifremi Unuttum
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="w-full flex items-center justify-start">
              <button
                onClick={() => {
                  setIsRecoveryMode(false);
                  setRecoveryPin("");
                }}
                aria-label="Geri"
                className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col items-center text-center mt-2 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/10 flex items-center justify-center">
                <ShieldAlert className="w-7 h-7 text-rose-500" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-black tracking-tight text-rose-600 dark:text-rose-400">
                  Kurtarma Şifresi
                </h2>
                <p className="text-xs text-muted-foreground font-semibold max-w-70">
                  4 haneli kurtarma şifrenizi girin. Doğru girilirse kilit kaldırılır.
                </p>
              </div>
            </div>

            <div className="flex justify-center items-center gap-4 my-8">
              {[0, 1, 2, 3].map((idx) => (
                <div
                  key={idx}
                  className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                    recoveryError
                      ? "border-rose-500 bg-rose-500 animate-shake"
                      : recoveryPin.length > idx
                        ? "border-primary bg-primary scale-125"
                        : "border-muted-foreground/35 bg-transparent"
                  }`}
                />
              ))}
            </div>

            <div className="grid grid-cols-3 gap-3 w-full max-w-70">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  onClick={() => void handlePinKeyPress(num)}
                  disabled={isBlocked || recoveryPin.length >= 4}
                  className="w-full aspect-square max-h-16 rounded-full bg-muted/40 hover:bg-muted text-lg font-black flex items-center justify-center active:scale-90 transition-all border disabled:opacity-50"
                >
                  {num}
                </button>
              ))}
              <div className="flex items-center justify-center text-xs font-bold text-muted-foreground/70 select-none">
                Kurtarma
              </div>
              <button
                onClick={() => void handlePinKeyPress("0")}
                disabled={isBlocked || recoveryPin.length >= 4}
                className="w-full aspect-square max-h-16 rounded-full bg-muted/40 hover:bg-muted text-lg font-black flex items-center justify-center active:scale-90 transition-all border disabled:opacity-50"
              >
                0
              </button>
              <button
                onClick={handlePinDelete}
                disabled={isBlocked || recoveryPin.length === 0}
                aria-label="Sil"
                className="w-full aspect-square max-h-16 rounded-full bg-muted/20 hover:bg-muted text-xs font-black flex items-center justify-center active:scale-90 transition-all text-rose-500 disabled:opacity-50"
              >
                Sil
              </button>
            </div>

            <div className="w-full mt-6 flex flex-col items-center gap-2">
              {lockoutNotice}
              {lockedFor === 0 && attemptsLeft < LOCK_MAX_ATTEMPTS && (
                <p className="text-[11px] font-bold text-muted-foreground">
                  Kalan deneme: {attemptsLeft}/{LOCK_MAX_ATTEMPTS}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
