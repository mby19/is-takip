import { useState } from "react";
import { Lock, Unlock, Check, ShieldCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Dialog, DialogContent } from "./ui/dialog";
import { useToastStore } from "../stores/toastStore";
import {
  configureLock,
  disableLock,
  isLockEnabled as readLockEnabled,
  verifySequence,
  verifyPin,
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

export function LockSetupWizard() {
  const addToast = useToastStore((s) => s.addToast);
  const [isLockEnabled, setIsLockEnabled] = useState(readLockEnabled);
  const [isLockSetupOpen, setIsLockSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2 | 3 | 4>(1);
  const [tempSequence, setTempSequence] = useState<string[]>([]);
  const [confirmSequence, setConfirmSequence] = useState<string[]>([]);
  const [tempPin, setTempPin] = useState("");
  const [lockSetupError, setLockSetupError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [deactivateVerifyStep, setDeactivateVerifyStep] = useState<"emoji" | "pin">("emoji");
  const [deactivateSequence, setDeactivateSequence] = useState<string[]>([]);
  const [deactivatePin, setDeactivatePin] = useState("");
  const [deactivateError, setDeactivateError] = useState(false);

  // Kurulum sırasında PIN yalnızca bellekte tutulur; kaydedilirken özetlenir.
  const showMessage = (msg: string) => addToast(msg, "success");

  const handleEmojiSetupSelect = (id: string) => {
    if (isShaking) return;
    setLockSetupError(null);

    if (setupStep === 1) {
      const nextSeq = [...tempSequence, id];
      setTempSequence(nextSeq);
      if (nextSeq.length === 3) {
        setTimeout(() => setSetupStep(2), 300);
      }
    } else if (setupStep === 2) {
      const nextSeq = [...confirmSequence, id];
      setConfirmSequence(nextSeq);
      if (nextSeq.length === 3) {
        const isMatch = tempSequence.every((val, idx) => val === nextSeq[idx]);
        if (isMatch) {
          setTempPin("");
          setTimeout(() => setSetupStep(3), 300);
        } else {
          setIsShaking(true);
          setLockSetupError("Desenler eşleşmedi! Lütfen tekrar deneyin.");
          if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
          setTimeout(() => {
            setIsShaking(false);
            setConfirmSequence([]);
          }, 800);
        }
      }
    }
  };

  const handlePinSetupKeyPress = (num: string) => {
    if (tempPin.length >= 4) return;
    const nextPin = tempPin + num;
    setTempPin(nextPin);

    if (nextPin.length === 4) {
      void configureLock(tempSequence, nextPin)
        .then(() => {
          setIsLockEnabled(true);
          setTimeout(() => setSetupStep(4), 400);
        })
        .catch((err: unknown) => {
          setLockSetupError(err instanceof Error ? err.message : String(err));
          setTempPin("");
        });
    }
  };

  const handlePinSetupDelete = () => {
    if (tempPin.length > 0) {
      setTempPin(tempPin.slice(0, -1));
    }
  };

  const handleEmojiDeactivateSelect = (id: string) => {
    if (deactivateError) return;

    const nextSeq = [...deactivateSequence, id];
    setDeactivateSequence(nextSeq);

    if (nextSeq.length === 3) {
      void verifySequence(nextSeq).then(({ ok, lockedFor, attemptsLeft }) => {
        if (ok) {
          disableLock();
          setIsLockEnabled(false);
          setIsDeactivateOpen(false);
          showMessage("Uygulama kilidi kaldırıldı.");
          return;
        }
        setDeactivateError(true);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        addToast(
          lockedFor > 0
            ? `Çok fazla hatalı deneme. ${lockedFor} saniye bekleyin.`
            : `Desen hatalı. Kalan deneme: ${attemptsLeft}/${LOCK_MAX_ATTEMPTS}`,
          "error",
        );
        setTimeout(() => {
          setDeactivateError(false);
          setDeactivateSequence([]);
        }, 800);
      });
    }
  };

  const handlePinDeactivateKeyPress = (num: string) => {
    if (deactivatePin.length >= 4 || deactivateError) return;
    const nextPin = deactivatePin + num;
    setDeactivatePin(nextPin);

    if (nextPin.length === 4) {
      void verifyPin(nextPin).then(({ ok, lockedFor, attemptsLeft }) => {
        if (ok) {
          disableLock();
          setIsLockEnabled(false);
          setIsDeactivateOpen(false);
          showMessage("Uygulama kilidi kaldırıldı.");
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
        setTimeout(() => {
          setDeactivateError(false);
          setDeactivatePin("");
        }, 800);
      });
    }
  };

  const handlePinDeactivateDelete = () => {
    if (deactivatePin.length > 0) {
      setDeactivatePin(deactivatePin.slice(0, -1));
    }
  };

  const handleToggleLock = () => {
    if (isLockEnabled) {
      setDeactivateSequence([]);
      setDeactivatePin("");
      setDeactivateError(false);
      setDeactivateVerifyStep("emoji");
      setIsDeactivateOpen(true);
    } else {
      setSetupStep(1);
      setTempSequence([]);
      setConfirmSequence([]);
      setTempPin("");
      setLockSetupError(null);
      setIsLockSetupOpen(true);
    }
  };

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
            onClick={handleToggleLock}
            className={`h-9 px-4 rounded-control text-[11px] font-medium transition-all duration-200 active:scale-95 ${
              isLockEnabled
                ? "bg-rose-50 hover:bg-rose-100 dark:bg-bad-soft text-bad hover:text-rose-600 border border-transparent hover:border-rose-200"
                : "bg-primary hover:bg-primary/95 text-white shadow-md shadow-primary/10"
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
                {[0, 1, 2].map((idx) => (
                  <span key={idx} className="text-sm select-none">
                    🔒
                  </span>
                ))}
              </div>
            </div>

            <button
              onClick={() => {
                setSetupStep(1);
                setTempSequence([]);
                setConfirmSequence([]);
                setTempPin("");
                setLockSetupError(null);
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
            setSetupStep(1);
            setTempSequence([]);
            setConfirmSequence([]);
            setTempPin("");
            setLockSetupError(null);
          }
        }}
      >
        <DialogContent className="max-w-md w-[95vw] rounded-sheet p-6 gap-0 border-none shadow-2xl bg-background">
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

              <div className="flex justify-center gap-3">
                {[0, 1, 2].map((idx) => {
                  const id = tempSequence[idx];
                  const emo = EMOJIS.find((e) => e.id === id);
                  return (
                    <div
                      key={idx}
                      className="w-12 h-12 rounded-control border-2 bg-muted/40 flex items-center justify-center text-xl font-bold transition-all duration-300 border-border"
                    >
                      {emo?.char || ""}
                    </div>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-3 max-w-70 mx-auto">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji.id}
                    onClick={() => handleEmojiSetupSelect(emoji.id)}
                    className="aspect-square rounded-card border-2 flex flex-col items-center justify-center bg-card hover:border-amber-400/50 hover:bg-amber-400/5 active:scale-90 transition-all border-border"
                  >
                    <span className="text-2xl filter drop-shadow-sm mb-0.5">{emoji.char}</span>
                    <span className="text-[10px] font-semibold  text-muted-foreground/60 ">
                      {emoji.name}
                    </span>
                  </button>
                ))}
              </div>

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

              <div className="flex justify-center gap-3">
                {[0, 1, 2].map((idx) => {
                  const id = confirmSequence[idx];
                  const emo = EMOJIS.find((e) => e.id === id);
                  return (
                    <div
                      key={idx}
                      className={`w-12 h-12 rounded-control border-2 flex items-center justify-center text-xl font-bold transition-all duration-300 ${
                        isShaking
                          ? "border-destructive bg-destructive/10 animate-shake"
                          : "border-border bg-muted/40"
                      }`}
                    >
                      {emo?.char || ""}
                    </div>
                  );
                })}
              </div>

              {lockSetupError && (
                <p className="text-[10px] font-bold text-bad text-center animate-shake">
                  {lockSetupError}
                </p>
              )}

              <div className="grid grid-cols-3 gap-3 max-w-70 mx-auto">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji.id}
                    onClick={() => handleEmojiSetupSelect(emoji.id)}
                    className="aspect-square rounded-card border-2 flex flex-col items-center justify-center bg-card hover:border-amber-400/50 hover:bg-amber-400/5 active:scale-90 transition-all border-border"
                  >
                    <span className="text-2xl filter drop-shadow-sm mb-0.5">{emoji.char}</span>
                    <span className="text-[10px] font-semibold  text-muted-foreground/60 ">
                      {emoji.name}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-1/3 h-12 rounded-control text-xs font-bold border-2"
                  onClick={() => setSetupStep(1)}
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

              <div className="flex justify-center gap-4 my-2">
                {[0, 1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200 ${
                      tempPin.length > idx
                        ? "bg-primary border-primary scale-125"
                        : "border-muted-foreground/35"
                    }`}
                  />
                ))}
              </div>

              <div className="grid grid-cols-3 gap-2.5 max-w-60 mx-auto">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                  <button
                    key={num}
                    onClick={() => handlePinSetupKeyPress(num)}
                    className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-semibold flex items-center justify-center active:scale-90 transition-all border border-border"
                  >
                    {num}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => handlePinSetupKeyPress("0")}
                  className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-semibold flex items-center justify-center active:scale-90 transition-all border border-border"
                >
                  0
                </button>
                <button
                  onClick={handlePinSetupDelete}
                  className="w-full aspect-square max-h-13 rounded-full bg-muted/10 hover:bg-muted text-[10px] font-semibold flex items-center justify-center active:scale-90 transition-all text-bad"
                >
                  Sil
                </button>
              </div>
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
                className="w-full h-12 rounded-control text-[13px] font-medium bg-ok shadow-sm"
                onClick={() => {
                  setIsLockSetupOpen(false);
                  setSetupStep(1);
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
            setDeactivateSequence([]);
            setDeactivatePin("");
            setDeactivateError(false);
          }
        }}
      >
        <DialogContent className="max-w-md w-[95vw] rounded-sheet p-6 gap-0 border-none shadow-2xl bg-background">
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

            <div className="p-1 rounded-control bg-muted flex border border-border">
              <button
                onClick={() => {
                  setDeactivateVerifyStep("emoji");
                  setDeactivateSequence([]);
                  setDeactivatePin("");
                  setDeactivateError(false);
                }}
                className={`flex-1 h-9 rounded-lg font-semibold text-[10px] transition-all ${
                  deactivateVerifyStep === "emoji"
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                Emoji Deseni
              </button>
              <button
                onClick={() => {
                  setDeactivateVerifyStep("pin");
                  setDeactivateSequence([]);
                  setDeactivatePin("");
                  setDeactivateError(false);
                }}
                className={`flex-1 h-9 rounded-lg font-semibold text-[10px] transition-all ${
                  deactivateVerifyStep === "pin"
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                PIN Kodu
              </button>
            </div>

            {deactivateVerifyStep === "emoji" ? (
              <div className="space-y-6">
                <div className="flex justify-center gap-3">
                  {[0, 1, 2].map((idx) => {
                    const id = deactivateSequence[idx];
                    const emo = EMOJIS.find((e) => e.id === id);
                    return (
                      <div
                        key={idx}
                        className={`w-12 h-12 rounded-control border-2 flex items-center justify-center text-xl font-bold transition-all duration-300 ${
                          deactivateError
                            ? "border-rose-500 bg-bad-soft animate-shake"
                            : "border-border bg-muted/40"
                        }`}
                      >
                        {emo?.char || ""}
                      </div>
                    );
                  })}
                </div>

                <div className="grid grid-cols-3 gap-3 max-w-70 mx-auto">
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji.id}
                      onClick={() => handleEmojiDeactivateSelect(emoji.id)}
                      className="aspect-square rounded-card border-2 flex flex-col items-center justify-center bg-card hover:border-amber-400/50 hover:bg-amber-400/5 active:scale-90 transition-all border-border"
                    >
                      <span className="text-2xl filter drop-shadow-sm mb-0.5">{emoji.char}</span>
                      <span className="text-[10px] font-semibold  text-muted-foreground/60 ">
                        {emoji.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-6">
                <div className="flex justify-center gap-4">
                  {[0, 1, 2, 3].map((idx) => (
                    <div
                      key={idx}
                      className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200 ${
                        deactivateError
                          ? "border-rose-500 bg-rose-500 animate-shake"
                          : deactivatePin.length > idx
                            ? "bg-primary border-primary scale-125"
                            : "border-muted-foreground/35"
                      }`}
                    />
                  ))}
                </div>

                <div className="grid grid-cols-3 gap-2.5 max-w-60 mx-auto">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                    <button
                      key={num}
                      onClick={() => handlePinDeactivateKeyPress(num)}
                      className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-semibold flex items-center justify-center active:scale-90 transition-all border border-border"
                    >
                      {num}
                    </button>
                  ))}
                  <div />
                  <button
                    onClick={() => handlePinDeactivateKeyPress("0")}
                    className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-semibold flex items-center justify-center active:scale-90 transition-all border border-border"
                  >
                    0
                  </button>
                  <button
                    onClick={handlePinDeactivateDelete}
                    className="w-full aspect-square max-h-13 rounded-full bg-muted/10 hover:bg-muted text-[10px] font-semibold flex items-center justify-center active:scale-90 transition-all text-bad"
                  >
                    Sil
                  </button>
                </div>
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
