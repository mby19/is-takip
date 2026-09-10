import { useState } from "react";
import { createPortal } from "react-dom";
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
  Bell,
  Check,
  AlertTriangle,
  X,
} from "lucide-react";
import { Button } from "./ui/button";
import { BackupSection } from "./BackupSection";
import { LockSetupWizard } from "./LockSetupWizard";
import { NotificationDialog } from "./NotificationDialog";

const PALETTES: { id: ThemePalette; label: string; desc: string }[] = [
  { id: "ocean", label: "Okyanus", desc: "Sakin mavi, sıcak zemin" },
  { id: "forest", label: "Orman", desc: "Doğal yeşil tonları" },
  { id: "sunset", label: "Günbatımı", desc: "Sıcak amber & mercan" },
  { id: "mono", label: "Tek Renk", desc: "Yalın gri skalası" },
  { id: "midnight", label: "Gece Yarısı", desc: "Derin indigo" },
];

export function SettingsView({
  onBack,
  onNavigateLogs,
}: {
  onBack: () => void;
  onNavigateLogs: () => void;
}) {
  const [message, setMessage] = useState("");
  const [notifOpen, setNotifOpen] = useState(false);
  const themeMode = useThemeStore((s) => s.mode);
  const themePalette = useThemeStore((s) => s.palette);
  const toggleMode = useThemeStore((s) => s.toggleMode);
  const setPalette = useThemeStore((s) => s.setPalette);

  return (
    <div className="flex flex-col h-full bg-background">
      <header className="pt-14 pb-4 px-5 border-b bg-card shrink-0 flex items-center gap-3">
        <button
          onClick={onBack}
          className="w-10 h-10 rounded-xl bg-muted/60 flex items-center justify-center active:scale-90 transition-all shrink-0"
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

          {/* Tema paleti seçici */}
          <div className="grid grid-cols-5 gap-2">
            {PALETTES.map((p) => {
              const isActive = themePalette === p.id;
              const preview = PALETTE_PREVIEW[p.id];
              const isDarkPalette = themeMode === "dark";
              return (
                <button
                  key={p.id}
                  onClick={() => setPalette(p.id)}
                  className={`flex flex-col items-center gap-1.5 p-2 rounded-xl border-2 transition-all active:scale-95 ${
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
                    className={`text-[8px] font-black uppercase tracking-wider ${
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
          <div className="p-1.5 rounded-2xl border-2 bg-card flex items-center shadow-sm">
            <button
              onClick={() => themeMode === "dark" && toggleMode()}
              className={`flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all ${
                themeMode === "light"
                  ? "bg-background shadow-md border text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Sun className={`w-4 h-4 ${themeMode === "light" ? "text-amber-500" : ""}`} /> Açık
            </button>
            <button
              onClick={() => themeMode === "light" && toggleMode()}
              className={`flex-1 h-12 rounded-xl flex items-center justify-center gap-2 font-bold text-xs transition-all ${
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
          <h2 className="text-[10px] font-black uppercase tracking-widest text-muted-foreground ml-1 flex items-center gap-1.5">
            <Settings className="w-3.5 h-3.5" /> Sistem
          </h2>
          <Button
            variant="outline"
            className="w-full h-18 rounded-2xl justify-start px-5 font-bold gap-4 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all"
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

          <LockSetupWizard onMessage={setMessage} />

          <Button
            variant="outline"
            onClick={() => setNotifOpen(true)}
            className="w-full h-16 rounded-2xl justify-start px-5 font-bold gap-4 border-2 hover:border-primary/50 hover:bg-primary/5 transition-all active:scale-[0.98]"
          >
            <Bell className="w-6 h-6 text-primary" />
            <div className="text-left">
              <div className="text-sm font-black">Bildirimler</div>
              <div className="text-[10px] text-muted-foreground font-bold tracking-wide mt-0.5">
                Son işlem kayıtlarını görüntüle
              </div>
            </div>
          </Button>

          <NotificationDialog isOpen={notifOpen} onClose={() => setNotifOpen(false)} />
        </div>

        <BackupSection onMessage={setMessage} />

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

      {message &&
        createPortal(
          <div
            className={`fixed bottom-6 left-4 right-4 z-9999 p-4 rounded-2xl bg-card/95 backdrop-blur-md border shadow-2xl flex items-start gap-3 animate-in slide-in-from-bottom duration-300 ${
              message.startsWith("Hata") ? "border-rose-500/30" : "border-emerald-500/30"
            }`}
          >
            <div
              className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${
                message.startsWith("Hata") ? "bg-rose-500/10" : "bg-emerald-500/10"
              }`}
            >
              {message.startsWith("Hata") ? (
                <AlertTriangle className="w-5 h-5 text-rose-500" />
              ) : (
                <Check className="w-5 h-5 text-emerald-500" />
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
                {message.startsWith("Hata") ? "İşlem Başarısız" : "Başarılı"}
              </h4>
              <p className="text-[10px] font-bold text-muted-foreground mt-0.5 leading-relaxed break-all select-all">
                {message.startsWith("Hata") ? message.replace("Hata: ", "") : message}
              </p>
            </div>
            <button
              onClick={() => setMessage("")}
              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-muted active:scale-90 transition-all shrink-0"
              aria-label="Kapat"
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
