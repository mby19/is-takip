import { useState, useEffect, useCallback, useRef } from "react";
import { CalendarView } from "./components/CalendarView";
import { DayDetailSheet } from "./components/DayDetailSheet";
import { WorkerDetailView } from "./components/WorkerDetailView";
import { AuditLogView } from "./components/AuditLogView";
import { SettingsView } from "./components/SettingsView";
import { SpinWheelDialog } from "./components/SpinWheelDialog";
import { AppLockOverlay } from "./components/AppLockOverlay";
import { ToastContainer } from "./components/ToastContainer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { getDb } from "./lib/db";
import { Button } from "./components/ui/button";
import { useWorkerStore } from "./stores/workerStore";
import { useToastStore } from "./stores/toastStore";
import {
  Users,
  CalendarDays,
  UserPlus,
  HardHat,
  Handshake,
  Moon,
  Sun,
  Settings,
  ClipboardList,
} from "lucide-react";
import type { Worker } from "./types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "./components/ui/dialog";
import { Input } from "./components/ui/input";
import { Label } from "./components/ui/label";

function App() {
  type Screen =
    | { kind: "calendar" }
    | { kind: "workers" }
    | { kind: "settings" }
    | { kind: "logs" }
    | { kind: "worker-detail"; worker: Worker };

  const [navStack, setNavStack] = useState<Screen[]>([{ kind: "calendar" }]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(() => {
    return localStorage.getItem("appLockEnabled") !== "true";
  });

  const currentScreen = navStack[navStack.length - 1];
  const isRootScreen = navStack.length === 1;

  /** Her geri basış: stack'ten pop + timer başlat. Timer aktifken basarsa çık. */
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const goBack = useCallback(() => {
    setNavStack((prev) => {
      // Exit timer aktifken geri basılırsa → çıkış
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = undefined;
        window.close();
        return prev;
      }

      // Normal geri: stack'ten pop + exit timer'ı başlat
      const next = prev.length <= 1 ? prev : prev.slice(0, -1);
      useToastStore.getState().addToast("Çıkmak için tekrar geri tuşuna basın", "info");
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = undefined;
      }, 3000);
      return next;
    });
  }, []);

  const switchTab = useCallback((kind: "calendar" | "workers" | "settings") => {
    setNavStack([{ kind }]);
  }, []);

  const navigateTo = useCallback((screen: Screen) => {
    setNavStack((prev) => [...prev, screen]);
  }, []);

  // Global back handler: Escape + popstate (macOS swipe gesture)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedDate) return; // dialog handles its own Escape
        e.preventDefault();
        goBack();
      }
    };
    const handlePopState = () => {
      // Prevent back gesture from exiting the app
      window.history.pushState(null, "", window.location.href);
      if (selectedDate) {
        setSelectedDate(null);
        return;
      }
      goBack();
    };
    // Seed so popstate can fire
    window.history.pushState(null, "", window.location.href);

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("popstate", handlePopState);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("popstate", handlePopState);
    };
  }, [selectedDate, goBack]);

  const [theme, setTheme] = useState<"light" | "dark">(
    () => (localStorage.getItem("theme") as "light" | "dark") || "dark",
  );

  useEffect(() => {
    const root = window.document.documentElement;
    if (theme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
    localStorage.setItem("theme", theme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((t) => (t === "light" ? "dark" : "light"));
  };

  const workers = useWorkerStore((s) => s.workers);
  const workerError = useWorkerStore((s) => s.error);
  const addWorker = useWorkerStore((s) => s.addWorker);
  const fetchWorkers = useWorkerStore((s) => s.fetchWorkers);

  // App Lock: lock on visibility change
  useEffect(() => {
    const isLockEnabled = localStorage.getItem("appLockEnabled") === "true";
    if (!isLockEnabled) return;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        setIsUnlocked(false);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let isMounted = true;
    console.log("Initializing database...");

    const init = async () => {
      try {
        await getDb();
        console.log("Database connection established");

        if (isMounted) {
          await fetchWorkers();
          setDbReady(true);
        }
      } catch (err: unknown) {
        console.error("BOOT FATAL:", err);
        if (isMounted) {
          setDbError(typeof err === "object" ? JSON.stringify(err) : String(err));
        }
      }
    };

    init();
    return () => {
      isMounted = false;
    };
  }, [fetchWorkers]);

  if (dbError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-background p-6 text-center">
        <div className="w-20 h-20 rounded-3xl bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center mb-6 animate-gentle-bounce">
          <span className="text-4xl">⚠️</span>
        </div>
        <div className="text-rose-600 dark:text-rose-400 font-black text-xl mb-2">
          Bağlantı Hatası
        </div>
        <div className="text-muted-foreground font-medium mb-8 max-w-xs text-sm leading-relaxed">
          {dbError}
        </div>
        <Button
          onClick={() => window.location.reload()}
          variant="default"
          className="rounded-2xl h-14 font-black w-full max-w-xs shadow-lg shadow-primary/20"
        >
          Yeniden Dene
        </Button>
      </div>
    );
  }

  if (!dbReady) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-background gap-6">
        <div className="w-16 h-16 rounded-2xl bg-primary/10 flex items-center justify-center animate-float">
          <ClipboardList className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <div className="text-primary font-black text-lg tracking-tight">İş Takip</div>
          <div className="text-muted-foreground text-xs font-medium tracking-widest uppercase">
            Hazırlanıyor...
          </div>
        </div>
        <div className="w-24 h-1 bg-muted rounded-full overflow-hidden">
          <div className="w-1/2 h-full bg-primary rounded-full animate-[shimmer_1.5s_infinite]" />
        </div>
      </div>
    );
  }

  return (
    <>
      <ToastContainer />
      <main className="h-screen w-screen bg-background text-foreground flex flex-col items-center overflow-hidden selection:bg-primary/20">
        {!isUnlocked && <AppLockOverlay onUnlock={() => setIsUnlocked(true)} />}
        <div className="w-full max-w-md bg-background h-screen relative flex flex-col overflow-hidden">
          {/* Navigasyon İçeriği */}
          <ErrorBoundary>
            <div className="flex-1 flex flex-col overflow-hidden">
              {(() => {
                const screen = currentScreen;
                switch (screen.kind) {
                  case "worker-detail":
                    return (
                      <div
                        key="worker-detail"
                        className="flex-1 flex flex-col overflow-hidden animate-scale-in"
                      >
                        <WorkerDetailView worker={screen.worker} onBack={goBack} />
                      </div>
                    );
                  case "logs":
                    return (
                      <div
                        key="logs"
                        className="flex-1 flex flex-col overflow-hidden animate-scale-in"
                      >
                        <AuditLogView onBack={goBack} />
                      </div>
                    );
                  case "settings":
                    return (
                      <div
                        key="settings"
                        className="flex-1 flex flex-col overflow-hidden animate-scale-in"
                      >
                        <SettingsView
                          onBack={goBack}
                          onNavigateLogs={() => navigateTo({ kind: "logs" })}
                          theme={theme}
                          toggleTheme={toggleTheme}
                        />
                      </div>
                    );
                  case "workers":
                    return (
                      <div
                        key="workers"
                        className="flex flex-col h-full overflow-hidden animate-scale-in"
                      >
                        <header className="pt-14 pb-4 px-5 bg-card border-b flex-shrink-0 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                              <Users className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <h1 className="text-lg font-black tracking-tight">Ekip</h1>
                              <p className="text-[9px] font-bold text-muted-foreground tracking-wider uppercase">
                                Sahada kim var?
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <SpinWheelDialog />
                            <button
                              onClick={toggleTheme}
                              className="w-10 h-10 rounded-xl bg-muted/40 hover:bg-muted flex items-center justify-center transition-all active:scale-95"
                            >
                              {theme === "dark" ? (
                                <Sun className="w-5 h-5 text-amber-400" />
                              ) : (
                                <Moon className="w-5 h-5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </header>
                        <div className="flex-1 overflow-y-auto no-scrollbar p-4 space-y-2.5 pb-28">
                          {workerError && (
                            <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-500/10 border border-rose-100 dark:border-rose-500/20 text-rose-600 dark:text-rose-400 text-xs font-bold animate-slide-up">
                              Hata: {workerError}
                            </div>
                          )}
                          <div className="stagger-children space-y-3">
                            {workers.map((w: Worker) => (
                              <div
                                key={w.id}
                                onClick={() => navigateTo({ kind: "worker-detail", worker: w })}
                                className="p-3.5 rounded-xl border bg-card flex justify-between items-center active:scale-[0.98] transition-all cursor-pointer group"
                              >
                                <div className="flex items-center gap-3">
                                  <div
                                    className={`w-9 h-9 rounded-lg flex items-center justify-center font-bold text-sm transition-transform group-active:scale-90 ${w.worker_type === "ORTAK" ? "bg-amber-100 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400" : "bg-blue-100 text-blue-700 dark:bg-blue-500/20 dark:text-blue-400"}`}
                                  >
                                    {w.worker_type === "ORTAK" ? (
                                      <Handshake className="w-4 h-4" />
                                    ) : (
                                      <HardHat className="w-4 h-4" />
                                    )}
                                  </div>
                                  <div>
                                    <p className="font-bold text-sm tracking-tight">{w.name}</p>
                                    <p
                                      className={`text-[9px] uppercase tracking-wider font-bold ${w.worker_type === "ORTAK" ? "text-amber-600 dark:text-amber-500" : "text-primary"}`}
                                    >
                                      {w.worker_type === "ORTAK" ? "Ortak" : "Yevmiyeli"}
                                    </p>
                                  </div>
                                </div>
                                {w.worker_type === "GUNLUK" && (
                                  <div className="text-right">
                                    <div className="text-primary font-black text-lg">
                                      ₺{w.daily_wage}
                                    </div>
                                    <div className="text-[8px] uppercase text-muted-foreground font-bold tracking-widest">
                                      Yevmiye
                                    </div>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                          <AddWorkerDialog onAdd={addWorker} />
                        </div>
                      </div>
                    );
                  default: // calendar
                    return (
                      <div
                        key="calendar"
                        className="flex flex-col h-full overflow-hidden animate-scale-in"
                      >
                        <header className="pt-14 pb-4 px-5 border-b bg-card flex-shrink-0 flex justify-between items-center">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center">
                              <ClipboardList className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                              <h1 className="text-lg font-black tracking-tight">İş Takip</h1>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <SpinWheelDialog />
                            <button
                              onClick={toggleTheme}
                              className="w-10 h-10 rounded-xl bg-muted/40 hover:bg-muted flex items-center justify-center transition-all active:scale-95"
                            >
                              {theme === "dark" ? (
                                <Sun className="w-5 h-5 text-amber-400" />
                              ) : (
                                <Moon className="w-5 h-5 text-muted-foreground" />
                              )}
                            </button>
                          </div>
                        </header>
                        <div className="mt-0 flex-1 min-h-0 flex flex-col overflow-hidden relative">
                          <CalendarView
                            onDayClick={(date) => setSelectedDate(date)}
                            onWorkerClick={(worker) =>
                              navigateTo({ kind: "worker-detail", worker })
                            }
                          />
                        </div>
                      </div>
                    );
                }
              })()}
            </div>
          </ErrorBoundary>

          {/* Alt Navigasyon Barı */}
          {isRootScreen && (
            <nav className="fixed bottom-0 w-full max-w-md bg-card/90 backdrop-blur-md border-t px-4 pb-6 pt-2 flex justify-around items-center z-50">
              {[
                { id: "calendar" as const, icon: CalendarDays, label: "Takvim" },
                { id: "workers" as const, icon: Users, label: "Kişiler" },
                { id: "settings" as const, icon: Settings, label: "Ayarlar" },
              ].map((item) => {
                const isActive = currentScreen.kind === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={`flex flex-col items-center gap-0.5 py-2 px-5 rounded-xl transition-all active:scale-90 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    onClick={() => switchTab(item.id)}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? "" : "opacity-60"}`} />
                    <span
                      className={`text-[9px] font-bold uppercase ${isActive ? "opacity-100" : "opacity-50"}`}
                    >
                      {item.label}
                    </span>
                    {isActive && <div className="w-4 h-0.5 rounded-full bg-primary mt-0.5" />}
                  </button>
                );
              })}
            </nav>
          )}

          <DayDetailSheet
            isOpen={!!selectedDate}
            dateStr={selectedDate}
            onClose={() => setSelectedDate(null)}
          />
        </div>
      </main>
    </>
  );
}

function AddWorkerDialog({
  onAdd,
}: {
  onAdd: (name: string, daily_wage: number, worker_type: "ORTAK" | "GUNLUK") => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [wage, setWage] = useState("600");
  const [type, setType] = useState<"GUNLUK" | "ORTAK">("GUNLUK");

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          className="w-full rounded-2xl border-dashed border-2 h-16 text-base font-bold gap-2 hover:bg-primary/5 hover:border-primary/30 hover:text-primary transition-all duration-300 active:scale-95"
        >
          <UserPlus className="w-5 h-5" /> Yeni Kişi Ekle
        </Button>
      </DialogTrigger>
      <DialogContent className="rounded-3xl border-none shadow-2xl">
        <DialogHeader>
          <DialogTitle className="text-xl font-black">Yeni Kişi Ekle</DialogTitle>
        </DialogHeader>
        <div className="space-y-5 py-4">
          <div className="space-y-2">
            <Label
              htmlFor="name"
              className="text-xs font-black uppercase tracking-widest opacity-60"
            >
              İsim Soyisim
            </Label>
            <Input
              id="name"
              placeholder="Örn: Ahmet Yılmaz"
              className="h-13 rounded-xl border-2 border-transparent bg-muted/50 font-bold text-base focus:border-primary focus:bg-background transition-all"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-xs font-black uppercase tracking-widest opacity-60">
              Çalışan Türü
            </Label>
            <div className="flex gap-3">
              <button
                className={`flex-1 p-4 rounded-xl border-2 transition-all duration-300 flex flex-col items-center gap-2 active:scale-95 ${
                  type === "GUNLUK"
                    ? "border-blue-500 bg-blue-50 shadow-md shadow-blue-500/10"
                    : "border-muted bg-muted/30 hover:border-muted-foreground/20"
                }`}
                onClick={() => setType("GUNLUK")}
              >
                <HardHat
                  className={`w-6 h-6 ${type === "GUNLUK" ? "text-blue-600" : "text-muted-foreground"}`}
                />
                <span
                  className={`text-xs font-black uppercase ${type === "GUNLUK" ? "text-blue-600" : "text-muted-foreground"}`}
                >
                  Yevmiyeli
                </span>
              </button>
              <button
                className={`flex-1 p-4 rounded-xl border-2 transition-all duration-300 flex flex-col items-center gap-2 active:scale-95 ${
                  type === "ORTAK"
                    ? "border-amber-500 bg-amber-50 shadow-md shadow-amber-500/10"
                    : "border-muted bg-muted/30 hover:border-muted-foreground/20"
                }`}
                onClick={() => setType("ORTAK")}
              >
                <Handshake
                  className={`w-6 h-6 ${type === "ORTAK" ? "text-amber-600" : "text-muted-foreground"}`}
                />
                <span
                  className={`text-xs font-black uppercase ${type === "ORTAK" ? "text-amber-600" : "text-muted-foreground"}`}
                >
                  Ortak
                </span>
              </button>
            </div>
          </div>
          {type === "GUNLUK" && (
            <div className="space-y-2 animate-slide-up">
              <Label
                htmlFor="wage"
                className="text-xs font-black uppercase tracking-widest opacity-60"
              >
                Günlük Yevmiye (₺)
              </Label>
              <Input
                id="wage"
                type="number"
                className="h-13 rounded-xl border-2 border-transparent bg-muted/50 font-bold text-base focus:border-primary focus:bg-background transition-all"
                value={wage}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setWage(e.target.value)}
              />
            </div>
          )}
        </div>
        <DialogFooter>
          <Button
            onClick={async () => {
              if (!name.trim()) return;
              const finalWage = type === "ORTAK" ? 0 : parseFloat(wage);
              await onAdd(name, finalWage, type);
              setOpen(false);
              setName("");
            }}
            className="w-full h-13 rounded-2xl font-black shadow-lg shadow-primary/20 transition-all active:scale-95"
          >
            Kaydet
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default App;
