import { useState } from "react";
import {
  DownloadCloud,
  UploadCloud,
  Database,
  FileText,
  AlertTriangle,
  Loader2,
  Trash2,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  exportDatabase,
  importDatabase,
  summarizeBackupFile,
  type BackupSummary,
} from "../lib/backup";
import { auditLogRepository } from "../repositories/auditLogRepository";
import {
  isTauri,
  listBackupFiles,
  readTextFileFromDownloads,
  removeFileFromDownloads,
} from "../lib/tauri";
import type { BackupFileInfo } from "../lib/tauri";
import { useToastStore } from "../stores/toastStore";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "./ui/dialog";

export function BackupSection() {
  const addToast = useToastStore((s) => s.addToast);
  const [loading, setLoading] = useState(false);
  const [isRestoreOpen, setIsRestoreOpen] = useState(false);
  const [backupFiles, setBackupFiles] = useState<BackupFileInfo[]>([]);
  const [loadingFiles, setLoadingFiles] = useState(false);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [confirmRestore, setConfirmRestore] = useState(false);
  const [pendingContent, setPendingContent] = useState<string | null>(null);
  const [pendingFileName, setPendingFileName] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pendingDeleteFile, setPendingDeleteFile] = useState<string | null>(null);
  const [deleteChallengeCode, setDeleteChallengeCode] = useState("");
  const [deleteInputCode, setDeleteInputCode] = useState("");
  const [pendingSummary, setPendingSummary] = useState<BackupSummary | null>(null);
  const [safetyBackupPath, setSafetyBackupPath] = useState<string | null>(null);

  const handleExport = async () => {
    try {
      setLoading(true);
      const filePath = await exportDatabase();
      addToast(`Yedek alındı: ${filePath}`, "success");
    } catch (err: unknown) {
      addToast(`Yedek alınamadı: ${err instanceof Error ? err.message : String(err)}`, "error");
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

  /** Dosyayı önce doğrular ve özetler; geçersizse geri yükleme başlatılmaz. */
  const prepareRestore = (fileName: string, content: string) => {
    try {
      setPendingSummary(summarizeBackupFile(content));
      setPendingFileName(fileName);
      setPendingContent(content);
      setRestoreError(null);
      setConfirmRestore(true);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreError(msg);
      setConfirmRestore(false);
      addToast(msg, "error");
    }
  };

  const handleRestore = async () => {
    if (!selectedFile) return;
    try {
      setRestoring(true);
      prepareRestore(selectedFile, await readTextFileFromDownloads(selectedFile));
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : String(err));
    } finally {
      setRestoring(false);
    }
  };

  const handleManualFileSelect = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
      const content = e.target?.result as string;
      if (!content) return;
      prepareRestore(file.name, content);
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

      const { summary, safetyBackupPath: safetyPath } = await importDatabase(content);

      setSafetyBackupPath(safetyPath);
      setIsRestoreOpen(false);
      setConfirmRestore(false);
      addToast(
        `Geri yüklendi: ${summary.workers} çalışan, ${summary.attendance} puantaj kaydı. Sayfa yenileniyor...`,
        "success",
      );
      setTimeout(() => window.location.reload(), 2000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreError(msg);
      setConfirmRestore(false);
      addToast(`Geri yükleme yapılmadı: ${msg}`, "error");
    } finally {
      setRestoring(false);
    }
  };

  const handleStartDelete = (fileName: string) => {
    setPendingDeleteFile(fileName);
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    setDeleteChallengeCode(code);
    setDeleteInputCode("");
    setConfirmDelete(true);
  };

  const executeDelete = async () => {
    if (!pendingDeleteFile) return;
    try {
      setRestoring(true);
      await removeFileFromDownloads(pendingDeleteFile);

      await auditLogRepository.write(
        "DELETE_FILE",
        "backup",
        0,
        JSON.stringify({ file: pendingDeleteFile }),
      );

      setBackupFiles(await listBackupFiles());
      setConfirmDelete(false);
      setPendingDeleteFile(null);
      addToast("Yedekleme dosyası cihazdan silindi.", "success");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setRestoreError(`Dosya silinemedi: ${msg}`);
      addToast(`Dosya silinemedi: ${msg}`, "error");
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

  return (
    <>
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
              <span className="text-[10px] opacity-70 font-bold">(JSON İndir)</span>
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
              <span className="text-[10px] text-rose-500/70 font-bold">(Verileri Ezer)</span>
            </div>
          </Button>
        </div>
        <p className="text-[11px] text-center font-bold text-muted-foreground/70 px-4">
          Yedekten dönerken mevcut verinin otomatik yedeği alınır, ardından dosyadaki veriler tek
          seferde yüklenir.
        </p>
        {safetyBackupPath && (
          <p className="text-[10px] text-center font-mono text-muted-foreground/70 px-4 break-all">
            Son otomatik yedek: {safetyBackupPath}
          </p>
        )}
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
            setPendingSummary(null);
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
                  <p className="text-xs text-muted-foreground mt-1 max-w-70 mx-auto leading-relaxed">
                    Aşağıdaki yedekleme dosyası yüklenmek üzere seçildi:
                  </p>
                  <div className="mt-2.5 px-3 py-2 rounded-xl bg-muted text-[11px] font-mono break-all inline-block font-bold border max-w-full">
                    {pendingFileName}
                  </div>
                </div>
              </div>

              {/* Dosya doğrulandı — ne yükleneceği önceden gösterilir. */}
              {pendingSummary && (
                <div className="rounded-xl border bg-card divide-y">
                  {[
                    {
                      label: "Yedek tarihi",
                      value: pendingSummary.exported_at
                        ? new Date(pendingSummary.exported_at).toLocaleString("tr-TR")
                        : "—",
                    },
                    { label: "Biçim sürümü", value: `v${pendingSummary.version}` },
                    { label: "Çalışan", value: `${pendingSummary.workers}` },
                    { label: "Puantaj kaydı", value: `${pendingSummary.attendance}` },
                    { label: "Gün verisi", value: `${pendingSummary.daily_metrics}` },
                    { label: "Ödeme", value: `${pendingSummary.payments}` },
                  ].map((row) => (
                    <div
                      key={row.label}
                      className="flex items-center justify-between px-3 py-2 text-[11px]"
                    >
                      <span className="font-bold text-muted-foreground">{row.label}</span>
                      <span className="font-black font-mono">{row.value}</span>
                    </div>
                  ))}
                </div>
              )}

              <div className="p-4 rounded-xl border-2 border-rose-200 dark:border-rose-500/20 bg-rose-50/50 dark:bg-rose-500/5 space-y-2">
                <p className="text-[11px] font-bold text-rose-700 dark:text-rose-400 leading-relaxed text-center">
                  ⚠️ Mevcut tüm çalışan, puantaj, ödeme ve geçmiş kayıtları bu dosyadakilerle
                  değiştirilecek.
                </p>
                <p className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400 leading-relaxed text-center">
                  Silmeden hemen önce mevcut verinizin otomatik bir yedeği İndirilenler klasörüne
                  kaydedilir. İşlem yarıda kalırsa hiçbir şey değişmez.
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
                  className="w-2/3 rounded-2xl h-12 font-black text-white bg-linear-to-r from-rose-500 to-rose-600 shadow-lg shadow-rose-500/20 hover:from-rose-600 hover:to-rose-700 transition-all active:scale-[0.97] text-xs flex items-center justify-center gap-2"
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
                  <p className="text-xs text-muted-foreground mt-1 max-w-70 mx-auto leading-relaxed">
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
                    className="text-[10px] font-bold text-muted-foreground uppercase ml-1"
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
                      ? "bg-linear-to-r from-rose-500 to-rose-600 shadow-lg shadow-rose-500/20 hover:from-rose-600 hover:to-rose-700"
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
              <DialogHeader className="px-5 pt-6 pb-3 border-b shrink-0">
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
                      <p className="text-[10px] text-muted-foreground/60 max-w-60 mx-auto leading-relaxed">
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
                              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
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

                              <div className="flex items-center gap-1.5 shrink-0">
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

              {backupFiles.length > 0 && (
                <div className="px-5 pb-5 pt-2 border-t space-y-3">
                  <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20">
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
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
                          ? "bg-linear-to-r from-rose-500 to-rose-600 shadow-rose-500/20"
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
    </>
  );
}
