import { useThemeStore, PALETTE_PREVIEW } from "../stores/themeStore";
import type { ThemePalette } from "../stores/themeStore";
import {
  Settings,
  History,
  ArrowLeft,
  Moon,
  Sun,
  Smartphone,
  Palette,
  AlertTriangle,
} from "lucide-react";
import { Button } from "./ui/button";
import { BackupSection } from "./BackupSection";
import { LockSetupWizard } from "./LockSetupWizard";
import { CsvExportSection } from "./CsvExportSection";
import { PeriodLockSection } from "./PeriodLockSection";
import { ReminderSection } from "./ReminderSection";
import { getTriggerSetupError, getSchemaReport, getJournalModeWarning } from "../lib/db";
import { usePeriodStore } from "../stores/periodStore";
import { APP_VERSION } from "../lib/appInfo";

const PALETTES: { id: ThemePalette; label: string; desc: string }[] = [
  { id: "ocean", label: "Okyanus", desc: "Sakin mavi, sıcak zemin" },
  { id: "graphite", label: "Grafit", desc: "Nötr gri, keskin mavi" },
  { id: "midnight", label: "Gece Yarısı", desc: "Derin indigo" },
  { id: "mint", label: "Nane", desc: "Serin yeşil-mavi" },
  { id: "forest", label: "Orman", desc: "Doğal yeşil tonları" },
  { id: "plum", label: "Erik", desc: "Koyu mor, gül vurgusu" },
  { id: "sunset", label: "Günbatımı", desc: "Sıcak amber & mercan" },
  { id: "mono", label: "Tek Renk", desc: "Yalın gri skalası" },
];

export function SettingsView({
  onBack,
  onNavigateLogs,
}: {
  onBack: () => void;
  onNavigateLogs: () => void;
}) {
  const triggerError = getTriggerSetupError();
  const schema = getSchemaReport();
  const themeMode = useThemeStore((s) => s.mode);
  const themePalette = useThemeStore((s) => s.palette);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const setPalette = useThemeStore((s) => s.setPalette);

  // Dönem kilidi listesi okunamadıysa `isDateInClosedPeriod` fail-closed
  // çalışır: HİÇBİR tarih kapalı sayılır ve hiçbir kayıt kaydedilemez.
  // Kullanıcı bunun neden kaydedemediğini görmezse saatlerce kendini suçlar.
  const periodError = usePeriodStore((s) => s.error);
  const periodLoaded = usePeriodStore((s) => s.closedLoaded);
  const journalWarning = getJournalModeWarning();
  return (
    <div className="flex flex-col h-full bg-background">
      <header className="pt-safe-header pb-4 px-5 border-b bg-card shrink-0 flex items-center gap-3">
        <button
          onClick={onBack}
          aria-label="Geri"
          className="tap-target rounded-control bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
        >
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-control bg-slate-500/10 flex items-center justify-center">
            <Settings className="w-5 h-5 text-slate-500" />
          </div>
          <div>
            <h1 className="text-lg font-semibold tracking-tight">Ayarlar</h1>
            <p className="text-[10px] font-bold text-muted-foreground  ">Sistem & Yönetim</p>
          </div>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto p-5 space-y-8 pb-safe-content">
        {schema.failures.length > 0 && (
          <div className="p-4 rounded-card border-2 border-bad/40 bg-bad-soft flex gap-3">
            <AlertTriangle className="w-5 h-5 text-bad shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-xs font-semibold text-bad">Veritabanı şeması eksik</h3>
              <p className="text-[11px] text-bad/90 mt-1 leading-relaxed">
                Bazı tablolar oluşturulamadı; yedekleme ve dönem kilidi çalışmayabilir. Uygulamayı
                yeniden başlatın, sorun sürerse güncel sürümü yeniden kurun.
              </p>
              <ul className="text-[10px] font-mono text-bad/80 mt-1.5 space-y-0.5 break-all">
                {schema.failures.map((f) => (
                  <li key={f.step}>
                    {f.step}: {f.message}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {schema.failures.length === 0 && schema.repaired.length > 0 && (
          <div className="p-3 rounded-card border border-ok/30 bg-ok-soft text-[11px] text-ok leading-relaxed">
            Eksik veritabanı bölümleri onarıldı: {schema.repaired.join(", ")}.
          </div>
        )}

        {triggerError && (
          <div className="p-4 rounded-card border-2 border-amber-300 dark:border-amber-500/40 bg-warn-soft flex gap-3">
            <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-warn">Denetim kaydı devre dışı</h3>
              <p className="text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80 mt-1 leading-relaxed">
                Değişiklik kayıtları tutulamıyor, bu yüzden «Geri Al» özelliği güvenilir değil.
                Uygulamayı yeniden başlatmayı deneyin.
              </p>
              <p className="text-[10px] font-mono text-amber-700/70 dark:text-amber-300/70 mt-1.5 break-all">
                {triggerError}
              </p>
            </div>
          </div>
        )}

        {(periodError || !periodLoaded) && (
          <div className="p-4 rounded-card border-2 border-bad/40 bg-bad-soft flex gap-3">
            <AlertTriangle className="w-5 h-5 text-bad shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-bad">Dönem kilidi verisi okunamadı</h3>
              <p className="text-[11px] font-medium text-bad/90 mt-1 leading-relaxed">
                Kapatılmış dönemlerin listesi yüklenemediği için dönem kilidi güvenli tarafta kapalı
                tutuluyor: <strong>hiçbir puantaj, ücret veya ödeme kaydedemezsiniz.</strong> Sorun
                kendiliğinden çözülürse bu uyarı kaybolur; çözülmezse uygulamayı yeniden başlatın.
              </p>
              {periodError && (
                <p className="text-[10px] font-mono text-bad/80 mt-1.5 break-all">{periodError}</p>
              )}
            </div>
          </div>
        )}

        {journalWarning && (
          <div className="p-4 rounded-card border-2 border-amber-300 dark:border-amber-500/40 bg-warn-soft flex gap-3">
            <AlertTriangle className="w-5 h-5 text-warn shrink-0 mt-0.5" />
            <div className="min-w-0">
              <h3 className="text-[13px] font-medium text-warn">Veritabanı günlük modu kapalı</h3>
              <p className="text-[11px] font-medium text-amber-700/80 dark:text-amber-300/80 mt-1 leading-relaxed">
                Veritabanı WAL (günlük) moduna geçemedi. Kayıtlarınız yine de saklanır, ancak ani
                kapanma veya pil bitmesi verinin son durumda bozulmasına yol açabilir. Düzenli yedek
                almanız önerilir.
              </p>
              <p className="text-[10px] font-mono text-amber-700/70 dark:text-amber-300/70 mt-1.5 break-all">
                {journalWarning}
              </p>
            </div>
          </div>
        )}
        <div className="space-y-4">
          <h2 className="text-[11px] font-medium text-muted-foreground ml-1 flex items-center gap-1.5">
            <Palette className="w-3.5 h-3.5" /> Görünüm & Arayüz
          </h2>

          {/* Tema paleti seçici */}
          <div className="grid grid-cols-4 gap-2">
            {PALETTES.map((p) => {
              const isActive = themePalette === p.id;
              const preview = PALETTE_PREVIEW[p.id];
              const isDarkPalette = themeMode === "dark";
              return (
                <button
                  key={p.id}
                  onClick={() => setPalette(p.id)}
                  aria-pressed={isActive}
                  className={`tap-target flex flex-col items-center gap-1.5 p-2 rounded-control border-2 transition-all active:scale-95 ${
                    isActive
                      ? "border-primary bg-primary/5 shadow-sm"
                      : "border-transparent hover:border-border hover:bg-muted/30"
                  }`}
                  title={p.desc}
                >
                  <div
                    className="w-full h-10 rounded-lg flex items-center justify-center gap-0.5 border shadow-sm"
                    style={{
                      background: isDarkPalette ? "#1a1a1a" : preview.bg,
                    }}
                  >
                    <div
                      className="w-3 h-3 rounded-full"
                      style={{ backgroundColor: preview.primary }}
                    />
                    <div
                      className="w-3 h-3 rounded-sm opacity-40"
                      style={{ backgroundColor: preview.primary }}
                    />
                  </div>
                  <span
                    className={`text-[11px] font-medium ${
                      isActive ? "text-primary" : "text-muted-foreground"
                    }`}
                  >
                    {p.label}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Açık / Koyu / Sistem toggle */}
          <div className="p-1.5 rounded-card border-2 bg-card flex items-center shadow-sm">
            <button
              onClick={() => themeMode === "dark" && toggleMode()}
              aria-pressed={themeMode === "light"}
              className={`flex-1 h-12 rounded-control flex items-center justify-center gap-2 font-bold text-xs transition-all ${
                themeMode === "light"
                  ? "bg-background shadow-md border text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sun className={`w-4 h-4 ${themeMode === "light" ? "text-warn" : ""}`} /> Açık
            </button>
            <button
              onClick={() => themeMode === "light" && toggleMode()}
              aria-pressed={themeMode === "dark"}
              className={`flex-1 h-12 rounded-control flex items-center justify-center gap-2 font-bold text-xs transition-all ${
                themeMode === "dark"
                  ? "bg-background shadow-md border text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Moon className={`w-4 h-4 ${themeMode === "dark" ? "text-blue-400" : ""}`} /> Koyu
            </button>
          </div>
        </div>

        {/* Sistem */}
        <div className="space-y-4">
          <h2 className="text-[11px] font-medium text-muted-foreground ml-1 flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Sistem
          </h2>
          <Button
            variant="outline"
            className="w-full h-18 rounded-card justify-start px-5 font-bold gap-4 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
            onClick={onNavigateLogs}
          >
            <History className="w-7 h-7 text-primary" />
            <div className="text-left">
              <div className="text-[14px] font-semibold">Sistem Geçmişi</div>
              <div className="text-[10px] text-muted-foreground font-bold tracking-wide mt-0.5">
                Tüm değişiklikler, geri alma dahil
              </div>
            </div>
          </Button>

          <LockSetupWizard />
        </div>

        <ReminderSection />

        <PeriodLockSection />

        <BackupSection />
        <CsvExportSection />

        <div className="space-y-4 pt-6 border-t border-dashed">
          <div className="flex flex-col items-center justify-center gap-2 opacity-60">
            <div className="w-12 h-12 rounded-card bg-muted flex items-center justify-center">
              <Smartphone className="w-6 h-6" />
            </div>
            <div className="text-center">
              <h3 className="text-[13px] font-medium  ">İş Takip Mobile</h3>
              <p className="text-[10px] font-bold mt-0.5">Versiyon {APP_VERSION}</p>
            </div>
            <p className="text-[10px] mt-2 font-bold  ">
              © {new Date().getFullYear()} Tüm Hakları Saklıdır.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
