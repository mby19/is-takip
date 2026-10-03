// Error monitoring configuration
// To enable Sentry, set VITE_SENTRY_DSN environment variable
import { APP_VERSION } from "./appInfo";

export const errorMonitoring = {
  enabled: !!import.meta.env.VITE_SENTRY_DSN,
  dsn: import.meta.env.VITE_SENTRY_DSN || "",
  environment: import.meta.env.MODE || "development",
  tracesSampleRate: import.meta.env.MODE === "production" ? 0.1 : 1.0,
};

/**
 * Telemetriye giden düz metinlerdeki hassas değerleri maskeleyen desenler.
 *
 * Sentry replay'i DOM metnini toplar; bu uygulamada `WorkerDetailView`
 * ekranında personel adı, yevmiye, ödeme tutarı ve bakiye görünür. Replay
 * `maskAllText` ile toplamı maskelendiği için bu desenler, *replay
 * dışındaki* kanallarda (transaction, breadcrumb, event extras) kalan
 * düz metinler için son savunma hattıdır.
 *
 * Bilinçli olarak dar tutuldu: her büyük harfli kelimeyi isim saymak
 * `Maske`, `Kaydet`, `Özet` gibi sıradan UI metinlerini de silerdi.
 */
const SENSITIVE_PATTERNS: RegExp[] = [
  // Para: 12.500,00 TL / ₺1.250 / 1 250,00₺ / 45.00
  /(?:₺|TL)\s?[\d.,]+|[\d][\d.\s]*[,.]\d{2}(?:\s?(?:TL|₺))?/gi,
  // 11 haneli T.C. kimlik numarası
  /\b\d{11}\b/g,
  // IBAN (TR + 24 hane; desen TR + 2 haneli banka kodu + 22 haneli hesap)
  /\bTR\d{2}[A-Z0-9]{22}\b/gi,
  // Telefon: 05xx xxx xx xx / +90 5xx ...
  /\b(?:\+90|0)?5\d{2}[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g,
];

/**
 * Hassas değerleri sabit bir token ile değiştirir. Eşleşme yoksa metin
 * olduğu gibi döner — genel UI metinleri (`Kaydet`, `Devam durumu`)
 * telemetry'den geçmeye devam eder.
 */
export function maskSensitiveText(value: string): string {
  let masked = value;
  for (const pattern of SENSITIVE_PATTERNS) {
    masked = masked.replace(pattern, "[masked]");
  }
  return masked;
}

/** Nesne ağacındaki tüm düz metinleri maskeler (derinlik sınırlı, döngüsel yapıya dayanıklı). */
function maskValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return maskSensitiveText(value);
  if (value === null || typeof value !== "object") return value;
  if (depth >= 4) return value;
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => maskValue(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = maskValue(item, depth + 1, seen);
  }
  return out;
}

type SentryEventLike = {
  request?: { url?: string; query_string?: unknown; data?: unknown };
  breadcrumbs?: { message?: string; data?: unknown }[];
  extra?: Record<string, unknown>;
  contexts?: Record<string, unknown>;
  transaction?: string;
  /**
   * `captureException` ile giden hatanın metni BURADA durur, `message`
   * alanında değil. Bu alan maskelenmeden önce hata mesajındaki tutar, TC
   * kimlik no ve telefon numarası Sentry'ye olduğu gibi gidiyordu.
   */
  exception?: {
    values?: { type?: string; value?: string }[];
  };
  message?: string;
};

/**
 * `beforeSend` / `beforeSendTransaction`: event ve transaction gövdesindeki
 * düz metinleri maskeler. Sentry'ye giden her yolda çalışır.
 */
export function maskEvent(event: SentryEventLike): SentryEventLike {
  const out: SentryEventLike = { ...event };

  if (typeof out.transaction === "string") out.transaction = maskSensitiveText(out.transaction);
  if (typeof out.message === "string") out.message = maskSensitiveText(out.message);

  if (out.exception?.values) {
    out.exception = {
      ...out.exception,
      values: out.exception.values.map((v) => ({
        ...v,
        // `type` hata sınıfı adıdır (`TypeError`, `SQLiteError`); onu da
        // maskelemek hata ayıklamayı bozar, yalnız `value` (mesaj) maskelenir.
        ...(typeof v.value === "string" ? { value: maskSensitiveText(v.value) } : {}),
      })),
    };
  }

  if (out.request) {
    out.request = maskValue(out.request) as SentryEventLike["request"];
  }
  if (out.extra) out.extra = maskValue(out.extra) as Record<string, unknown>;
  if (out.contexts) out.contexts = maskValue(out.contexts) as Record<string, unknown>;
  if (out.breadcrumbs) {
    out.breadcrumbs = out.breadcrumbs.map((crumb) => ({
      ...crumb,
      ...(typeof crumb.message === "string" ? { message: maskSensitiveText(crumb.message) } : {}),
      ...(crumb.data ? { data: maskValue(crumb.data) } : {}),
    }));
  }

  return out;
}

/** Ağ hatası Sentry'yi kendi hatasına dönüştürmesin. */
function reportMonitoringFailure(stage: string, error: unknown) {
  console.error(`[ErrorMonitoring] ${stage} failed: ${describe(error)}`);
}

/** Initialize error monitoring (call this in main.tsx) */
export function initErrorMonitoring() {
  if (!errorMonitoring.enabled) {
    console.log("[ErrorMonitoring] Disabled - set VITE_SENTRY_DSN to enable");
    return;
  }

  // Dynamic import to avoid bundling Sentry when not needed
  import("@sentry/react")
    .then((Sentry) => {
      Sentry.init({
        dsn: errorMonitoring.dsn,
        environment: errorMonitoring.environment,
        // Hangi sürümde olduğu bilinmeden hata okunmuyor (SE2)
        release: `is-takip@${APP_VERSION}`,
        tracesSampleRate: errorMonitoring.tracesSampleRate,
        // Kullanıcı verisi (IP, header) istemeden gönderilmesin
        sendDefaultPii: false,
        integrations: [
          Sentry.browserTracingIntegration(),
          Sentry.replayIntegration({
            // Personel adı, yevmiye, ücret ve bakiye ekranda görünür:
            // DOM metninin tamamı maskelenir, görsel/görüntü hiç gönderilmez.
            maskAllText: true,
            blockAllMedia: true,
          }),
        ],
        replaysSessionSampleRate: 0,
        beforeSend: (event) =>
          maskEvent(event as unknown as SentryEventLike) as unknown as typeof event,
        beforeSendTransaction: (transaction) =>
          maskEvent(transaction as unknown as SentryEventLike) as unknown as typeof transaction,
      });
      console.log("[ErrorMonitoring] Initialized");
    })
    .catch((error) => reportMonitoringFailure("init", error));
}

/**
 * Konsola tek satır olarak yazılabilen özet. Nesneler `[object Object]` olarak
 * düşmesin diye ayrı tutuldu — cihaz logunda okunabilen tek iz bu.
 */
const describe = (error: unknown): string => {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
};

// Manual error reporting
export function reportError(error: Error, context?: Record<string, unknown>) {
  // Sentry kapalıyken hata tamamen kayboluyordu; en azından konsola düşsün —
  // cihazdan `adb logcat` ile okunabilen tek iz bu.
  if (!errorMonitoring.enabled) {
    console.error(`[reportError] ${describe(error)} ${JSON.stringify(context ?? {})}`);
    return;
  }

  import("@sentry/react")
    .then((Sentry) => {
      Sentry.withScope((scope) => {
        if (context) {
          Object.entries(context).forEach(([key, value]) => {
            // Extra'ya düz metin girmeden önce maskele (para, kimlik no, telefon)
            scope.setExtra(key, typeof value === "string" ? maskSensitiveText(value) : value);
          });
        }
        Sentry.captureException(error);
      });
    })
    .catch((importError) => reportMonitoringFailure("captureException", importError));
}

// Manual breadcrumb for important events
export function addBreadcrumb(message: string, category: string = "action") {
  if (!errorMonitoring.enabled) return;

  import("@sentry/react")
    .then((Sentry) => {
      Sentry.addBreadcrumb({
        message: maskSensitiveText(message),
        category,
        level: "info",
      });
    })
    .catch((error) => reportMonitoringFailure("addBreadcrumb", error));
}
