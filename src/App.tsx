import { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { CalendarScreen } from "./components/CalendarScreen";
import { WorkersScreen } from "./components/WorkersScreen";
import { DayDetailSheet } from "./components/DayDetailSheet";
import { AppLockOverlay } from "./components/AppLockOverlay";
import { ToastContainer } from "./components/ToastContainer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { OfflineIndicator } from "./components/OfflineIndicator";
import { getDb } from "./lib/db";
import { isLockEnabled } from "./lib/appLock";
import { reportError } from "./lib/errorMonitoring";
import { pruneAuditLogs } from "./lib/retention";
import { Button } from "./components/ui/button";
import { useWorkerStore } from "./stores/workerStore";
import { usePeriodStore } from "./stores/periodStore";
import { useThemeStore } from "./stores/themeStore";
import { useToastStore } from "./stores/toastStore";
import { Users, CalendarDays, Settings, ClipboardList, Scale } from "lucide-react";
import type { Worker } from "./types";

// Ağır ekranlar yalnızca açıldıklarında yüklenir — açılış süresi ve paket boyutu düşer.
const WorkerDetailView = lazy(() =>
  import("./components/WorkerDetailView").then((m) => ({ default: m.WorkerDetailView })),
);
const AuditLogView = lazy(() =>
  import("./components/AuditLogView").then((m) => ({ default: m.AuditLogView })),
);
const SettingsView = lazy(() =>
  import("./components/SettingsView").then((m) => ({ default: m.SettingsView })),
);
const MonthSummaryScreen = lazy(() =>
  import("./components/MonthSummaryScreen").then((m) => ({ default: m.MonthSummaryScreen })),
);

const LoadingSpinner = () => (
  <div className="flex-1 flex items-center justify-center">
    <div className="w-8 h-8 border-2 border-primary/20 border-t-primary rounded-full animate-spin" />
  </div>
);

function App() {
  type Screen =
    | { kind: "calendar" }
    | { kind: "workers" }
    | { kind: "summary" }
    | { kind: "settings" }
    | { kind: "logs" }
    | { kind: "worker-detail"; worker: Worker };

  const [navStack, setNavStack] = useState<Screen[]>([{ kind: "calendar" }]);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [dbReady, setDbReady] = useState(false);
  const [dbError, setDbError] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(() => !isLockEnabled());

  const currentScreen = navStack[navStack.length - 1];
  const isRootScreen = navStack.length === 1;

  /** Kök ekranda arka arkaya iki geri basış çıkış anlamına gelir. */
  const exitTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const goBack = useCallback(() => {
    setNavStack((prev) => {
      // Alt ekrandayken geri: sadece bir üste dön, çıkış uyarısı gösterme.
      if (prev.length > 1) return prev.slice(0, -1);

      // Kök ekrandayız. İkinci basışta çık.
      if (exitTimerRef.current) {
        clearTimeout(exitTimerRef.current);
        exitTimerRef.current = undefined;
        void (async () => {
          try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            await getCurrentWindow().close();
          } catch {
            window.close();
          }
        })();
        return prev;
      }

      useToastStore.getState().addToast("Çıkmak için tekrar geri tuşuna basın", "info");
      exitTimerRef.current = setTimeout(() => {
        exitTimerRef.current = undefined;
      }, 3000);
      return prev;
    });
  }, []);

  const switchTab = useCallback((kind: "calendar" | "workers" | "summary" | "settings") => {
    setNavStack([{ kind }]);
  }, []);

  const navigateTo = useCallback((screen: Screen) => {
    setNavStack((prev) => [...prev, screen]);
  }, []);

  // Global geri hareketi: Escape + popstate (dokunmatik/kaydırma jesti)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (selectedDate) return; // dialog kendi Escape'ini yönetiyor
        e.preventDefault();
        goBack();
      }
    };
    const handlePopState = () => {
      window.history.pushState(null, "", window.location.href);
      if (selectedDate) {
        setSelectedDate(null);
        return;
      }
      goBack();
    };
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
  const fetchRateHistory = useWorkerStore((s) => s.fetchRateHistory);
  const fetchClosedPeriods = usePeriodStore((s) => s.fetchClosedPeriods);

  /**
   * Uygulama arka plana alındığında kilitler.
   * Dinleyici koşulsuz kurulur; kilidin açık olup olmadığı olay anında
   * kontrol edilir — böylece kilidi yeni açan kullanıcı için de çalışır.
   */
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden && isLockEnabled()) setIsUnlocked(false);
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  useEffect(() => {
    let isMounted = true;

    const init = async () => {
      try {
        await getDb();
        if (!isMounted) return;
        await fetchWorkers();
        await fetchRateHistory();
        await fetchClosedPeriods();
        setDbReady(true);

        // Bakım işi — açılışı bloklamaz.
        void pruneAuditLogs();
      } catch (err: unknown) {
        if (!isMounted) return;
        const message = err instanceof Error ? err.message : String(err);
        reportError(err instanceof Error ? err : new Error(message), { scope: "db-init" });
        setDbError(message);
      }
    };

    init();
    return () => {
      isMounted = false;
    };
  }, [fetchWorkers, fetchRateHistory, fetchClosedPeriods]);

  if (dbError) {
    return (
      <div className="flex flex-col items-center justify-center h-screen w-screen bg-background p-6 text-center">
        <div className="w-20 h-20 rounded-3xl bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center mb-6 animate-gentle-bounce">
          <span className="text-4xl">⚠️</span>
        </div>
        <div className="text-rose-600 dark:text-rose-400 font-black text-xl mb-2">
          Veritabanına Bağlanılamadı
        </div>
        <div className="text-muted-foreground font-medium mb-8 max-w-xs text-sm leading-relaxed break-words">
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
        <div
          className="w-full max-w-md bg-background h-screen relative flex flex-col overflow-hidden"
          aria-hidden={!isUnlocked}
          inert={!isUnlocked ? true : undefined}
        >
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
                    case "summary":
                      return (
                        <MonthSummaryScreen
                          key="summary"
                          onWorkerClick={(w) => navigateTo({ kind: "worker-detail", worker: w })}
                        />
                      );
                    case "workers":
                      return (
                        <WorkersScreen
                          key="workers"
                          onWorkerClick={(w) => navigateTo({ kind: "worker-detail", worker: w })}
                        />
                      );
                    default:
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

          {isRootScreen && (
            <nav
              className="fixed bottom-0 w-full max-w-md bg-card/90 backdrop-blur-md border-t px-4 pb-safe-nav pt-2 flex justify-around items-center z-50"
              role="navigation"
              aria-label="Ana menü"
            >
              {[
                { id: "calendar" as const, icon: CalendarDays, label: "Takvim" },
                { id: "workers" as const, icon: Users, label: "Kişiler" },
                { id: "summary" as const, icon: Scale, label: "Ay Sonu" },
                { id: "settings" as const, icon: Settings, label: "Ayarlar" },
              ].map((item) => {
                const isActive = currentScreen.kind === item.id;
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    className={`flex flex-col items-center gap-0.5 py-2 px-3.5 rounded-xl transition-all active:scale-90 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                    onClick={() => switchTab(item.id)}
                    aria-label={item.label}
                    aria-current={isActive ? "page" : undefined}
                  >
                    <Icon className={`w-5 h-5 ${isActive ? "" : "opacity-60"}`} />
                    <span
                      className={`text-[10px] font-bold uppercase ${isActive ? "opacity-100" : "opacity-60"}`}
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

          <ToastContainer />
        </div>
      </main>
    </>
  );
}

export default App;
