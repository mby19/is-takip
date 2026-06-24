import { fetchQuery, executeQuery } from "../lib/db";
import type { AuditLog } from "../types";

export const auditLogRepository = {
  findAll: (): Promise<AuditLog[]> =>
    fetchQuery<AuditLog>("SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 200"),

  findById: (id: number): Promise<AuditLog[]> =>
    fetchQuery<AuditLog>("SELECT * FROM audit_logs WHERE id = ?", [id]),

  removeById: (id: number) => executeQuery("DELETE FROM audit_logs WHERE id = ?", [id]),
};
