import { useState } from "react";
import { Lock, ArrowLeft, ShieldAlert } from "lucide-react";

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

  // Load configured sequence and PIN
  const configuredSequence: string[] = JSON.parse(localStorage.getItem("appLockSequence") || "[]");
  const configuredPin = localStorage.getItem("appLockPin") || "";

  // Handle emoji card selection
  const handleEmojiSelect = (id: string) => {
    if (isExiting || isShaking) return;

    const newSequence = [...selectedSequence, id];
    setSelectedSequence(newSequence);

    // If 3 emojis entered, validate
    if (newSequence.length === 3) {
      const match = newSequence.every((val, idx) => val === configuredSequence[idx]);

      if (match) {
        // Trigger success animation
        setIsExiting(true);
        setTimeout(() => {
          onUnlock();
        }, 600); // matches slide transition
      } else {
        // Mismatch feedback
        setIsShaking(true);
        if (navigator.vibrate) {
          navigator.vibrate([100, 50, 100]);
        }
        setTimeout(() => {
          setIsShaking(false);
          setSelectedSequence([]);
        }, 600);
      }
    }
  };

  // Handle Recovery PIN button click
  const handlePinKeyPress = (num: string) => {
    if (recoveryPin.length >= 4) return;
    setRecoveryError(false);
    const newPin = recoveryPin + num;
    setRecoveryPin(newPin);

    // Auto-check PIN when 4 digits are input
    if (newPin.length === 4) {
      if (newPin === configuredPin) {
        // Correct Recovery PIN: Disable lock and open app
        localStorage.removeItem("appLockEnabled");
        localStorage.removeItem("appLockSequence");
        localStorage.removeItem("appLockPin");

        setIsExiting(true);
        setTimeout(() => {
          onUnlock();
          window.location.reload(); // Refresh setting views
        }, 500);
      } else {
        // Wrong PIN
        setRecoveryError(true);
        if (navigator.vibrate) {
          navigator.vibrate(150);
        }
        setTimeout(() => {
          setRecoveryPin("");
          setRecoveryError(false);
        }, 800);
      }
    }
  };

  const handlePinDelete = () => {
    if (recoveryPin.length > 0) {
      setRecoveryPin(recoveryPin.slice(0, -1));
    }
  };

  return (
    <div
      className={`absolute inset-0 z-9999 w-screen h-screen flex flex-col justify-center items-center bg-background/80 backdrop-blur-2xl transition-all duration-500 ease-in-out select-none ${
        isExiting ? "-translate-y-full opacity-0 pointer-events-none" : "translate-y-0 opacity-100"
      }`}
    >
      <div className="w-full max-w-md h-full flex flex-col items-center justify-between px-6 py-14 relative bg-background">
        {!isRecoveryMode ? (
          // EMOJI PATTERN LOCK VIEW
          <>
            {/* Header Lock Icon & Text */}
            <div className="flex flex-col items-center text-center mt-6 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-float">
                <Lock className="w-7 h-7 text-primary" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-black tracking-tight">Kilitli 🔒</h2>
                <p className="text-xs text-muted-foreground font-semibold max-w-70">
                  Girmek için 3 resmi sırasıyla seç
                </p>
              </div>
            </div>

            {/* Pattern Slots Indicator */}
            <div className="flex justify-center items-center gap-4 my-6">
              {[0, 1, 2].map((idx) => {
                const isSelected = selectedSequence.length > idx;
                const emojiId = selectedSequence[idx];
                const emojiObj = EMOJIS.find((e) => e.id === emojiId);
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

            {/* 3x3 Grid of Gorgeous Emojis */}
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
                    onClick={() => handleEmojiSelect(emoji.id)}
                    disabled={isExiting || isShaking}
                    className={`aspect-square rounded-2xl border-2 flex flex-col items-center justify-center transition-all duration-200 active:scale-90 ${
                      isPartiallySelected
                        ? "border-amber-500 bg-amber-500/5 shadow-md shadow-amber-500/5 scale-95"
                        : "border-border bg-card/75 hover:border-amber-400/50 hover:bg-amber-400/5"
                    }`}
                  >
                    <span className="text-3xl filter drop-shadow-sm mb-1">{emoji.char}</span>
                    <span className="text-[9px] font-black uppercase tracking-wider text-muted-foreground/60">
                      {emoji.name}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Recovery Trigger Option */}
            <button
              onClick={() => setIsRecoveryMode(true)}
              className="text-xs font-black text-primary/75 hover:text-primary transition-colors tracking-wide underline mt-6 py-2"
            >
              Şifremi Unuttum
            </button>
          </>
        ) : (
          // PIN RECOVERY VIEW
          <>
            {/* Header PIN & Back Button */}
            <div className="w-full flex items-center justify-start">
              <button
                onClick={() => {
                  setIsRecoveryMode(false);
                  setRecoveryPin("");
                }}
                className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all"
              >
                <ArrowLeft className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-col items-center text-center mt-2 space-y-4">
              <div className="w-16 h-16 rounded-2xl bg-rose-500/10 flex items-center justify-center animate-pulse">
                <ShieldAlert className="w-7 h-7 text-rose-500" />
              </div>
              <div className="space-y-1">
                <h2 className="text-xl font-black tracking-tight text-rose-600 dark:text-rose-400">
                  Kurtarma Şifresi
                </h2>
                <p className="text-xs text-muted-foreground font-semibold max-w-70">
                  4 haneli kurtarma şifrenizi girin, kilit kapansın.
                </p>
              </div>
            </div>

            {/* PIN Slots Indicators */}
            <div className="flex justify-center items-center gap-4 my-8">
              {[0, 1, 2, 3].map((idx) => {
                const filled = recoveryPin.length > idx;
                return (
                  <div
                    key={idx}
                    className={`w-4 h-4 rounded-full border-2 transition-all duration-200 ${
                      recoveryError
                        ? "border-rose-500 bg-rose-500 animate-shake"
                        : filled
                          ? "border-primary bg-primary scale-125"
                          : "border-muted-foreground/35 bg-transparent"
                    }`}
                  />
                );
              })}
            </div>

            {/* Numeric Keypad */}
            <div className="grid grid-cols-3 gap-3 w-full max-w-70]">
              {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                <button
                  key={num}
                  onClick={() => handlePinKeyPress(num)}
                  disabled={isExiting || recoveryPin.length >= 4}
                  className="w-full aspect-square max-h-16 rounded-full bg-muted/40 hover:bg-muted text-lg font-black flex items-center justify-center active:scale-90 transition-all border"
                >
                  {num}
                </button>
              ))}
              <div className="flex items-center justify-center text-xs font-bold text-muted-foreground/60 select-none">
                Kurtarma
              </div>
              <button
                onClick={() => handlePinKeyPress("0")}
                disabled={isExiting || recoveryPin.length >= 4}
                className="w-full aspect-square max-h-16 rounded-full bg-muted/40 hover:bg-muted text-lg font-black flex items-center justify-center active:scale-90 transition-all border"
              >
                0
              </button>
              <button
                onClick={handlePinDelete}
                disabled={isExiting || recoveryPin.length === 0}
                className="w-full aspect-square max-h-16 rounded-full bg-muted/20 hover:bg-muted text-xs font-black flex items-center justify-center active:scale-90 transition-all text-rose-500"
              >
                Sil
              </button>
            </div>

            <div className="text-[10px] text-center font-bold text-rose-500/60 max-w-60 mt-6 leading-relaxed">
              Doğru şifreyi girince kilit otomatik kapanır, rahat ol.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
