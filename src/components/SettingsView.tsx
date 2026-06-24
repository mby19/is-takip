import { useState } from "react";
import {
  Settings,
  DownloadCloud,
  UploadCloud,
  History,
  ArrowLeft,
  Moon,
  Sun,
  Smartphone,
  Palette,
  Bell,
  Database,
  FileText,
  AlertTriangle,
  Loader2,
  Trash2,
  Lock,
  Unlock,
  Check,
  ShieldCheck,
} from "lucide-react";
import { Button } from "./ui/button";
import { exportDatabase, importDatabase } from "../lib/backup";
import { isTauri, listBackupFiles, readTextFileFromDownloads } from "../lib/tauri";
import type { BackupFileInfo } from "../lib/tauri";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

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

export function SettingsView({
  onBack,
  onNavigateLogs,
  theme,
  toggleTheme,
}: {
  onBack: () => void;
  onNavigateLogs: () => void;
  theme: "light" | "dark";
  toggleTheme: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  // Yedekten Dön Dialog
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [backupFiles, setBackupFiles] = useState<BackupFileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);

  // Custom delete backup states
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<string | null>(null);
  const [deleteChallengeCode, setDeleteChallengeCode] = useState("");
  const [deleteInputCode, setDeleteInputCode] = useState("");

  // --- App Lock Setup Wizard States ---
  const [isLockEnabled, setIsLockEnabled] = useState(
    () => localStorage.getItem("appLockEnabled") === "true",
  );
  const [isLockSetupOpen, setIsLockSetupOpen] = useState(false);
  const [setupStep, setSetupStep] = useState<1 | 2 | 3 | 4>(1);
  const [tempSequence, setTempSequence] = useState<string[]>([]);
  const [confirmSequence, setConfirmSequence] = useState<string[]>([]);
  const [tempPin, setTempPin] = useState("");
  const [lockSetupError, setLockSetupError] = useState<string | null>(null);
  const [isShaking, setIsShaking] = useState(false);

  // --- App Lock Deactivation States ---
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [deactivateVerifyStep, setDeactivateVerifyStep] = useState<"emoji" | "pin">("emoji");
  const [deactivateSequence, setDeactivateSequence] = useState<string[]>([]);
  const [deactivatePin, setDeactivatePin] = useState("");
  const [deactivateError, setDeactivateError] = useState(false);

  const handleExport = async () => {
    try {
      setLoading(true);
      const filePath = await exportDatabase();
      setMessage(filePath || "Yedekleme dosyası başarıyla indirildi.");
      setTimeout(() => setMessage(""), 10000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setMessage("Hata: " + msg);
      setTimeout(() => setMessage(""), 6000);
    } finally {
      setLoading(false);
    }
  };

  const handleOpenRestoreDialog = async () => {
    setIsRestoreOpen(true);
    setSelectedFile(null);
    setLoadingFiles(true);
    setRestoreError(null);

    try {
      if (isTauri()) {
        const files = await listBackupFiles();
        setBackupFiles(files);
      } else {
        setBackupFiles([]);
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[Restore] List files error:", err);
      setRestoreError(msg);
      setBackupFiles([]);
    } finally {
      setLoadingFiles(false);
    }
  };

  const handleRestore = async () => {
    if (!selectedFile) return;
    setPendingFileName(selectedFile);
    setPendingContent(null);
    setConfirmRestore(true);
  };

  const handleManualFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const content = e.target?.result as string;
      if (!content) return;

      setPendingFileName(file.name);
      setPendingContent(content);
      setConfirmRestore(true);
    };
    reader.readAsText(file);
    event.target.value = "";
  };

  const executeRestore = async () => {
    try {
      setRestoring(true);
      let content = pendingContent;
      if (!content && pendingFileName) {
        content = await readTextFileFromDownloads(pendingFileName);
      }

      if (!content) throw new Error("Yedekleme içeriği okunamadı veya boş.");

      await importDatabase(content);

      setIsRestoreOpen(false);
      setConfirmRestore(false);
      setMessage("Veritabanı başarıyla geri yüklendi! Sayfa yenileniyor...");
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreError("Geri yükleme hatası: " + msg);
      setConfirmRestore(false);
    } finally {
      setRestoring(false);
    }
  };

  const handleStartDelete = (fileName: string) => {
    setPendingDeleteFile(fileName);
    // Generate a random 4-digit code
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setDeleteChallengeCode(code);
    setDeleteInputCode("");
    setConfirmDelete(true);
  };

  const executeDelete = async () => {
    if (!pendingDeleteFile) return;
    try {
      setRestoring(true);
      const { remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      await remove(pendingDeleteFile, { baseDir: BaseDirectory.Download });

      // Refresh list
      const files = await listBackupFiles();
      setBackupFiles(files);

      setConfirmDelete(false);
      setPendingDeleteFile(null);
      setMessage("Yedekleme dosyası cihazdan kalıcı olarak silindi.");
      setTimeout(() => setMessage(""), 5000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreError("Dosya silme hatası: " + msg);
      setConfirmDelete(false);
    } finally {
      setRestoring(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "—";
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  const extractDateFromFileName = (name: string) => {
    // is_takip_backup_2026-05-01_14-30.json -> 01 Mayıs 2026, 14:30
    const match = name.match(/(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})-(\d{2}))?/);
    if (!match) return name;
    const [, year, month, day, hour, minute] = match;
    const months = [
      "Ocak",
      "Şubat",
      "Mart",
      "Nisan",
      "Mayıs",
      "Haziran",
      "Temmuz",
      "Ağustos",
      "Eylül",
      "Ekim",
      "Kasım",
      "Aralık",
    ];
    const dateStr = `${parseInt(day)} ${months[parseInt(month) - 1]} ${year}`;
    if (hour && minute) {
      return `${dateStr}, ${hour}:${minute}`;
    }
    return dateStr;
  };

  // --- App Lock Setup Handlers ---
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
        // Compare sequences
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
      localStorage.setItem("appLockEnabled", "true");
      localStorage.setItem("appLockSequence", JSON.stringify(tempSequence));
      localStorage.setItem("appLockPin", nextPin);

      setIsLockEnabled(true);
      setTimeout(() => setSetupStep(4), 400);
    }
  };

  const handlePinSetupDelete = () => {
    if (tempPin.length > 0) {
      setTempPin(tempPin.slice(0, -1));
    }
  };

  // --- App Lock Deactivation Handlers ---
  const handleEmojiDeactivateSelect = (id: string) => {
    if (deactivateError) return;

    const nextSeq = [...deactivateSequence, id];
    setDeactivateSequence(nextSeq);

    if (nextSeq.length === 3) {
      const configuredSequence: string[] = JSON.parse(
        localStorage.getItem("appLockSequence") || "[]",
      );
      const isMatch = nextSeq.every((val, idx) => val === configuredSequence[idx]);

      if (isMatch) {
        // Correct Pattern: Deactivate!
        localStorage.removeItem("appLockEnabled");
        localStorage.removeItem("appLockSequence");
        localStorage.removeItem("appLockPin");
        setIsLockEnabled(false);
        setIsDeactivateOpen(false);
        setMessage("Uygulama kilidi başarıyla kaldırıldı.");
        setTimeout(() => setMessage(""), 3000);
      } else {
        setDeactivateError(true);
        if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
        setTimeout(() => {
          setDeactivateError(false);
          setDeactivateSequence([]);
        }, 800);
      }
    }
  };

  const handlePinDeactivateKeyPress = (num: string) => {
    if (deactivatePin.length >= 4 || deactivateError) return;
    const nextPin = deactivatePin + num;
    setDeactivatePin(nextPin);

    if (nextPin.length === 4) {
      const configuredPin = localStorage.getItem("appLockPin") || "";
      if (nextPin === configuredPin) {
        // Correct PIN: Deactivate!
        localStorage.removeItem("appLockEnabled");
        localStorage.removeItem("appLockSequence");
        localStorage.removeItem("appLockPin");
        setIsLockEnabled(false);
        setIsDeactivateOpen(false);
        setMessage("Uygulama kilidi başarıyla kaldırıldı.");
        setTimeout(() => setMessage(""), 3000);
      } else {
        setDeactivateError(true);
        if (navigator.vibrate) navigator.vibrate(150);
        setTimeout(() => {
          setDeactivateError(false);
          setDeactivatePin("");
        }, 800);
      }
    }
  };

  const handlePinDeactivateDelete = () => {
    if (deactivatePin.length > 0) {
      setDeactivatePin(deactivatePin.slice(0, -1));
    }
  };

  const handleToggleLock = () => {
    if (isLockEnabled) {
      // Prompt verification to turn off
      setDeactivateSequence([]);
      setDeactivatePin("");
      setDeactivateError(false);
      setDeactivateVerifyStep("emoji");
      setIsDeactivateOpen(true);
    } else {
      // Open wizard
      setSetupStep(1);
      setTempSequence([]);
      setConfirmSequence([]);
      setTempPin("");
      setLockSetupError(null);
      setIsLockSetupOpen(true);
    }
  };

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="pt-14 pb-4 px-5 border-b bg-card flex-shrink-0 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all flex-shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-slate-500/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-tight">Ayarlar</h1>
            <p className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">
              Sistem & Yönetim
            </p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5 space-y-8 pb-28 stagger-children">
        <div className="space-y-4">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" /> Görünüm & Arayüz
          </h2>
          <div className="p-1.5 rounded-2xl border-2 bg-card flex items-center shadow-sm">
            <button
              onClick={() => theme === "dark" && toggleTheme()}
              className={`flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all ${theme === "light" ? "bg-background shadow-md border text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Sun className={`w-4 h-4 ${theme === "light" ? "text-amber-500" : ""}`} /> Açık
            </button>
            <button
              onClick={() => theme === "light" && toggleTheme()}
              className={`flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all ${theme === "dark" ? "bg-background shadow-md border text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              <Moon className={`w-4 h-4 ${theme === "dark" ? "text-blue-400" : ""}`} /> Koyu
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Sistem
          </h2>
          <Button
            variant="outline"
            className="w-full h-[72px] rounded-2xl justify-start px-5 font-bold gap-4 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
            onClick={onNavigateLogs}
          >
            <History className="w-7 h-7 text-primary" />
            <div className="text-left">
              <div className="text-sm font-black">Sistem Geçmişi</div>
              <div className="text-[10px] text-muted-foreground font-bold tracking-wide mt-0.5">
                Kim ne zaman ne yapmış, hepsi burada
              </div>
            </div>
          </Button>

          {/* Uygulama Kilidi */}
          <div className="p-4 rounded-2xl border-2 bg-card space-y-3.5 shadow-sm relative overflow-hidden transition-all duration-300">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                <div
                  className={`w-11 h-11 rounded-xl flex items-center justify-center transition-all ${
                    isLockEnabled
                      ? "bg-amber-500/10 text-amber-500 animate-pulse"
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
                  <h3 className="text-sm font-black tracking-tight">Uygulama Kilidi</h3>
                  <p className="text-[10px] text-muted-foreground font-bold tracking-wide mt-0.5 uppercase">
                    {isLockEnabled ? "Görsel desen aktif 🔐" : "Korumasız giriş"}
                  </p>
                </div>
              </div>

              <button
                onClick={handleToggleLock}
                className={`h-9 px-4 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all duration-200 active:scale-95 ${
                  isLockEnabled
                    ? "bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 text-rose-500 hover:text-rose-600 border border-transparent hover:border-rose-200"
                    : "bg-primary hover:bg-primary/95 text-white shadow-md shadow-primary/10"
                }`}
              >
                {isLockEnabled ? "Kilidi Kapat" : "Etkinleştir"}
              </button>
            </div>

            {isLockEnabled && (
              <div className="pt-3 border-t border-dashed flex justify-between items-center text-[10px] font-bold text-muted-foreground">
                <div className="flex items-center gap-1.5">
                  <span className="uppercase tracking-wider opacity-60">Görsel Desen:</span>
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
                  className="text-primary hover:underline font-black uppercase tracking-wider text-[9px]"
                >
                  Deseni Değiştir
                </button>
              </div>
            )}
          </div>

          <Button
            variant="outline"
            className="w-full h-16 rounded-2xl justify-start px-5 font-bold gap-4 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all opacity-50"
          >
            <Bell className="w-6 h-6 text-muted-foreground" />
            <div className="text-left">
              <div className="text-sm font-black">Bildirimler</div>
              <div className="text-[10px] text-muted-foreground font-bold tracking-wide mt-0.5">
                Yakında gelecek, merak etme
              </div>
            </div>
          </Button>
        </div>

        <div className="space-y-4">
          <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" /> Veritabanı (Yedekleme)
          </h2>
          <div className="grid grid-cols-2 gap-3">
            <Button
              className="h-28 rounded-2xl flex flex-col gap-2.5 shadow-lg shadow-primary/20 active:scale-95 transition-all"
              onClick={handleExport}
              disabled={loading}
            >
              <DownloadCloud className="w-7 h-7" />
              <div className="text-xs font-black text-center leading-tight">
                Yedek Al <br />
                <span className="text-[9px] opacity-70 font-bold">(JSON İndir)</span>
              </div>
            </Button>

            <Button
              variant="outline"
              className="h-28 rounded-2xl flex flex-col gap-2.5 border-2 hover:bg-rose-50 hover:border-rose-200 hover:text-rose-600 active:scale-95 transition-all group"
              onClick={handleOpenRestoreDialog}
              disabled={loading}
            >
              <UploadCloud className="w-7 h-7 text-rose-500 group-hover:text-rose-600" />
              <div className="text-xs font-black text-center leading-tight group-hover:text-rose-600">
                Yedekten Dön <br />
                <span className="text-[9px] text-rose-500/70 font-bold">(Verileri Ezer)</span>
              </div>
            </Button>
          </div>
          <p className="text-[9px] text-center font-bold text-muted-foreground/60 px-4">
            Yedekten dönersen cihazdaki her şey silinir, dosyadaki veriler yüklenir. Dikkatli ol!
          </p>
        </div>

        <div className="space-y-4 pt-6 border-t border-dashed">
          <div className="flex flex-col items-center justify-center gap-2 opacity-60">
            <div className="w-12 h-12 rounded-2xl bg-muted flex items-center justify-center">
              <Smartphone className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-xs font-black tracking-widest uppercase">İş Takip Mobile</h3>
              <p className="text-[10px] font-bold mt-0.5">Versiyon 1.0.0</p>
            </div>
            <p className="text-[8px] mt-2 font-bold uppercase tracking-widest">
              © 2026 Tüm Hakları Saklıdır.
            </p>
          </div>
        </div>
      </div>

      {/* Yedekten Dön Dialog */}
      <Dialog
        open={isRestoreOpen}
        onOpenChange={(open) => {
          setIsRestoreOpen(open);
          if (!open) {
            setConfirmRestore(false);
            setConfirmDelete(false);
            setPendingContent(null);
            setPendingFileName(null);
            setPendingDeleteFile(null);
          }
        }}
      >
        <DialogContent className="max-w-md w-[95vw] rounded-3xl p-0 gap-0 border-none shadow-2xl bg-background">
          {confirmRestore ? (
            <div className="p-6 space-y-6">
              <div className="flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center animate-pulse">
                  <AlertTriangle className="w-8 h-8 text-rose-500" />
                </div>
                <div>
                  <h3 className="text-base font-black text-rose-600 dark:text-rose-400">
                    Veritabanı Üzerine Yazılacak
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto leading-relaxed">
                    Aşağıdaki yedekleme dosyası yüklenmek üzere seçildi:
                  </p>
                  <div className="mt-2.5 px-3 py-2 rounded-xl bg-muted text-[10px] font-mono break-all inline-block font-bold border max-w-full">
                    {pendingFileName}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border-2 border-rose-200 dark:border-rose-500/20 bg-rose-50/50 dark:bg-rose-500/5 space-y-2">
                <p className="text-[10px] font-bold text-rose-700 dark:text-rose-400 leading-relaxed text-center">
                  ⚠️ DİKKAT: Bu işlem mevcut tüm çalışan, çalışma durumu, ödeme ve geçmiş
                  kayıtlarınızı KALICI OLARAK SİLER. Geri dönüşü yok!
                </p>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  className="w-1/3 rounded-2xl h-12 font-bold text-muted-foreground bg-muted/60 hover:bg-muted transition-all active:scale-[0.97] text-xs"
                  onClick={() => setConfirmRestore(false)}
                  disabled={restoring}
                >
                  Vazgeç
                </button>
                <button
                  className="w-2/3 rounded-2xl h-12 font-black text-white bg-gradient-to-r from-rose-500 to-rose-600 shadow-lg shadow-rose-500/20 hover:from-rose-600 hover:to-rose-700 transition-all active:scale-[0.97] text-xs flex items-center justify-center gap-2"
                  onClick={executeRestore}
                  disabled={restoring}
                >
                  {restoring ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Geri Yükleniyor...
                    </>
                  ) : (
                    <>
                      <UploadCloud className="w-4 h-4" />
                      Evet, Sil ve Yükle
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : confirmDelete ? (
            <div className="p-6 space-y-6">
              <div className="flex flex-col items-center justify-center text-center space-y-3">
                <div className="w-16 h-16 rounded-full bg-rose-500/10 flex items-center justify-center animate-pulse">
                  <Trash2 className="w-8 h-8 text-rose-500" />
                </div>
                <div>
                  <h3 className="text-base font-black text-rose-600 dark:text-rose-400">
                    Yedekleme Dosyası Silinecek
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1 max-w-[280px] mx-auto leading-relaxed">
                    Aşağıdaki yedekleme dosyası cihazdan kalıcı olarak silinecektir:
                  </p>
                  <div className="mt-2.5 px-3 py-2 rounded-xl bg-muted text-[10px] font-mono break-all inline-block font-bold border max-w-full">
                    {pendingDeleteFile}
                  </div>
                </div>
              </div>

              <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-500/20 bg-rose-50/50 dark:bg-rose-500/5 text-center space-y-2">
                <p className="text-[10px] font-bold text-rose-700 dark:text-rose-400 leading-relaxed">
                  ⚠️ DİKKAT: Bu dosya cihazınızdan kalıcı olarak kaldırılacaktır ve geri
                  getirilemez!
                </p>
              </div>

              <div className="space-y-3">
                <div className="flex flex-col items-center justify-center gap-2">
                  <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider">
                    Güvenlik Doğrulama Kodu
                  </span>
                  <div className="px-4 py-2 rounded-2xl bg-slate-100 dark:bg-slate-800 text-lg font-black tracking-widest text-foreground border select-none">
                    {deleteChallengeCode}
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label
                    htmlFor="delete-code-input"
                    className="text-[9px] font-bold text-muted-foreground uppercase ml-1"
                  >
                    Silmek için yukarıdaki kodu girin
                  </label>
                  <input
                    id="delete-code-input"
                    type="text"
                    maxLength={4}
                    value={deleteInputCode}
                    onChange={(e) => setDeleteInputCode(e.target.value)}
                    placeholder="Kodu girin..."
                    className="w-full h-12 px-4 rounded-xl border-2 border-border bg-card text-center text-sm font-black tracking-widest focus:border-rose-500 focus:outline-none transition-all"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button
                  className="w-1/3 rounded-2xl h-12 font-bold text-muted-foreground bg-muted/60 hover:bg-muted transition-all active:scale-[0.97] text-xs"
                  onClick={() => {
                    setConfirmDelete(false);
                    setPendingDeleteFile(null);
                  }}
                  disabled={restoring}
                >
                  Vazgeç
                </button>
                <button
                  className={`w-2/3 rounded-2xl h-12 font-black text-white transition-all active:scale-[0.97] text-xs flex items-center justify-center gap-2 ${
                    deleteInputCode === deleteChallengeCode
                      ? "bg-gradient-to-r from-rose-500 to-rose-600 shadow-lg shadow-rose-500/20 hover:from-rose-600 hover:to-rose-700"
                      : "bg-muted text-muted-foreground cursor-not-allowed shadow-none"
                  }`}
                  onClick={executeDelete}
                  disabled={deleteInputCode !== deleteChallengeCode || restoring}
                >
                  {restoring ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Siliniyor...
                    </>
                  ) : (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Dosyayı Kalıcı Olarak Sil
                    </>
                  )}
                </button>
              </div>
            </div>
          ) : (
            <>
              <DialogHeader className="px-5 pt-6 pb-3 border-b flex-shrink-0">
                <DialogTitle className="text-base font-black flex items-center gap-2">
                  <Database className="w-5 h-5 text-rose-500" />
                  Yedekten Geri Yükle
                </DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-1">
                  İndirilenler klasöründeki yedekleme dosyalarından birini seçin.
                </DialogDescription>
              </DialogHeader>

              <div className="px-5 py-4 max-h-[50vh] overflow-y-auto">
                {restoreError && (
                  <div className="mb-4 p-4 rounded-2xl border-2 border-rose-100 bg-rose-50/50 dark:border-rose-500/20 dark:bg-rose-500/5 text-rose-600 dark:text-rose-400 space-y-2 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center gap-2">
                      <AlertTriangle className="w-5 h-5 text-rose-500" />
                      <span className="text-xs font-black">Yedek Listeleme Hatası</span>
                    </div>
                    <p className="text-[10px] font-bold leading-relaxed">{restoreError}</p>
                  </div>
                )}

                {loadingFiles ? (
                  <div className="flex flex-col items-center justify-center py-12 gap-3">
                    <Loader2 className="w-8 h-8 text-primary animate-spin" />
                    <p className="text-xs font-bold text-muted-foreground">Dosyalar taranıyor...</p>
                  </div>
                ) : backupFiles.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-4 text-center">
                    <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center">
                      <FileText className="w-8 h-8 text-muted-foreground/40" />
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-bold text-muted-foreground">
                        Yedekleme dosyası bulunamadı
                      </p>
                      <p className="text-[10px] text-muted-foreground/60 max-w-[240px] mx-auto leading-relaxed">
                        İndirilenler klasöründe otomatik yedek dosyası bulunamadı veya klasör erişim
                        izni yok.
                      </p>
                    </div>

                    <div className="pt-2 w-full px-2">
                      <label
                        htmlFor="manual-backup-file-input"
                        className="flex items-center justify-center gap-2 h-12 w-full rounded-2xl border-2 border-dashed border-primary/40 hover:border-primary bg-primary/5 hover:bg-primary/10 text-primary font-bold text-xs cursor-pointer transition-all active:scale-[0.98]"
                      >
                        <UploadCloud className="w-4 h-4 text-primary animate-bounce" />
                        Cihazdan Manuel Yedek Seç (.json)
                      </label>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {backupFiles.map((file) => (
                        <button
                          key={file.name}
                          onClick={() => setSelectedFile(file.name)}
                          className={`w-full p-4 rounded-2xl border-2 text-left transition-all active:scale-[0.98] ${
                            selectedFile === file.name
                              ? "border-primary bg-primary/5 shadow-md shadow-primary/10"
                              : "border-border bg-card hover:border-primary/30 hover:bg-muted/30"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <div
                              className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                                selectedFile === file.name
                                  ? "bg-primary text-white"
                                  : "bg-muted text-muted-foreground"
                              }`}
                            >
                              <FileText className="w-5 h-5" />
                            </div>
                            <div className="flex-1 min-w-0 flex items-center justify-between gap-2">
                              <div>
                                <p className="text-sm font-black truncate">
                                  {extractDateFromFileName(file.name)}
                                </p>
                                <p className="text-[10px] text-muted-foreground font-bold mt-0.5">
                                  {formatFileSize(file.size)} • {file.name}
                                </p>
                              </div>

                              <div className="flex items-center gap-1.5 flex-shrink-0">
                                {selectedFile === file.name && (
                                  <div className="w-6 h-6 rounded-full bg-primary flex items-center justify-center">
                                    <svg
                                      className="w-3.5 h-3.5 text-white"
                                      fill="none"
                                      viewBox="0 0 24 24"
                                      stroke="currentColor"
                                      strokeWidth={3}
                                    >
                                      <path
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        d="M5 13l4 4L19 7"
                                      />
                                    </svg>
                                  </div>
                                )}

                                {isTauri() && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleStartDelete(file.name);
                                    }}
                                    className="w-9 h-9 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 text-rose-500 hover:text-rose-600 flex items-center justify-center transition-all active:scale-90"
                                    title="Yedeği Kalıcı Olarak Sil"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </button>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-dashed">
                      <label
                        htmlFor="manual-backup-file-input"
                        className="flex items-center justify-center gap-2 h-10 w-full rounded-xl border border-dashed border-muted-foreground/35 hover:border-primary hover:bg-primary/5 text-muted-foreground hover:text-primary font-bold text-[11px] cursor-pointer transition-all active:scale-[0.99]"
                      >
                        <UploadCloud className="w-3.5 h-3.5" />
                        Cihazdan Farklı Bir Yedek Seç (.json)
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Uyarı + Butonlar */}
              {backupFiles.length > 0 && (
                <div className="px-5 pb-5 pt-2 border-t space-y-3">
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                    <p className="text-[10px] font-bold text-amber-700 dark:text-amber-400 leading-relaxed">
                      Bu işlem mevcut tüm verileri siler ve seçilen yedeği yükler. Geri alınamaz!
                    </p>
                  </div>
                  <div className="flex gap-3">
                    <button
                      className="w-1/3 rounded-2xl h-12 font-bold text-muted-foreground bg-muted/50 hover:bg-muted transition-all active:scale-[0.97] text-sm"
                      onClick={() => setIsRestoreOpen(false)}
                    >
                      İptal
                    </button>
                    <button
                      className={`w-2/3 rounded-2xl h-12 font-black text-white shadow-lg transition-all active:scale-[0.97] text-sm flex items-center justify-center gap-2 ${
                        selectedFile
                          ? "bg-gradient-to-r from-rose-500 to-rose-600 shadow-rose-500/20"
                          : "bg-muted text-muted-foreground cursor-not-allowed shadow-none"
                      }`}
                      onClick={handleRestore}
                      disabled={!selectedFile || restoring}
                    >
                      {restoring ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Yükleniyor...
                        </>
                      ) : (
                        <>
                          <UploadCloud className="w-4 h-4" />
                          Geri Yükle
                        </>
                      )}
                    </button>
                  </div>
                </div>
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
      <input
        type="file"
        id="manual-backup-file-input"
        accept=".json"
        onChange={handleManualFileSelect}
        className="hidden"
      />

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
        <DialogContent className="max-w-md w-[95vw] rounded-3xl p-6 gap-0 border-none shadow-2xl bg-background">
          {setupStep === 1 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto">
                  <Lock className="w-6 h-6 text-primary" />
                </div>
                <h3 className="text-base font-black">Desen Belirle</h3>
                <p className="text-xs text-muted-foreground font-bold">
                  3 tane resme sırayla dokun, şifren hazır.
                </p>
              </div>

              {/* Slots */}
              <div className="flex justify-center gap-3">
                {[0, 1, 2].map((idx) => {
                  const id = tempSequence[idx];
                  const emo = EMOJIS.find((e) => e.id === id);
                  return (
                    <div
                      key={idx}
                      className="w-12 h-12 rounded-xl border-2 bg-muted/40 flex items-center justify-center text-xl font-bold transition-all duration-300 border-border"
                    >
                      {emo?.char || ""}
                    </div>
                  );
                })}
              </div>

              {/* Grid */}
              <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji.id}
                    onClick={() => handleEmojiSetupSelect(emoji.id)}
                    className="aspect-square rounded-2xl border-2 flex flex-col items-center justify-center bg-card hover:border-amber-400/50 hover:bg-amber-400/5 active:scale-90 transition-all border-border"
                  >
                    <span className="text-2xl filter drop-shadow-sm mb-0.5">{emoji.char}</span>
                    <span className="text-[8px] font-black uppercase text-muted-foreground/60 tracking-wider">
                      {emoji.name}
                    </span>
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                className="w-full h-12 rounded-xl text-xs font-bold border-2"
                onClick={() => setIsLockSetupOpen(false)}
              >
                İptal
              </Button>
            </div>
          )}

          {setupStep === 2 && (
            <div className="space-y-6">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-amber-500/10 flex items-center justify-center mx-auto animate-pulse">
                  <Lock className="w-6 h-6 text-amber-500" />
                </div>
                <h3 className="text-base font-black">Bir Daha Seç</h3>
                <p className="text-xs text-muted-foreground font-bold">
                  Aynı 3 resmi tekrar sırasıyla seç, doğrulayalim.
                </p>
              </div>

              {/* Slots */}
              <div className="flex justify-center gap-3">
                {[0, 1, 2].map((idx) => {
                  const id = confirmSequence[idx];
                  const emo = EMOJIS.find((e) => e.id === id);
                  return (
                    <div
                      key={idx}
                      className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all duration-300 ${
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
                <p className="text-[10px] font-bold text-rose-500 text-center animate-shake">
                  {lockSetupError}
                </p>
              )}

              {/* Grid */}
              <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
                {EMOJIS.map((emoji) => (
                  <button
                    key={emoji.id}
                    onClick={() => handleEmojiSetupSelect(emoji.id)}
                    className="aspect-square rounded-2xl border-2 flex flex-col items-center justify-center bg-card hover:border-amber-400/50 hover:bg-amber-400/5 active:scale-90 transition-all border-border"
                  >
                    <span className="text-2xl filter drop-shadow-sm mb-0.5">{emoji.char}</span>
                    <span className="text-[8px] font-black uppercase text-muted-foreground/60 tracking-wider">
                      {emoji.name}
                    </span>
                  </button>
                ))}
              </div>

              <div className="flex gap-2">
                <Button
                  variant="outline"
                  className="w-1/3 h-12 rounded-xl text-xs font-bold border-2"
                  onClick={() => setSetupStep(1)}
                >
                  Geri Git
                </Button>
                <Button
                  variant="outline"
                  className="w-2/3 h-12 rounded-xl text-xs font-bold border-2"
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
                <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto text-rose-500">
                  <ShieldCheck className="w-6 h-6" />
                </div>
                <h3 className="text-base font-black">Kurtarma Şifresi Belirleyin</h3>
                <p className="text-xs text-muted-foreground font-bold leading-relaxed max-w-[280px] mx-auto">
                  Deseninizi unuttuğunuzda kilidi sıfırlamak için kullanacağınız 4 haneli bir şifre
                  girin.
                </p>
              </div>

              {/* Indicator dots */}
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

              {/* Keypad */}
              <div className="grid grid-cols-3 gap-2.5 max-w-[240px] mx-auto">
                {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                  <button
                    key={num}
                    onClick={() => handlePinSetupKeyPress(num)}
                    className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-black flex items-center justify-center active:scale-90 transition-all border border-border"
                  >
                    {num}
                  </button>
                ))}
                <div />
                <button
                  onClick={() => handlePinSetupKeyPress("0")}
                  className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-black flex items-center justify-center active:scale-90 transition-all border border-border"
                >
                  0
                </button>
                <button
                  onClick={handlePinSetupDelete}
                  className="w-full aspect-square max-h-13 rounded-full bg-muted/10 hover:bg-muted text-[10px] font-black flex items-center justify-center active:scale-90 transition-all text-rose-500"
                >
                  Sil
                </button>
              </div>
            </div>
          )}

          {setupStep === 4 && (
            <div className="space-y-6 py-4 text-center">
              <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto text-emerald-500 animate-scale-in">
                <Check className="w-8 h-8 stroke-[3]" />
              </div>
              <div className="space-y-2">
                <h3 className="text-lg font-black text-emerald-600 dark:text-emerald-400">
                  Kilit Hazır! 🚀
                </h3>
                <p className="text-xs text-muted-foreground font-bold leading-relaxed max-w-[280px] mx-auto">
                  Artık uygulaman kilitli, veriler güvende.
                </p>
              </div>

              <div className="p-4 rounded-xl border border-emerald-100 bg-emerald-50/20 dark:border-emerald-500/10 dark:bg-emerald-500/5 text-left space-y-2">
                <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-400 leading-relaxed text-center">
                  💡 Uygulamayı alta alınca otomatik kilitlenir. Şifreni unutursan kurtarma PIN'in:{" "}
                  <strong>{localStorage.getItem("appLockPin")}</strong>
                </p>
              </div>

              <Button
                className="w-full h-12 rounded-xl text-xs font-black bg-gradient-to-r from-emerald-500 to-emerald-600 shadow-md shadow-emerald-500/15"
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
        <DialogContent className="max-w-md w-[95vw] rounded-3xl p-6 gap-0 border-none shadow-2xl bg-background">
          <div className="space-y-6">
            <div className="text-center space-y-2">
              <div className="w-12 h-12 rounded-2xl bg-rose-500/10 flex items-center justify-center mx-auto text-rose-500">
                <Unlock className="w-6 h-6" />
              </div>
              <h3 className="text-base font-black">Kilidi Kapat</h3>
              <p className="text-xs text-muted-foreground font-bold">
                Önce mevcut desenini veya PIN'ini doğrula.
              </p>
            </div>

            {/* Segmented control to toggle verify mode */}
            <div className="p-1 rounded-xl bg-muted flex border border-border">
              <button
                onClick={() => {
                  setDeactivateVerifyStep("emoji");
                  setDeactivateSequence([]);
                  setDeactivatePin("");
                  setDeactivateError(false);
                }}
                className={`flex-1 h-9 rounded-lg font-black text-[10px] uppercase transition-all ${
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
                className={`flex-1 h-9 rounded-lg font-black text-[10px] uppercase transition-all ${
                  deactivateVerifyStep === "pin"
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                PIN Kodu
              </button>
            </div>

            {deactivateVerifyStep === "emoji" ? (
              // Emoji Sequence verification
              <div className="space-y-6">
                {/* Slots */}
                <div className="flex justify-center gap-3">
                  {[0, 1, 2].map((idx) => {
                    const id = deactivateSequence[idx];
                    const emo = EMOJIS.find((e) => e.id === id);
                    return (
                      <div
                        key={idx}
                        className={`w-12 h-12 rounded-xl border-2 flex items-center justify-center text-xl font-bold transition-all duration-300 ${
                          deactivateError
                            ? "border-rose-500 bg-rose-500/10 animate-shake"
                            : "border-border bg-muted/40"
                        }`}
                      >
                        {emo?.char || ""}
                      </div>
                    );
                  })}
                </div>

                {/* Grid */}
                <div className="grid grid-cols-3 gap-3 max-w-[280px] mx-auto">
                  {EMOJIS.map((emoji) => (
                    <button
                      key={emoji.id}
                      onClick={() => handleEmojiDeactivateSelect(emoji.id)}
                      className="aspect-square rounded-2xl border-2 flex flex-col items-center justify-center bg-card hover:border-amber-400/50 hover:bg-amber-400/5 active:scale-90 transition-all border-border"
                    >
                      <span className="text-2xl filter drop-shadow-sm mb-0.5">{emoji.char}</span>
                      <span className="text-[8px] font-black uppercase text-muted-foreground/60 tracking-wider">
                        {emoji.name}
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              // Recovery PIN verification
              <div className="space-y-6">
                {/* Indicator dots */}
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

                {/* Keypad */}
                <div className="grid grid-cols-3 gap-2.5 max-w-[240px] mx-auto">
                  {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
                    <button
                      key={num}
                      onClick={() => handlePinDeactivateKeyPress(num)}
                      className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-black flex items-center justify-center active:scale-90 transition-all border border-border"
                    >
                      {num}
                    </button>
                  ))}
                  <div />
                  <button
                    onClick={() => handlePinDeactivateKeyPress("0")}
                    className="w-full aspect-square max-h-13 rounded-full bg-muted/40 hover:bg-muted text-base font-black flex items-center justify-center active:scale-90 transition-all border border-border"
                  >
                    0
                  </button>
                  <button
                    onClick={handlePinDeactivateDelete}
                    className="w-full aspect-square max-h-13 rounded-full bg-muted/10 hover:bg-muted text-[10px] font-black flex items-center justify-center active:scale-90 transition-all text-rose-500"
                  >
                    Sil
                  </button>
                </div>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full h-12 rounded-xl text-xs font-bold border-2"
              onClick={() => setIsDeactivateOpen(false)}
            >
              Vazgeç
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {message && (
        <div
          className={`fixed bottom-6 left-4 right-4 z-[9999] p-4 rounded-2xl bg-card/95 backdrop-blur-md border shadow-2xl flex items-start gap-3 animate-in slide-in-from-bottom duration-300 ${
            message.startsWith("Hata") ? "border-rose-500/30" : "border-emerald-500/30"
          }`}
        >
          <div
            className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
              message.startsWith("Hata") ? "bg-rose-500/10" : "bg-emerald-500/10"
            }`}
          >
            {message.startsWith("Hata") ? (
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            ) : (
              <DownloadCloud className="w-5 h-5 text-emerald-500" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4
              className={`text-xs font-black ${
                message.startsWith("Hata")
                  ? "text-rose-600 dark:text-rose-400"
                  : "text-emerald-600 dark:text-emerald-400"
              }`}
            >
              {message.startsWith("Hata")
                ? "Yedekleme Başarılı Olmadı"
                : "Yedek Dosyası İndirildi!"}
            </h4>
            <p className="text-[10px] font-bold text-muted-foreground mt-0.5 leading-relaxed break-all select-all">
              {message.startsWith("Hata") ? message.replace("Hata: ", "") : message}
            </p>
          </div>
          {!message.startsWith("Hata") && (
            <button
              onClick={() => {
                navigator.clipboard.writeText(message);
                alert("Yedek dosyasının tam yolu panoya kopyalandı!");
              }}
              className="w-10 h-10 rounded-xl bg-muted/60 hover:bg-emerald-500/10 hover:text-emerald-500 flex items-center justify-center flex-shrink-0 transition-all active:scale-90"
              title="Yolu Kopyala"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3"
                />
              </svg>
            </button>
          )}
        </div>
      )}
    </div>
  );
}
