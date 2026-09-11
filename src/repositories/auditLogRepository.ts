import { fetchQuery, executeQuery } from "../lib/db";
import type { AuditLog, AuditActionType } from "../types";

export const auditLogRepository = {
  findAll: (limit = 200): Promise<AuditLog[]> =>
    fetchQuery<AuditLog>("SELECT * FROM audit_logs ORDER BY created_at DESC, id DESC LIMIT ?", [
      limit,
    ]),

  /** Geri alınan kayıt silinmez, işaretlenir — denetim izi korunur. */
  markReverted: (id: number) =>
    executeQuery(
      "UPDATE audit_logs SET reverted_at = DATETIME('now', 'localtime') WHERE id = ? AND reverted_at IS NULL",
      [id],
    ),

  write: (
    action_type: AuditActionType,
    entity_table: string,
    record_id: number,
    new_data: string | null,
    old_data: string | null = null,
  ) =>
    executeQuery(
      "INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data) VALUES (?, ?, ?, ?, ?)",
      [action_type, entity_table, record_id, old_data, new_data],
    ),
};
