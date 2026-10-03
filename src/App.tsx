import { useState, useEffect, useCallback, useRef, Suspense, lazy } from "react";
import { CalendarScreen } from "./components/CalendarScreen";
import { WorkersScreen } from "./components/WorkersScreen";
import { DayDetailSheet } from "./components/DayDetailSheet";
import { AppLockOverlay } from "./components/AppLockOverlay";
import { ToastContainer } from "./components/ToastContainer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { ModalStackProvider, useGlobalBack, useModalStack } from "./components/modal-stack";
import { getDb } from "./lib/db";
import { isLockEnabled } from "./lib/appLock";
import { reportError } from "./lib/errorMonitoring";
import { todayKey } from "./lib/period";
import { useReminders } from "./hooks/useReminders";
import { importDatabase } from "./lib/backup";
import { Button } from "./components/ui/button";
import { useWorkerStore } from "./stores/workerStore";
import { usePeriodStore } from "./stores/periodStore";
import { useToastStore } from "./stores/toastStore";
import {
  Users,
  CalendarDays,
  Settings,
  ClipboardList,
  Scale,
  DatabaseBackup,
  Loader2,
} from "lucide-react";
import type { Worker } from "./types";
import { getCurrentWindow } from "@tauri-apps/api/window";

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

function AppShell() {
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
            await getCurrentWindow().close();
            // Pencere kapanmadıysa buraya düşülmez; `close()` çözülür.
          } catch (error) {
            // Tauri yedeği: webview'da `window.close()` çoğunlukla etkisizdir.
            try {
              window.close();
            } catch {
              /* aşağıdaki kullanıcı bildirimi bu yolun da tutmadığını söyler */
            }
            reportError(error instanceof Error ? error : new Error(String(error)), {
              scope: "close-window",
            });
            // Sessizce vazgeçmek kullanıcıya "çıkış çalışmıyor ama neden?" diye
            // soru bırakır ve her seferinde yeniden denemesini gerektirir.
            // Kapanma gerçekleşirse bu bildirim zaten görünmez.
            useToastStore
              .getState()
              .addToast(
                "Uygulama kapatılamadı. Sistem menüsünden veya Alt+F4 ile kapatmayı deneyin.",
                "error",
              );
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

  const { hasOpenModal } = useModalStack();

  const switchTab = useCallback((kind: "calendar" | "workers" | "summary" | "settings") => {
    setNavStack([{ kind }]);
  }, []);

  const navigateTo = useCallback((screen: Screen) => {
    setNavStack((prev) => [...prev, screen]);
  }, []);

  /**
   * Tek geri davranışı. Hem Escape (`useGlobalBack`) hem `popstate` BUNU
   * çağırır; iki ayrı öncelik sırası yüzünden "hangi kaynak önce geliyor"
   * belirsizliği yaşanmasın.
   *
   * Kilitliyken HİÇBİR geri yolu ekran yığınını değiştirmez. Escape için
   * `useGlobalBack(handleBack, !isUnlocked)` zaten ayrı bir karar veriyor, ama
   * `popstate` o bayrağı görmez ve doğrudan buraya gelir — guard olmadan
   * tarayıcı önizlemesinde kilit ekranı açıkken bile ekran değiştirilir,
   * kökte çıkış sayacı tetiklenir. Modal sayacı da buna yetmez: kilit ekranı
   * modal olduğu için Escape'i zaten yutuyor, `popstate`'in önünde durmaz.
   *
   * Modal açıkken geri çalışmaz: modal kendi Escape'ini kendi yönetir ve
   * uygulama ekranından da çıkılmaz (bkz. `useGlobalBack`).
   * `selectedDate` guard'ı bilinçli korunuyor — tarih seçiliyse önce o kapanır.
   *
   * KARAR (AS2): `popstate` Tauri WebView'da güvenilir biçimde tetiklenmez ve
   * masaüstü hedefinde mobil geri tuşu yok. Bu yüzden `popstate` YALNIZCA
   * tarayıcı önizlemesinde (`npm run dev`) işe yarayan bir yedek yoldur;
   * masaüstünde geri yolu Escape'tir. Mobil hedef eklenirse bu karar
   * yeniden değerlendirilmelidir.
   */
  const handleBack = useCallback(() => {
    // Kilit ekranı açıkken ekran yığınına ve çıkış sayacına dokunulmaz.
    if (!isUnlocked) return;
    // Tarayıcıda modal açıkken geri tuşu da ekrandan çıkarmamalı; Escape ile
    // aynı karar burada da geçerli olsun diye modal sayacı okunur.
    if (hasOpenModal) return;
    if (selectedDate) {
      setSelectedDate(null);
      return;
    }
    goBack();
  }, [isUnlocked, hasOpenModal, selectedDate, goBack]);

  useGlobalBack(handleBack, !isUnlocked);

  useEffect(() => {
    const handlePopState = () => {
      // Tarayıcıda her geri basışında bir geçmiş girdisi tüketilmesin diye
      // durumu yeniden sabitliyoruz.
      window.history.pushState(null, "", window.location.href);
      handleBack();
    };
    window.history.pushState(null, "", window.location.href);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [handleBack]);

  useReminders({ ready: dbReady, onOpenToday: () => setSelectedDate(todayKey()) });

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
    return <DbErrorScreen message={dbError} />;
  }

  if (!dbReady) {
    return (
      <div className="flex flex-col items-center justify-center h-dvh w-screen bg-background gap-6">
        <div className="w-16 h-16 rounded-card bg-primary/10 flex items-center justify-center animate-float">
          <ClipboardList className="w-8 h-8 text-primary" />
        </div>
        <div className="text-center space-y-2">
          <div className="text-primary font-semibold text-lg tracking-tight">İş Takip</div>
          <div className="text-muted-foreground text-xs font-medium  ">Hazırlanıyor...</div>
        </div>
        <div className="w-24 h-1 bg-muted rounded-full overflow-hidden">
          <div className="w-1/2 h-full bg-primary rounded-full animate-[shimmer_1.5s_infinite]" />
        </div>
      </div>
    );
  }

  return (
    <>
      {/*
        "İçeriğe atla": klavyeyle gelen kullanıcının alt gezinme ve ekran
        başlığı bloklarını Tab'layarak geçmesini sağlar. DOM'da `main`'den
        ÖNCE gelir, bu yüzden ilk Tab durağıdır. `sr-only` ile görünmez,
        odaklanınca `not-sr-only` ile görünür olur.
      */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-1/2 focus:-translate-x-1/2 focus:z-10000 focus:rounded-control focus:bg-card focus:px-4 focus:py-2 focus:text-sm focus:font-semibold focus:text-foreground focus:shadow-lg"
      >
        İçeriğe atla
      </a>
      <main
        id="main-content"
        tabIndex={-1}
        className="h-dvh w-screen bg-background text-foreground flex flex-col items-center overflow-hidden selection:bg-primary/20"
      >
        {!isUnlocked && <AppLockOverlay onUnlock={() => setIsUnlocked(true)} />}
        {/* Kilitliyken uygulama ağacı HİÇ mount edilmez. Yalnız `aria-hidden`/`inert`
          yetmezdi: tüm çalışan, ücret ve bakiye verisi DOM'da duruyordu. */}
        {isUnlocked && (
          <div className="w-full max-w-md bg-background h-dvh relative flex flex-col overflow-hidden">
            <ErrorBoundary
              onError={(error, errorInfo) =>
                reportError(error, {
                  scope: "render",
                  componentStack: errorInfo.componentStack ?? null,
                })
              }
            >
              <Suspense fallback={<LoadingSpinner />}>
                <div className="flex-1 flex flex-col overflow-hidden">
                  {(() => {
                    const screen = currentScreen;
                    switch (screen.kind) {
                      case "worker-detail":
                        return (
                          <div
                            key="worker-detail"
                            className="flex-1 flex flex-col overflow-hidden animate-screen-enter"
                          >
                            <WorkerDetailView worker={screen.worker} onBack={goBack} />
                          </div>
                        );
                      case "logs":
                        return (
                          <div
                            key="logs"
                            className="flex-1 flex flex-col overflow-hidden animate-screen-enter"
                          >
                            <AuditLogView onBack={goBack} />
                          </div>
                        );
                      case "settings":
                        return (
                          <div
                            key="settings"
                            className="flex-1 flex flex-col overflow-hidden animate-screen-enter"
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
                            onWorkerClick={(worker) =>
                              navigateTo({ kind: "worker-detail", worker })
                            }
                            onGoToWorkers={() => switchTab("workers")}
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
                      className={`tap-target flex flex-col items-center justify-center gap-0.5 py-2 px-3.5 rounded-control transition-all active:scale-90 ${isActive ? "text-primary" : "text-muted-foreground"}`}
                      onClick={() => switchTab(item.id)}
                      aria-label={item.label}
                      aria-current={isActive ? "page" : undefined}
                    >
                      <Icon className={`w-5 h-5 ${isActive ? "" : "opacity-60"}`} />
                      <span
                        className={`text-[10px] font-bold  ${isActive ? "opacity-100" : "opacity-60"}`}
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
        )}
      </main>
    </>
  );
}

/**
 * Veritabanı açılamadığında gösterilen ekran.
 *
 * "Yeniden Dene" tek başına bırakılırsa kalıcı bir hatada kullanıcı sonsuz
 * döngüde kalır ve verisine HİÇBİR yoldan ulaşamaz — ayarlar ekranı hiç
 * açılmadığı için yedek de alınamaz. Bu yüzden ekran iki çıkış yolu sunar:
 * yeniden deneme ve yedekten geri yükleme.
 *
 * Geri yükleme `importDatabase` üzerinden çalışır; SQL bağlantısı kurulabilen
 * durumlarda (hatanın şema/sorgu tarafı olduğu) sorunu doğrudan çözer.
 * Bağlantının hiç açılamadığı durumda hata mesajı ekranda kalır — en azından
 * kullanıcı ne yapması gerektiğini görür.
 */
function DbErrorScreen({ message }: { message: string }) {
  const [reloadCount, setReloadCount] = useState(0);
  const [restoring, setRestoring] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);

  // Üç denemeden sonra "yeniden dene" bir çözüm değil; kullanıcıyı kalıcı
  // hataya ve kurtarma yoluna yönlendir.
  const reloadDisabled = reloadCount >= 3;

  const restoreFromFile = async (file: File) => {
    setRestoring(true);
    setRestoreError(null);
    try {
      const content = await file.text();
      await importDatabase(content);
      window.location.reload();
    } catch (err: unknown) {
      setRestoreError(err instanceof Error ? err.message : String(err));
      setRestoring(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-dvh w-screen bg-background p-6 text-center overflow-y-auto">
      <div className="w-20 h-20 rounded-sheet bg-rose-100 dark:bg-rose-500/20 flex items-center justify-center mb-6">
        <DatabaseBackup className="w-9 h-9 text-bad" />
      </div>
      <div className="text-bad font-semibold text-xl mb-2">Veritabanı Açılamadı</div>
      <div className="text-muted-foreground font-medium mb-6 max-w-xs text-sm leading-relaxed break-words">
        {message}
      </div>

      {restoreError && (
        <div className="w-full max-w-xs rounded-card bg-bad-soft border border-rose-100 dark:border-rose-500/20 text-bad text-xs font-medium p-3 mb-4 break-words text-left">
          Geri yükleme başarısız: {restoreError}
        </div>
      )}

      <div className="w-full max-w-xs space-y-3">
        <Button
          onClick={() => {
            setReloadCount((c) => c + 1);
            window.location.reload();
          }}
          disabled={reloadDisabled || restoring}
          className="rounded-card h-14 font-semibold w-full shadow-lg shadow-primary/20"
        >
          {reloadDisabled ? "Yeniden Deneme Kullanılamıyor" : "Yeniden Dene"}
        </Button>

        {reloadDisabled && (
          <p className="text-muted-foreground text-xs leading-relaxed">
            Hata üç denemeden sonra da sürüyor. Verileriniz bu cihazda duruyor; aşağıdan yedek
            dosyasıyla geri yükleyebilirsiniz.
          </p>
        )}

        <label
          className={`flex items-center justify-center gap-2 rounded-card border-2 border-dashed border-border h-14 font-semibold text-sm transition-all ${
            restoring ? "opacity-50" : "hover:border-primary/40 hover:text-primary"
          } ${reloadDisabled ? "text-foreground" : "text-muted-foreground"}`}
        >
          {restoring ? (
            <>
              <Loader2 className="w-5 h-5 animate-spin" />
              Geri Yükleniyor...
            </>
          ) : (
            <>
              <DatabaseBackup className="w-5 h-5" />
              Yedekten Geri Yükle
            </>
          )}
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            disabled={restoring}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (file) void restoreFromFile(file);
            }}
          />
        </label>

        <p className="text-muted-foreground/70 text-[11px] leading-relaxed">
          Yedekler "İndirilenler" klasöründe, is_takip_backup_*.json adıyla durur.
        </p>
      </div>
    </div>
  );
}

/**
 * Modal sayacı uygulama kökünde kurulur: Escape'in ekrandan çıkmasını
 * engellemek bütün ekranların ortak kararı, tek bir bileşenin değil.
 */
function App() {
  return (
    <ModalStackProvider>
      <AppShell />
    </ModalStackProvider>
  );
}

export default App;
