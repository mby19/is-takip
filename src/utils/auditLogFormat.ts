import type { AuditLog, AttendanceStatus } from "../types";
import { parseLogData, parseAttendanceSnapshot } from "./parseLogData";
import { formatMoney } from "../lib/utils";

export type AuditTone = "ok" | "warn" | "bad" | "info" | "neutral";

export type AuditKind =
  | "attendance"
  | "metrics"
  | "payment"
  | "worker"
  | "period"
  | "backup"
  | "revert"
  | "other";

export interface AuditDetail {
  label: string;
  value: string;
  /** Önceki değer — varsa üstü çizili gösterilir. */
  was?: string;
  tone?: AuditTone;
}

export interface AuditEntryView {
  kind: AuditKind;
  /** Ana satır: ne olduğu. */
  title: string;
  /** İkinci satır: hangi güne/kişiye ait. */
  subtitle?: string;
  tone: AuditTone;
  details: AuditDetail[];
  /** Bu kayıt geri alınabilir mi (dönem kilidi ayrıca kontrol edilir). */
  revertable: boolean;
}

const STATUS_LABEL: Record<string, string> = {
  FULL: "Tam gün",
  HALF: "Yarım gün",
  ABSENT: "Gelmedi",
  HOLIDAY: "İzinli",
  YOK: "Kayıt yok",
};

const STATUS_TONE: Record<string, AuditTone> = {
  FULL: "ok",
  HALF: "warn",
  ABSENT: "bad",
  HOLIDAY: "info",
};

export const statusLabel = (s?: string | null): string =>
  (s && STATUS_LABEL[s]) || s || "Kayıt yok";

export const statusTone = (s?: string | null): AuditTone => (s && STATUS_TONE[s]) || "neutral";

const MONTHS = [
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

/** `2026-09-03` → `3 Eylül 2026`. Ayrıştırılamayanı olduğu gibi döndürür. */
export function formatLogDate(value?: string | null): string {
  if (!value) return "";
  const [y, m, d] = String(value).split("-");
  const index = parseInt(m, 10) - 1;
  if (!y || Number.isNaN(index) || !MONTHS[index]) return value;
  return `${parseInt(d, 10)} ${MONTHS[index]} ${y}`;
}

/**
 * Geri alınabilir tablolar — TEK KAYNAK.
 *
 * Hem ekranda "Geri Al" düğmesinin görünüp görünmeyeceğini, hem de
 * `revertStrategies`'ın güvenlik kontrolünü belirler. İki ayrı kopya
 * tutulduğunda tablo eklendiğinde biri unutuluyor ve düğme hiç görünmese
 * bile kayıt geri alınabiliyor ya da tam tersi.
 *
 * Import yönü: `revertStrategies` → `auditLogFormat` (tek yönlü; döngüsel
 * import yok). `auditLogFormat` bir saf görüntü katmanı olduğu için liste
 * burada durur.
 */
export const REVERTABLE_TABLES: readonly string[] = [
  "attendance",
  "daily_metrics",
  "payments",
  "worker_rate_history",
  "workers",
];
const REVERTABLE_ACTIONS = ["INSERT", "UPDATE", "DELETE"];

/**
 * Denetim kaydını ekranda gösterilecek hâle çevirir.
 *
 * Saf fonksiyon: JSX üretmez, yalnızca veri. Böylece mesaj mantığı bileşenden
 * bağımsız test edilebilir — eskiden 200 satırlık iç içe koşullar bileşenin
 * içindeydi ve hiçbiri test edilmiyordu.
 *
 * @param resolveWorkerName id'den güncel ismi bulur; bulunamazsa log içindeki
 *        isim kullanılır (çalışan silinmiş olabilir).
 */
export function describeAuditLog(
  log: AuditLog,
  resolveWorkerName: (id: number) => string | undefined = () => undefined,
): AuditEntryView {
  const nd = parseLogData(log.new_data);
  const od = parseLogData(log.old_data);
  const data = nd ?? od ?? {};

  const workerId = Number(nd?.worker_id ?? od?.worker_id);
  const workerName =
    (Number.isFinite(workerId) ? resolveWorkerName(workerId) : undefined) ??
    nd?.worker_name ??
    od?.worker_name ??
    nd?.name ??
    od?.name ??
    "Bilinmeyen";

  const revertable =
    REVERTABLE_TABLES.includes(log.entity_table) && REVERTABLE_ACTIONS.includes(log.action_type);

  // --- Geri alma kaydının kendisi ---
  if (log.action_type === "REVERT") {
    return {
      kind: "revert",
      title: "Bir işlem geri alındı",
      subtitle: data.entity_table ? `${data.entity_table} kaydı` : undefined,
      tone: "info",
      details: [],
      revertable: false,
    };
  }

  // --- Dönem kilidi ---
  if (log.entity_table === "closed_periods") {
    const label = data.label || data.period || "";
    const closing = log.action_type === "CLOSE_PERIOD";
    return {
      kind: "period",
      title: closing ? "Dönem kapatıldı" : "Dönem yeniden açıldı",
      subtitle: label,
      tone: closing ? "info" : "warn",
      details: [],
      revertable: false,
    };
  }

  // --- Yedekleme ---
  if (log.entity_table === "backup") {
    const map: Record<string, { title: string; tone: AuditTone }> = {
      EXPORT: { title: "Yedek alındı", tone: "ok" },
      IMPORT: { title: "Yedekten geri yüklendi", tone: "warn" },
      DELETE_FILE: { title: "Yedek dosyası silindi", tone: "bad" },
    };
    const entry = map[log.action_type] ?? {
      title: "Yedekleme işlemi",
      tone: "neutral" as AuditTone,
    };
    return {
      kind: "backup",
      title: entry.title,
      subtitle: data.file,
      tone: entry.tone,
      details: data.workers ? [{ label: "Çalışan", value: String(data.workers) }] : [],
      revertable: false,
    };
  }

  // --- Puantaj ---
  if (log.entity_table === "attendance") {
    const to = nd?.status;
    const from = od?.status;
    const date = nd?.date ?? od?.date;

    let title: string;
    let tone: AuditTone;
    if (log.action_type === "DELETE") {
      title = `${workerName} · kayıt silindi`;
      tone = "neutral";
    } else if (from && to && from !== to) {
      title = `${workerName} · ${statusLabel(to)}`;
      tone = statusTone(to);
    } else {
      title = `${workerName} · ${statusLabel(to ?? from)}`;
      tone = statusTone(to ?? from);
    }

    return {
      kind: "attendance",
      title,
      subtitle: formatLogDate(date),
      tone,
      details:
        from && to && from !== to
          ? [
              {
                label: "Durum",
                value: statusLabel(to),
                was: statusLabel(from),
                tone: statusTone(to),
              },
            ]
          : [],
      revertable,
    };
  }

  // --- Ödeme ---
  if (log.entity_table === "payments") {
    const amount = nd?.amount ?? od?.amount;
    const date = nd?.date ?? od?.date;
    const description = nd?.description || od?.description;

    const verb =
      log.action_type === "INSERT"
        ? "ödeme yapıldı"
        : log.action_type === "DELETE"
          ? "ödeme silindi"
          : "ödeme güncellendi";

    const details: AuditDetail[] = [];
    if (log.action_type === "UPDATE" && od?.amount !== nd?.amount) {
      details.push({
        label: "Tutar",
        value: formatMoney(nd?.amount),
        was: formatMoney(od?.amount),
      });
    }
    if (description) details.push({ label: "Açıklama", value: description });

    return {
      kind: "payment",
      title: `${workerName} · ${formatMoney(amount)} ${verb}`,
      subtitle: formatLogDate(date),
      tone: log.action_type === "DELETE" ? "bad" : "neutral",
      details,
      revertable,
    };
  }

  // --- Çalışan ---
  if (log.entity_table === "workers") {
    const name = nd?.name ?? od?.name ?? workerName;
    const type = (nd?.type ?? od?.type) === "ORTAK" ? "Ortak" : "Yevmiyeli";

    if (log.action_type === "INSERT") {
      return {
        kind: "worker",
        title: `${name} eklendi`,
        subtitle: type,
        tone: "ok",
        details: nd?.wage ? [{ label: "Yevmiye", value: formatMoney(nd.wage) }] : [],
        revertable,
      };
    }
    if (log.action_type === "DELETE") {
      return {
        kind: "worker",
        title: `${name} silindi`,
        subtitle: type,
        tone: "bad",
        details: [],
        revertable,
      };
    }

    const details: AuditDetail[] = [];
    if (od?.name !== nd?.name)
      details.push({ label: "İsim", value: nd?.name ?? "", was: od?.name });
    if (od?.wage !== nd?.wage)
      details.push({ label: "Yevmiye", value: formatMoney(nd?.wage), was: formatMoney(od?.wage) });
    if (od?.type !== nd?.type)
      details.push({
        label: "Tip",
        value: nd?.type === "ORTAK" ? "Ortak" : "Yevmiyeli",
        was: od?.type === "ORTAK" ? "Ortak" : "Yevmiyeli",
      });
    if (od?.is_active !== nd?.is_active)
      details.push({
        label: "Durum",
        value: nd?.is_active === "1" ? "Aktif" : "Arşivde",
        was: od?.is_active === "1" ? "Aktif" : "Arşivde",
      });

    return {
      kind: "worker",
      title: `${name} güncellendi`,
      subtitle: details.map((d) => d.label).join(", ") || undefined,
      tone: "warn",
      details,
      revertable,
    };
  }

  // --- Gün verisi ---
  if (log.entity_table === "daily_metrics") {
    const date = nd?.date ?? od?.date;
    const details: AuditDetail[] = [];

    const num = (v?: string) => (v === undefined ? undefined : Number(v));
    const changed = (key: string) => od && nd && od[key] !== nd[key];

    if (!od || changed("production"))
      details.push({
        label: "Üretim",
        value: `${num(nd?.production) ?? 0} palet`,
        was: od ? `${num(od.production) ?? 0} palet` : undefined,
      });
    if (!od || changed("earned"))
      details.push({
        label: "Ciro",
        value: formatMoney(nd?.earned),
        was: od ? formatMoney(od.earned) : undefined,
      });
    if (!od || changed("expenses"))
      details.push({
        label: "Gider",
        value: formatMoney(nd?.expenses),
        was: od ? formatMoney(od.expenses) : undefined,
      });

    // Puantaj anlık görüntüsündeki değişiklikler
    const before = new Map(parseAttendanceSnapshot(od?.atts).map((e) => [e.id, e]));
    for (const entry of parseAttendanceSnapshot(nd?.atts)) {
      const prev = before.get(entry.id)?.status ?? "YOK";
      if (prev !== entry.status) {
        details.push({
          label: entry.name,
          value: statusLabel(entry.status),
          was: statusLabel(prev),
          tone: statusTone(entry.status as AttendanceStatus),
        });
      }
    }

    const attendanceChanges = details.filter((d) => d.tone).length;
    const summary =
      log.action_type === "DELETE"
        ? "Gün verisi silindi"
        : log.action_type === "INSERT"
          ? "Gün verisi girildi"
          : attendanceChanges > 0
            ? `Gün güncellendi · ${attendanceChanges} kişide değişiklik`
            : "Gün verisi güncellendi";

    return {
      kind: "metrics",
      title: summary,
      subtitle: formatLogDate(date),
      tone: log.action_type === "DELETE" ? "bad" : "neutral",
      details,
      revertable,
    };
  }

  // --- Ücret geçmişi ---
  // Hesaplama `worker_rate_history` kaydını tercih eder; bu yüzden denetim
  // izinde görünmezse ekranda gösterilen ücret ile ödenen ücret ayrışır.
  if (log.entity_table === "worker_rate_history") {
    const validFrom = od?.valid_from ?? nd?.valid_from;
    const verb =
      log.action_type === "INSERT"
        ? "ücret kaydı eklendi"
        : log.action_type === "DELETE"
          ? "ücret kaydı silindi"
          : "ücret güncellendi";

    const details: AuditDetail[] = [];
    if (log.action_type !== "INSERT") {
      details.push({
        label: "Geçerli olduğu tarih",
        value: formatLogDate(validFrom) || "—",
        tone: "neutral",
      });
    }
    if (od?.wage !== nd?.wage) {
      details.push({ label: "Yevmiye", value: formatMoney(nd?.wage), was: formatMoney(od?.wage) });
    }
    if (od?.type !== nd?.type && (od?.type || nd?.type)) {
      details.push({
        label: "Tip",
        value: nd?.type === "ORTAK" ? "Ortak" : "Yevmiyeli",
        was: od?.type === "ORTAK" ? "Ortak" : "Yevmiyeli",
      });
    }

    return {
      kind: "worker",
      title: `${workerName} · ${verb}`,
      subtitle: log.action_type === "INSERT" ? formatLogDate(validFrom) : undefined,
      tone: log.action_type === "DELETE" ? "bad" : "warn",
      details,
      revertable,
    };
  }

  return {
    kind: "other",
    title: `${log.entity_table} · ${log.action_type}`,
    tone: "neutral",
    details: [],
    revertable: false,
  };
}

/** Kayıtları gün başlıklarına böler; "Bugün" / "Dün" özel adlandırılır. */
export function groupLogsByDay(logs: readonly AuditLog[]): { label: string; logs: AuditLog[] }[] {
  const today = new Date();
  const dayKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  const todayKey = dayKey(today);
  const yesterdayKey = dayKey(new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1));

  const groups: { label: string; logs: AuditLog[] }[] = [];
  let currentKey = "";

  for (const log of logs) {
    const key = String(log.created_at ?? "").slice(0, 10);
    if (key !== currentKey) {
      currentKey = key;
      const label =
        key === todayKey
          ? "Bugün"
          : key === yesterdayKey
            ? "Dün"
            : formatLogDate(key) || "Bilinmeyen";
      groups.push({ label, logs: [] });
    }
    groups[groups.length - 1].logs.push(log);
  }

  return groups;
}

/** `2026-09-11 20:40:12` → `20:40` */
export const formatLogTime = (createdAt: string): string => {
  const match = String(createdAt).match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : "";
};
