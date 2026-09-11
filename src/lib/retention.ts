import { executeQuery, fetchQuery } from "./db";
import { reportError } from "./errorMonitoring";

/** Denetim kayıtlarının saklanma süresi (ay). */
export const AUDIT_RETENTION_MONTHS = 12;

/** Yaşına bakılmaksızın her zaman korunan en yeni kayıt sayısı. */
const ALWAYS_KEEP = 500;

/**
 * Eski denetim kayıtlarını budar.
 *
 * `audit_logs` hiç temizlenmiyordu; her gün girişi birkaç satır ekliyor ve
 * yedek dosyası bunların tamamını taşıyordu. Yıllar içinde hem veritabanı hem
 * yedekler gereksiz büyüyor.
 *
 * İki koruma var: 12 aydan yeni kayıtlar ve — uygulama uzun süre
 * kullanılmadıysa hepsi birden silinmesin diye — en yeni 500 kayıt.
 * Açılışta bir kez, sessizce çalışır; başarısız olursa uygulama etkilenmez.
 */
export async function pruneAuditLogs(): Promise<number> {
  try {
    const before = await fetchQuery<{ n: number }>("SELECT COUNT(*) AS n FROM audit_logs");

    const result = await executeQuery(
      `DELETE FROM audit_logs
       WHERE created_at < DATETIME('now', 'localtime', ?)
         AND id NOT IN (SELECT id FROM audit_logs ORDER BY id DESC LIMIT ?)`,
      [`-${AUDIT_RETENTION_MONTHS} months`, ALWAYS_KEEP],
    );

    const removed = result.rowsAffected ?? 0;
    if (removed > 0) {
      console.info(`[Retention] ${removed} eski denetim kaydı budandı (önce: ${before[0]?.n}).`);
    }
    return removed;
  } catch (err: unknown) {
    // Budama bir bakım işi; başarısız olması uygulamanın açılmasını engellemez.
    reportError(err instanceof Error ? err : new Error(String(err)), { scope: "pruneAuditLogs" });
    return 0;
  }
}
