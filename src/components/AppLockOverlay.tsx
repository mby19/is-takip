import { useState, useEffect } from "react";
import { Lock, ArrowLeft, ShieldAlert, Timer } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "./ui/dialog";
import { EmojiPatternGrid } from "./EmojiPatternGrid";
import { useTimeouts } from "../hooks/useTimeouts";
import {
  appendToPattern,
  appendToPin,
  emojiChar,
  isPatternComplete,
  PIN_LENGTH,
} from "../utils/emojiPattern";
import {
  verifySequence,
  verifyPin,
  disableLock,
  lockoutSecondsLeft,
  LOCK_MAX_ATTEMPTS,
} from "../lib/appLock";

interface AppLockOverlayProps {
  onUnlock: () => void;
}

/** Ekranda gösterilecek hata metni. */
const VERIFY_ERROR = "Doğrulama yapılamadı. Lütfen tekrar deneyin.";

export function AppLockOverlay({ onUnlock }: AppLockOverlayProps) {
  const schedule = useTimeouts();
  const [selectedSequence, setSelectedSequence] = useState<string[]>([]);
  const [isShaking, setIsShaking] = useState(false);
  const [isExiting, setIsExiting] = useState(false);
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);
  const [recoveryPin, setRecoveryPin] = useState("");
  const [recoveryError, setRecoveryError] = useState(false);
  const [attemptsLeft, setAttemptsLeft] = useState(LOCK_MAX_ATTEMPTS);
  const [lockedFor, setLockedFor] = useState(() => lockoutSecondsLeft());
  const [busy, setBusy] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Kilitlenme geri sayımı tek bir interval ile yürür; `lockedFor` her saniye
  // değiştiği için effect'i sayıya değil, kilitli/kapalı durumuna bağlıyoruz.
  const isLockedOut = lockedFor > 0;
  useEffect(() => {
    if (!isLockedOut) return;
    const timer = window.setInterval(() => setLockedFor(lockoutSecondsLeft()), 1000);
    return () => window.clearInterval(timer);
  }, [isLockedOut]);

  const isBlocked = isLockedOut || busy || isExiting;

  const handleEmojiSelect = async (id: string) => {
    if (isBlocked || isShaking) return;

    // Pencere 3'ü aşan basışlarda en eskiyi düşürür; kilit kilitlemez.
    const newSequence = appendToPattern(selectedSequence, id);
    setSelectedSequence(newSequence);
    setErrorMessage(null);
    if (!isPatternComplete(newSequence)) return;

    setBusy(true);
    try {
      const result = await verifySequence(newSequence);
      if (result.ok) {
        setIsExiting(true);
        schedule(onUnlock, 600);
        return;
      }

      setAttemptsLeft(result.attemptsLeft);
      setLockedFor(result.lockedFor);
      setIsShaking(true);
      if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
      schedule(() => {
        setIsShaking(false);
        setSelectedSequence([]);
      }, 600);
    } catch {
      // LK5: verifySequence reddederse kullanıcı bilgilendirilir; desen kilitli kalmaz.
      setErrorMessage(VERIFY_ERROR);
      setSelectedSequence([]);
      setIsShaking(true);
      if (navigator.vibrate) navigator.vibrate(150);
      schedule(() => setIsShaking(false), 600);
    } finally {
      setBusy(false);
    }
  };

  const handlePinKeyPress = async (num: string) => {
    if (isBlocked) return;
    const newPin = appendToPin(recoveryPin, num);
    if (newPin === recoveryPin) return;

    setRecoveryError(false);
    setErrorMessage(null);
    setRecoveryPin(newPin);
    if (newPin.length !== PIN_LENGTH) return;

    setBusy(true);
    try {
      const result = await verifyPin(newPin);
      if (result.ok) {
        // Kurtarma PIN'i doğruysa kilit tamamen kaldırılır.
        disableLock();
        setIsExiting(true);
        schedule(() => {
          onUnlock();
          window.location.reload();
        }, 500);
        return;
      }

      setAttemptsLeft(result.attemptsLeft);
      setLockedFor(result.lockedFor);
      setRecoveryError(true);
      if (navigator.vibrate) navigator.vibrate(150);
      schedule(() => {
        setRecoveryPin("");
        setRecoveryError(false);
      }, 800);
    } catch {
      setErrorMessage(VERIFY_ERROR);
      setRecoveryPin("");
      setRecoveryError(true);
      schedule(() => setRecoveryError(false), 800);
    } finally {
      setBusy(false);
    }
  };

  const handlePinDelete = () => {
    setRecoveryPin((pin) => pin.slice(0, -1));
  };

  const lockoutNotice = isLockedOut && (
    <div className="flex items-center gap-2 px-4 py-2.5 rounded-control bg-bad-soft border border-rose-500/20 text-bad">
      <Timer className="w-4 h-4 shrink-0" />
      <span className="text-xs font-bold">
        Çok fazla hatalı deneme. {lockedFor} saniye sonra tekrar deneyin.
      </span>
    </div>
  );

  const attemptsNotice = !isLockedOut && attemptsLeft < LOCK_MAX_ATTEMPTS && (
    <p className="text-[11px] font-bold text-muted-foreground">
      Kalan deneme: {attemptsLeft}/{LOCK_MAX_ATTEMPTS}
    </p>
  );

  return (
    // Radix Dialog: focus trap, scroll lock ve portal sağlar.
    // Kilit ekranı kapatılamaz — Escape ve dış tıklama yok sayılır.
    <Dialog open>
      <DialogContent
        // Radix `aria-modal`'ı aria-hidden uygulamasıyla dolaylı sağlar; kilit
        // ekranında özniteliği açıkça yazmak önceki davranışı korur.
        aria-modal="true"
        showCloseButton={false}
        onEscapeKeyDown={(event) => event.preventDefault()}
        onPointerDownOutside={(event) => event.preventDefault()}
        onInteractOutside={(event) => event.preventDefault()}
        // DialogContent'in orta noktaya oturan varsayılan yerleşimini tam ekrana al.
        className={
          "fixed inset-0 top-0 left-0 translate-x-0 translate-y-0 z-9999 flex w-screen h-screen " +
          "max-w-none sm:max-w-none rounded-none border-0 p-0 shadow-none outline-none " +
          `select-none bg-background/90 backdrop-blur-2xl transition-all duration-500 ease-in-out ${
            isExiting ? "-translate-y-full opacity-0" : "translate-y-0 opacity-100"
          }`
        }
      >
        <DialogTitle className="sr-only">Uygulama kilidi</DialogTitle>
        <DialogDescription className="sr-only">
          Açmak için 3 resmi sırasıyla seçin veya kurtarma şifrenizi girin.
        </DialogDescription>

        <div className="w-full max-w-md h-full flex flex-col items-center justify-between px-6 py-14 relative bg-background">
          {!isRecoveryMode ? (
            <>
              <div className="flex flex-col items-center text-center mt-6 space-y-4">
                <div className="w-16 h-16 rounded-card bg-primary/10 flex items-center justify-center animate-float">
                  <Lock className="w-7 h-7 text-primary" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold tracking-tight">Kilitli</h2>
                  <p className="text-xs text-muted-foreground font-semibold max-w-70">
                    Girmek için 3 resmi sırasıyla seç
                  </p>
                </div>
              </div>

              <div className="flex justify-center items-center gap-4 my-6">
                {[0, 1, 2].map((index) => {
                  const isSelected = selectedSequence.length > index;
                  return (
                    <div
                      key={index}
                      className={`w-12 h-12 rounded-control flex items-center justify-center text-xl font-bold border-2 transition-all duration-300 ${
                        isShaking
                          ? "border-destructive bg-destructive/10 text-destructive animate-shake"
                          : isSelected
                            ? "border-amber-500 bg-amber-500/10 scale-110 shadow-md shadow-amber-500/10"
                            : "border-border bg-muted/40"
                      }`}
                    >
                      {isSelected ? emojiChar(selectedSequence[index]) : ""}
                    </div>
                  );
                })}
              </div>

              <EmojiPatternGrid
                selected={selectedSequence}
                onSelect={(id) => void handleEmojiSelect(id)}
                disabled={isBlocked}
                isShaking={isShaking}
                className="w-full max-w-[320px] gap-3.5"
                itemClassName="w-full"
                label="Kilit ekranı için resimler"
              />

              <div className="flex flex-col items-center gap-3 mt-6 w-full">
                {lockoutNotice}
                {attemptsNotice}
                {errorMessage && (
                  <p
                    role="alert"
                    className="text-[11px] font-bold text-bad text-center animate-shake"
                  >
                    {errorMessage}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setErrorMessage(null);
                    setIsRecoveryMode(true);
                  }}
                  className="text-[13px] font-medium text-primary/80 hover:text-primary transition-colors tracking-wide underline py-2"
                >
                  Şifremi Unuttum
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="w-full flex items-center justify-start">
                <button
                  type="button"
                  onClick={() => {
                    setIsRecoveryMode(false);
                    setRecoveryPin("");
                  }}
                  aria-label="Geri"
                  className="w-10 h-10 rounded-control bg-muted/60 flex items-center justify-center active:scale-90 transition-all"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              </div>

              <div className="flex flex-col items-center text-center mt-2 space-y-4">
                <div className="w-16 h-16 rounded-card bg-bad-soft flex items-center justify-center">
                  <ShieldAlert className="w-7 h-7 text-bad" />
                </div>
                <div className="space-y-1">
                  <h2 className="text-xl font-semibold tracking-tight text-bad">
                    Kurtarma Şifresi
                  </h2>
                  <p className="text-xs text-muted-foreground font-semibold max-w-70">
                    4 haneli kurtarma şifrenizi girin. Doğru girilirse kilit kaldırılır.
                  </p>
                </div>
              </div>

              <div className="flex justify-center items-center gap-4 my-8">
                {[0, 1, 2, 3].map((index) => (
                  <div
                    key={index}
                    className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                      recoveryError
                        ? "border-rose-500 bg-rose-500 animate-shake"
                        : recoveryPin.length > index
                          ? "bg-primary border-primary scale-125"
                          : "border-muted-foreground/35 bg-transparent"
                    }`}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-3 w-full max-w-70">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                  <button
                    key={num}
                    type="button"
                    onClick={() => void handlePinKeyPress(num)}
                    disabled={isBlocked || recoveryPin.length >= PIN_LENGTH}
                    className="w-full aspect-square max-h-16 rounded-full bg-muted/40 hover:bg-muted text-[17px] font-semibold flex items-center justify-center active:scale-90 transition-all border disabled:opacity-50 disabled:pointer-events-none"
                  >
                    {num}
                  </button>
                ))}
                <div className="flex items-center justify-center text-xs font-bold text-muted-foreground/70 select-none">
                  Kurtarma
                </div>
                <button
                  type="button"
                  onClick={() => void handlePinKeyPress("0")}
                  disabled={isBlocked || recoveryPin.length >= PIN_LENGTH}
                  className="w-full aspect-square max-h-16 rounded-full bg-muted/40 hover:bg-muted text-[17px] font-semibold flex items-center justify-center active:scale-90 transition-all border disabled:opacity-50 disabled:pointer-events-none"
                >
                  0
                </button>
                <button
                  type="button"
                  onClick={handlePinDelete}
                  disabled={isBlocked || recoveryPin.length === 0}
                  aria-label="Sil"
                  className="w-full aspect-square max-h-16 rounded-full bg-muted/20 hover:bg-muted text-[13px] font-medium flex items-center justify-center active:scale-90 transition-all text-bad disabled:opacity-50 disabled:pointer-events-none"
                >
                  Sil
                </button>
              </div>

              <div className="w-full mt-6 flex flex-col items-center gap-2">
                {lockoutNotice}
                {attemptsNotice}
                {errorMessage && (
                  <p
                    role="alert"
                    className="text-[11px] font-bold text-bad text-center animate-shake"
                  >
                    {errorMessage}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
