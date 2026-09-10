import { useState, useEffect, useCallback, useRef, Suspense } from "react";
import { CalendarScreen } from "./components/CalendarScreen";
import { WorkersScreen } from "./components/WorkersScreen";
import { DayDetailSheet } from "./components/DayDetailSheet";
import { WorkerDetailView } from "./components/WorkerDetailView";
import { AuditLogView } from "./components/AuditLogView";
import { SettingsView } from "./components/SettingsView";
import { AppLockOverlay } from "./components/AppLockOverlay";
import { ToastContainer } from "./components/ToastContainer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { getDb } from "./lib/db";
import { Button } from "./components/ui/button";
import { useWorkerStore } from "./stores/workerStore";
import { useThemeStore } from "./stores/themeStore";
import { useToastStore } from "./stores/toastStore";
import { Users, CalendarDays, Settings, ClipboardList } from "lucide-react";
import type { Worker } from "./types";

const LoadingSpinner = () => (
  <div className="flex-1 flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

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

  const themeMode = useThemeStore((s) => s.mode);
  const themePalette = useThemeStore((s) => s.palette);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("dark", themeMode === "dark");
    root.setAttribute("data-palette", themePalette);
  }, [themeMode, themePalette]);

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

    const init = async () => {
      try {
        await getDb();

        if (isMounted) {
          await fetchWorkers();
          setDbReady(true);
        }
      } catch (err: unknown) {
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
      <OfflineIndicator />
      <main className="h-screen w-screen bg-background text-foreground flex flex-col items-center overflow-hidden selection:bg-primary/20">
        {!isUnlocked && <AppLockOverlay onUnlock={() => setIsUnlocked(true)} />}
        <div className="w-full max-w-md bg-background h-screen relative flex flex-col overflow-hidden">
          {/* Navigasyon İçeriği */}
          <ErrorBoundary>
            <Suspense fallback={<LoadingSpinner />}>
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
                          />
                        </div>
                      );
                    case "workers":
                      return (
                        <WorkersScreen
                          key="workers"
                          onWorkerClick={(w) => navigateTo({ kind: "worker-detail", worker: w })}
                        />
                      );
                    default: // calendar
                      return (
                        <CalendarScreen
                          key="calendar"
                          onDayClick={(date) => setSelectedDate(date)}
                          onWorkerClick={(worker) => navigateTo({ kind: "worker-detail", worker })}
                        />
                      );
                  }
                })()}
              </div>
            </Suspense>
          </ErrorBoundary>

          {/* Alt Navigasyon Barı */}
          {isRootScreen && (
            <nav
              className="fixed bottom-0 w-full max-w-md bg-card/90 backdrop-blur-md border-t px-4 pb-6 pt-2 flex justify-around items-center z-50"
              role="navigation"
              aria-label="Ana menü"
            >
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
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
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

          {/* Toast — nav bar'ın hemen üstünde, backdrop-blur'un önünde */}
          <ToastContainer />
        </div>
      </main>
    </>
  );
}

export default App;
