import { useState } from "react";
import { Lock, Unlock, Check, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { EmojiPatternGrid } from "./EmojiPatternGrid";
import { useTimeouts } from "../hooks/useTimeouts";
import { useToastStore } from "../stores/toastStore";
import {
  appendToPattern,
  appendToPin,
  emojiChar,
  isPatternComplete,
  matchesPattern,
  PATTERN_LENGTH,
  PIN_LENGTH,
} from "../utils/emojiPattern";
import {
  configureLock,
  disableLock,
  isLockEnabled as readLockEnabled,
  verifySequence,
  verifyPin,
  LOCK_MAX_ATTEMPTS,
} from "../lib/appLock";

/** 3 basışlık desen kutucukları. */
const PATTERN_SLOTS = Array.from({ length: PATTERN_LENGTH }, (_, index) => index);
/** 4 haneli PIN kutucukları. */
const PIN_SLOTS = Array.from({ length: PIN_LENGTH }, (_, index) => index);
/** Rakam tuş takımı (0 boşlukta). */
const KEYPAD = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "", "0"];

type VerifyStep = "emoji" | "pin";

export function LockSetupWizard() {
  const addToast = useToastStore((s) => s.addToast);
  const schedule = useTimeouts();
  const [isLockEnabled, setIsLockEnabled] = useState(readLockEnabled);
  const [isLockSetupOpen, setIsLockSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2 | 3 | 4>(1);
  const [tempSequence, setTempSequence] = useState<string[]>([]);
  const [confirmSequence, setConfirmSequence] = useState<string[]>([]);
  const [tempPin, setTempPin] = useState("");
  const [lockSetupError, setLockSetupError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [deactivateVerifyStep, setDeactivateVerifyStep] = useState<VerifyStep>("emoji");
  const [deactivateSequence, setDeactivateSequence] = useState<string[]>([]);
  const [deactivatePin, setDeactivatePin] = useState("");
  const [deactivateError, setDeactivateError] = useState(false);

  // Kurulum sırasında PIN yalnızca bellekte tutulur; kaydedilirken özetlenir.
  const showMessage = (msg: string) => addToast(msg, "success");

  const resetSetup = () => {
    setSetupStep(1);
    setTempSequence([]);
    setConfirmSequence([]);
    setTempPin("");
    setLockSetupError(null);
  };

  const resetDeactivate = () => {
    setDeactivateVerifyStep("emoji");
    setDeactivateSequence([]);
    setDeactivatePin("");
    setDeactivateError(false);
  };

  const handleEmojiSetupSelect = (id: string) => {
    if (isShaking) return;
    setLockSetupError(null);

    if (setupStep === 1) {
      // Pencere uzunluğu aşan basışlar en eskiyi düşürür; desen 3 elemanla kalır.
      const nextSeq = appendToPattern(tempSequence, id);
      setTempSequence(nextSeq);
      if (isPatternComplete(nextSeq)) {
        schedule(() => setSetupStep(2), 300);
      }
    } else if (setupStep === 2) {
      const nextSeq = appendToPattern(confirmSequence, id);
      setConfirmSequence(nextSeq);
      if (!isPatternComplete(nextSeq)) return;

      if (matchesPattern(tempSequence, nextSeq)) {
        setTempPin("");
        schedule(() => setSetupStep(3), 300);
      } else {
        setIsShaking(true);
        setLockSetupError("Desenler eşleşmedi! Lütfen tekrar deneyin.");
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        schedule(() => {
          setIsShaking(false);
          setConfirmSequence([]);
        }, 800);
      }
    }
  };

  const handlePinSetupKeyPress = (num: string) => {
    const nextPin = appendToPin(tempPin, num);
    if (nextPin === tempPin) return;
    setTempPin(nextPin);

    if (nextPin.length === PIN_LENGTH) {
      void configureLock(tempSequence, nextPin)
        .then(() => {
          setIsLockEnabled(true);
          schedule(() => setSetupStep(4), 400);
        })
        .catch((err: unknown) => {
          setLockSetupError(err instanceof Error ? err.message : String(err));
          setTempPin("");
        });
    }
  };

  const handlePinSetupDelete = () => {
    setTempPin((pin) => pin.slice(0, -1));
  };

  /** Kilit kaldırma başarısını işleyen ortak yol. */
  const completeDeactivation = () => {
    disableLock();
    setIsLockEnabled(false);
    setIsDeactivateOpen(false);
    showMessage("Uygulama kilidi kaldırıldı.");
  };

  /** Hatalı deneme sonrası kilitlenme bildirimi. */
  const reportDeactivateFailure = (lockedFor: number, attemptsLeft: number) => {
    setDeactivateError(true);
    if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
    addToast(
      lockedFor > 0
        ? `Çok fazla hatalı deneme. ${lockedFor} saniye bekleyin.`
        : `Desen hatalı. Kalan deneme: ${attemptsLeft}/${LOCK_MAX_ATTEMPTS}`,
      "error",
    );
    schedule(() => {
      setDeactivateError(false);
      setDeactivateSequence([]);
      setDeactivatePin("");
    }, 800);
  };

  const handleEmojiDeactivateSelect = (id: string) => {
    if (deactivateError) return;

    const nextSeq = appendToPattern(deactivateSequence, id);
    setDeactivateSequence(nextSeq);
    if (!isPatternComplete(nextSeq)) return;

    void verifySequence(nextSeq)
      .then(({ ok, lockedFor, attemptsLeft }) => {
        if (ok) {
          completeDeactivation();
          return;
        }
        reportDeactivateFailure(lockedFor, attemptsLeft);
      })
      .catch(() => {
        reportDeactivateFailure(0, LOCK_MAX_ATTEMPTS);
      });
  };

  const handlePinDeactivateKeyPress = (num: string) => {
    const nextPin = appendToPin(deactivatePin, num);
    if (nextPin === deactivatePin || deactivateError) return;
    setDeactivatePin(nextPin);
    if (nextPin.length !== PIN_LENGTH) return;

    void verifyPin(nextPin)
      .then(({ ok, lockedFor, attemptsLeft }) => {
        if (ok) {
          completeDeactivation();
          return;
        }
        setDeactivateError(true);
        if (navigator.vibrate) navigator.vibrate(150);
        addToast(
          lockedFor > 0
            ? `Çok fazla hatalı deneme. ${lockedFor} saniye bekleyin.`
            : `PIN hatalı. Kalan deneme: ${attemptsLeft}/${LOCK_MAX_ATTEMPTS}`,
          "error",
        );
        schedule(() => {
          setDeactivateError(false);
          setDeactivatePin("");
        }, 800);
      })
      .catch(() => {
        addToast("Doğrulama yapılamadı. Lütfen tekrar deneyin.", "error");
      });
  };

  const handlePinDeactivateDelete = () => {
    setDeactivatePin((pin) => pin.slice(0, -1));
  };

  const handleToggleLock = () => {
    if (isLockEnabled) {
      resetDeactivate();
      setIsDeactivateOpen(true);
    } else {
      resetSetup();
      setIsLockSetupOpen(true);
    }
  };

  const renderPatternSlots = (sequence: string[], error: boolean) => (
    <div className="flex justify-center gap-3">
      {PATTERN_SLOTS.map((index) => (
        <div
          key={index}
          className={`w-12 h-12 rounded-control border-2 flex items-center justify-center text-xl font-bold transition-all duration-300 ${
            error ? "border-rose-500 bg-bad-soft animate-shake" : "border-border bg-muted/40"
          }`}
        >
          {emojiChar(sequence[index])}
        </div>
      ))}
    </div>
  );

  const renderPinDots = (pin: string, error: boolean) => (
    <div className="flex justify-center gap-4">
      {PIN_SLOTS.map((index) => (
        <div
          key={index}
          className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200 ${
            error
              ? "border-rose-500 bg-rose-500 animate-shake"
              : pin.length > index
                ? "bg-primary border-primary scale-125"
                : "border-muted-foreground/35"
          }`}
        />
      ))}
    </div>
  );

  const renderKeypad = (
    onDigit: (num: string) => void,
    onDelete: () => void,
    disabled: boolean,
  ) => (
    <div className="grid grid-cols-3 gap-2.5 max-w-60 mx-auto">
      {KEYPAD.map((num, index) =>
        num === "" ? (
          <div key={`spacer-${index}`} />
        ) : (
          <button
            key={num}
            type="button"
            disabled={disabled}
            onClick={() => onDigit(num)}
            className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-semibold flex items-center justify-center active:scale-90 transition-all border border-border disabled:opacity-50 disabled:pointer-events-none"
          >
            {num}
          </button>
        ),
      )}
      <button
        type="button"
        onClick={onDelete}
        className="w-full aspect-square max-h-13 rounded-full bg-muted/10 hover:bg-muted text-[10px] font-semibold flex items-center justify-center active:scale-90 transition-all text-bad"
      >
        Sil
      </button>
    </div>
  );

  return (
    <>
      {/* Uygulama Kilidi */}
      <div className="p-4 rounded-card border-2 bg-card space-y-3.5 shadow-sm relative overflow-hidden transition-all duration-300">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3.5">
            <div
              className={`w-11 h-11 rounded-control flex items-center justify-center transition-all ${
                isLockEnabled
                  ? "bg-amber-500/10 text-warn animate-pulse"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isLockEnabled ? (
                <Lock className="w-5.5 h-5.5" />
              ) : (
                <Unlock className="w-5.5 h-5.5" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold tracking-tight">Uygulama Kilidi</h3>
              <p className="text-[10px] text-muted-foreground font-bold tracking-wide mt-0.5 ">
                {isLockEnabled ? "Görsel desen aktif 🔐" : "Korumasız giriş"}
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleToggleLock}
            className={`h-9 px-4 rounded-control text-[11px] font-medium transition-all duration-200 active:scale-95 ${
              isLockEnabled
                ? "bg-rose-50 hover:bg-rose-100 dark:bg-bad-soft text-bad hover:text-rose-600 border border-transparent hover:border-rose-200"
                : "bg-primary hover:bg-primary/95 text-primary-foreground shadow-sm"
            }`}
          >
            {isLockEnabled ? "Kilidi Kapat" : "Etkinleştir"}
          </button>
        </div>

        {isLockEnabled && (
          <div className="pt-3 border-t border-dashed flex justify-between items-center text-[10px] font-bold text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <span className="uppercase  opacity-60">Görsel Desen:</span>
              <div className="flex gap-1">
                {PATTERN_SLOTS.map((index) => (
                  <span key={index} className="text-sm select-none">
                    🔒
                  </span>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => {
                resetSetup();
                setIsLockSetupOpen(true);
              }}
              className="text-primary hover:underline font-semibold   text-[10px]"
            >
              Deseni Değiştir
            </button>
          </div>
        )}
      </div>

      {/* App Lock Setup Wizard Dialog */}
      <Dialog
        open={isLockSetupOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsLockSetupOpen(false);
            resetSetup();
          }
        }}
      >
        <DialogContent
          className="max-w-md w-[95vw] rounded-sheet p-6 gap-0 border-none shadow-2xl bg-background"
          showCloseButton={false}
        >
          {setupStep === 1 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-card bg-primary/10 flex items-center justify-center mx-auto">
                  <Lock className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-base font-semibold">Desen Belirle</h3>
                <p className="text-xs text-muted-foreground font-bold">
                  3 tane resme sırayla dokun, şifren hazır.
                </p>
              </div>

              {renderPatternSlots(tempSequence, false)}

              <EmojiPatternGrid
                selected={tempSequence}
                onSelect={handleEmojiSetupSelect}
                label="Desen belirlemek için resimler"
              />

              <Button
                variant="outline"
                className="w-full h-12 rounded-control text-xs font-bold border-2"
                onClick={() => setIsLockSetupOpen(false)}
              >
                İptal
              </Button>
            </div>
          )}

          {setupStep === 2 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-card bg-amber-500/10 flex items-center justify-center mx-auto animate-pulse">
                  <Lock className="w-6 h-6 text-warn" />
                </div>
                <h3 className="text-base font-semibold">Bir Daha Seç</h3>
                <p className="text-xs text-muted-foreground font-bold">
                  Aynı 3 resmi tekrar sırasıyla seç, doğrulayalim.
                </p>
              </div>

              {renderPatternSlots(confirmSequence, isShaking)}

              {lockSetupError && (
                <p className="text-[10px] font-bold text-bad text-center animate-shake">
                  {lockSetupError}
                </p>
              )}

              <EmojiPatternGrid
                selected={confirmSequence}
                onSelect={handleEmojiSetupSelect}
                isShaking={isShaking}
                label="Deseni doğrulamak için resimler"
              />

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-1/3 h-12 rounded-control text-xs font-bold border-2"
                  onClick={() => {
                    setSetupStep(1);
                    setConfirmSequence([]);
                    setLockSetupError(null);
                  }}
                >
                  Geri Git
                </Button>
                <Button
                  variant="outline"
                  className="w-2/3 h-12 rounded-control text-xs font-bold border-2"
                  onClick={() => {
                    setConfirmSequence([]);
                    setLockSetupError(null);
                  }}
                >
                  Yeniden Dene
                </Button>
              </div>
            </div>
          )}

          {setupStep === 3 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-card bg-bad-soft flex items-center justify-center mx-auto text-bad">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-base font-semibold">Kurtarma Şifresi Belirleyin</h3>
                <p className="text-xs text-muted-foreground font-bold leading-relaxed max-w-70 mx-auto">
                  Deseninizi unuttuğunuzda kilidi sıfırlamak için kullanacağınız 4 haneli bir şifre
                  girin.
                </p>
              </div>

              {renderPinDots(tempPin, false)}

              {renderKeypad(handlePinSetupKeyPress, handlePinSetupDelete, false)}
            </div>
          )}

          {setupStep === 4 && (
            <div className="space-y-6 py-4 text-center">
              <div className="w-16 h-16 rounded-full bg-ok-soft flex items-center justify-center mx-auto text-ok animate-screen-enter">
                <Check className="w-8 h-8 stroke-3" />
              </div>
              <div className="space-y-2">
                <h3 className="text-[17px] font-semibold text-ok">Kilit Hazır! 🚀</h3>
                <p className="text-xs text-muted-foreground font-bold leading-relaxed max-w-70 mx-auto">
                  Artık uygulaman kilitli, veriler güvende.
                </p>
              </div>

              <div className="p-4 rounded-control border border-emerald-100 bg-emerald-50/20 dark:border-emerald-500/10 dark:bg-emerald-500/5 text-left space-y-2">
                <p className="text-[10px] font-bold text-ok leading-relaxed text-center">
                  💡 Uygulamayı arka plana alınca otomatik kilitlenir. Şifreni unutursan kurtarma
                  PIN'in: <strong className="font-mono ">{tempPin}</strong> — bu ekranı kapattıktan
                  sonra PIN bir daha gösterilemez, not alın.
                </p>
              </div>
              <Button
                className="w-full h-12 rounded-control text-[13px] font-medium bg-ok text-on-ok shadow-sm"
                onClick={() => {
                  setIsLockSetupOpen(false);
                  resetSetup();
                }}
              >
                Tamam
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* App Lock Deactivation / Verification Dialog */}
      <Dialog
        open={isDeactivateOpen}
        onOpenChange={(open) => {
          if (!open) {
            setIsDeactivateOpen(false);
            resetDeactivate();
          }
        }}
      >
        <DialogContent
          className="max-w-md w-[95vw] rounded-sheet p-6 gap-0 border-none shadow-2xl bg-background"
          showCloseButton={false}
        >
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-card bg-bad-soft flex items-center justify-center mx-auto text-bad">
                <Unlock className="w-6 h-6" />
              </div>
              <h3 className="text-base font-semibold">Kilidi Kapat</h3>
              <p className="text-xs text-muted-foreground font-bold">
                Önce mevcut desenini veya PIN'ini doğrula.
              </p>
            </div>

            <div
              role="radiogroup"
              aria-label="Doğrulama yöntemi"
              className="p-1 rounded-control bg-muted flex border border-border"
            >
              {(
                [
                  { id: "emoji", label: "Emoji Deseni" },
                  { id: "pin", label: "PIN Kodu" },
                ] as const
              ).map((option) => (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={deactivateVerifyStep === option.id}
                  tabIndex={deactivateVerifyStep === option.id ? 0 : -1}
                  onKeyDown={(event) => {
                    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
                    event.preventDefault();
                    setDeactivateVerifyStep(option.id === "emoji" ? "pin" : "emoji");
                  }}
                  onClick={() => {
                    setDeactivateVerifyStep(option.id);
                    setDeactivateSequence([]);
                    setDeactivatePin("");
                    setDeactivateError(false);
                  }}
                  className={`flex-1 h-9 rounded-lg font-semibold text-[10px] transition-all ${
                    deactivateVerifyStep === option.id
                      ? "bg-background shadow text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>

            {deactivateVerifyStep === "emoji" ? (
              <div className="space-y-6">
                {renderPatternSlots(deactivateSequence, deactivateError)}

                <EmojiPatternGrid
                  selected={deactivateSequence}
                  onSelect={handleEmojiDeactivateSelect}
                  isShaking={deactivateError}
                  label="Deseni doğrulamak için resimler"
                />
              </div>
            ) : (
              <div className="space-y-6">
                {renderPinDots(deactivatePin, deactivateError)}

                {renderKeypad(
                  handlePinDeactivateKeyPress,
                  handlePinDeactivateDelete,
                  deactivateError,
                )}
              </div>
            )}

            <Button
              variant="outline"
              className="w-full h-12 rounded-control text-xs font-bold border-2"
              onClick={() => setIsDeactivateOpen(false)}
            >
              Vazgeç
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
