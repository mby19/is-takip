import { useRef, useState } from "react";
import { UserPlus, DatabaseBackup, FolderOpen, Loader2, Users } from "lucide-react";
import { Button } from "./ui/button";
import { importDatabase } from "../lib/backup";
import { reportError } from "../lib/errorMonitoring";

interface EmptyStateProps {
  /** Kullanıcıyı "Kişiler" sekmesine götürür — ekranın kendi navigasyonu bilmez. */
  onGoToWorkers: () => void;
}

/**
 * Veritabanı boşken (ilk açılış) gösterilen karşılama.
 *
 * Bu uygulama bir araç uygulaması; hedef kullanıcı işini zaten bilen biri.
 * Bu yüzden adım adım sihirbaz YOK: kullanıcıya "1. şunu yap, 2. bunu yap"
 * diyen bir akış, işini bilen kişiye zaman kaybı, bilmeyene de zaten
 * yardımcı olmaz. Bunun yerine tek ekran, iki yol:
 *
 * 1. **Personel ekle** — ekibi bu cihazda sıfırdan kurma yolu.
 * 2. **Yedekten geri yükle** — başka bir cihazda kullanılmışsa oradan
 *    devam etme yolu. Bu seçenek "yedek al" başlığıyla gizlenmiştir: ilk
 *    açılışta çoğu kullanıcı için gereksiz, ama "verim nerede?" diyen
 *    kullanıcı için tek kurtarma yolu.
 *
 * Boş durum `workers.length === 0` üzerinden türetilir, ayrı bir "ilk açılış"
 * bayrağı üzerinden değil. Bayrak kullanılsaydı, kullanıcı son çalışanını
 * arşivlediğinde veya bir veri hatası yedekten döndüğünde ekran yanlışlıkla
 * "ilk açılış" derdi.
 */
export function EmptyState({ onGoToWorkers }: EmptyStateProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  const restoreFromFile = async (file: File) => {
    if (restoring) return;
    setRestoring(true);
    setRestoreError(null);
    try {
      const content = await file.text();
      await importDatabase(content);
      // Geri yükleme bağlantı havuzunu değiştirdiği için sayfa yeniden
      // yüklenmeli; store'lar eski boş durumda kalmış olur.
      window.location.reload();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      reportError(err instanceof Error ? err : new Error(message), { scope: "first-run-restore" });
      setRestoreError(message);
      setRestoring(false);
    }
  };

  return (
    <div
      className="flex-1 flex flex-col items-center justify-center p-6 text-center overflow-y-auto"
      role="region"
      aria-label="Başlangıç"
    >
      <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
        <Users className="w-9 h-9 text-primary/60" />
      </div>

      <h2 className="text-lg font-semibold tracking-tight mt-4">Henüz çalışan yok</h2>
      <p className="text-sm text-muted-foreground leading-relaxed max-w-72 mt-1.5">
        Puantaj tutmaya başlamak için ekibinizi ekleyin. İsim ve yevmiye yeterlidir; geri kalanı
        sonra doldurursunuz.
      </p>

      <Button
        onClick={onGoToWorkers}
        className="w-full max-w-72 rounded-card h-14 font-semibold shadow-lg shadow-primary/20 active:scale-[0.98] transition-all mt-6"
      >
        <UserPlus className="w-5 h-5" /> Personel Ekle
      </Button>

      {/* Kurtarma yolu: ayrı bir başlık değil, ikincil bir bağlantı. */}
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={restoring}
        className="flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-primary transition-colors mt-4 py-2 disabled:opacity-50"
      >
        {restoring ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <DatabaseBackup className="w-4 h-4" />
        )}
        {restoring ? "Geri Yükleniyor..." : "Başka cihazda mı kullandınız? Yedekten geri yükle"}
      </button>

      {restoreError && (
        <p className="text-[11px] font-medium text-bad bg-bad-soft border border-rose-100 dark:border-rose-500/20 rounded-card px-3 py-2 mt-3 max-w-72 leading-relaxed">
          Geri yükleme başarısız: {restoreError}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground/70 leading-relaxed max-w-72 mt-4">
        Yedekler "İndirilenler" klasöründe, is_takip_backup_*.json adıyla durur. Aynı işlem{" "}
        <FolderOpen className="w-3 h-3 inline align-[-1px]" /> Ayarlar › Yedekleme bölümünden de
        yapılabilir.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="application/json,.json"
        className="sr-only"
        aria-label="Yedek dosyası seç"
        disabled={restoring}
        onChange={(e) => {
          const file = e.target.files?.[0];
          // Aynı dosya ikinci kez seçilirse değişim olmasın diye girdi sıfırlanır.
          e.target.value = "";
          if (file) void restoreFromFile(file);
        }}
      />
    </div>
  );
}
