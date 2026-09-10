// Error monitoring configuration
// To enable Sentry, set VITE_SENTRY_DSN environment variable

export const errorMonitoring = {
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  environment: import.meta.env.MODE || "development",
  tracesSampleRate: import.meta.env.MODE === "production" ? 0.1 : 1.0,
};

// Initialize error monitoring (call this in main.tsx)
export function initErrorMonitoring() {
  if (!errorMonitoring.enabled) {
    console.log("[ErrorMonitoring] Disabled - set VITE_SENTRY_DSN to enable");
    return;
  }

  // Dynamic import to avoid bundling Sentry when not needed
  import("@sentry/react").then((Sentry) => {
    Sentry.init({
      dsn: errorMonitoring.dsn,
      environment: errorMonitoring.environment,
      tracesSampleRate: errorMonitoring.tracesSampleRate,
      integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
      replaysSessionSampleRate: 0.1,
      replaysOnErrorSampleRate: 1.0,
    });
    console.log("[ErrorMonitoring] Initialized");
  });
}

// Manual error reporting
export function reportError(error: Error, context?: Record<string, unknown>) {
  if (!errorMonitoring.enabled) return;

  import("@sentry/react").then((Sentry) => {
    Sentry.withScope((scope) => {
      if (context) {
        Object.entries(context).forEach(([key, value]) => {
          scope.setExtra(key, value);
        });
      }
      Sentry.captureException(error);
    });
  });
}

// Manual breadcrumb for important events
export function addBreadcrumb(message: string, category: string = "action") {
  if (!errorMonitoring.enabled) return;

  import("@sentry/react").then((Sentry) => {
    Sentry.addBreadcrumb({
      message,
      category,
      level: "info",
    });
  });
}
