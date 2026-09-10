import { fetchQuery, executeQuery } from "./db";
import {
  DROP_TRIGGERS,
  CREATE_WORKERS_INSERT_LOG,
  CREATE_WORKERS_UPDATE_LOG,
  CREATE_WORKERS_DELETE_LOG,
  CREATE_ATTENDANCE_INSERT_LOG,
  CREATE_ATTENDANCE_UPDATE_LOG,
  CREATE_ATTENDANCE_DELETE_LOG,
  CREATE_DAILY_METRICS_INSERT_LOG,
  CREATE_DAILY_METRICS_UPDATE_LOG,
  CREATE_DAILY_METRICS_DELETE_LOG,
  CREATE_PAYMENTS_INSERT_LOG,
  CREATE_PAYMENTS_UPDATE_LOG,
  CREATE_PAYMENTS_DELETE_LOG,
} from "../schema/triggers";
import { isTauri, saveTextFileToDownloads } from "./tauri";

export const exportDatabase = async () => {
  const workers = await fetchQuery("SELECT * FROM workers");
  const attendance = await fetchQuery("SELECT * FROM attendance");
  const daily_metrics = await fetchQuery("SELECT * FROM daily_metrics");
  const payments = await fetchQuery("SELECT * FROM payments");
  const audit_logs = await fetchQuery("SELECT * FROM audit_logs");

  const backup = {
    version: 1,
    exported_at: new Date().toISOString(),
    workers,
    attendance,
    daily_metrics,
    payments,
    audit_logs,
  };

  const jsonString = JSON.stringify(backup, null, 2);
  const now = new Date();
  const pad = (n: number) => n.toString().padStart(2, "0");
  const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const timeStr = `${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const fileName = `is_takip_backup_${dateStr}_${timeStr}.json`;

  try {
    if (isTauri()) {
      await saveTextFileToDownloads(fileName, jsonString);
      try {
        const { downloadDir, join } = await import("@tauri-apps/api/path");
        const downloadPath = await downloadDir();
        const fullPath = await join(downloadPath, fileName);
        return fullPath;
      } catch {
        return fileName;
      }
    } else {
      // Fallback: Tarayıcı ortamı
      const blob = new Blob([jsonString], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      return fileName;
    }
  } catch (e: unknown) {
    console.error("[Backup] Export error:", e);
    throw e;
  } finally {
    await executeQuery(
      "INSERT INTO audit_logs (action_type, entity_table, record_id, new_data) VALUES (?, ?, ?, ?)",
      ["EXPORT", "backup", 0, `file=${fileName}|exported_at=${new Date().toISOString()}`],
    );
  }
};

export const importDatabase = async (jsonString: string) => {
  const backup = JSON.parse(jsonString);

  if (!backup.workers || !backup.attendance || !backup.daily_metrics || !backup.payments) {
    throw new Error("Geçersiz yedekleme dosyası formatı.");
  }

  // Tetikleyicileri geçici olarak devre dışı bırak (import hızı için)
  for (const sql of DROP_TRIGGERS) {
    await executeQuery(sql);
  }

  try {
    // Tabloları temizle (Sıralama foreign key hatalarını önlemek için önemlidir)
    await executeQuery("DELETE FROM audit_logs;");
    await executeQuery("DELETE FROM attendance;");
    await executeQuery("DELETE FROM payments;");
    await executeQuery("DELETE FROM daily_metrics;");
    await executeQuery("DELETE FROM workers;");

    // ID'leri sıfırla
    await executeQuery(
      "DELETE FROM sqlite_sequence WHERE name IN ('workers', 'attendance', 'payments', 'daily_metrics', 'audit_logs');",
    );

    // Verileri geri yükle
    if (backup.workers?.length > 0) {
      for (const w of backup.workers) {
        await executeQuery(
          "INSERT INTO workers (id, name, daily_wage, worker_type, created_at, is_active) VALUES (?, ?, ?, ?, ?, ?)",
          [w.id, w.name, w.daily_wage, w.worker_type, w.created_at, w.is_active],
        );
      }
    }

    if (backup.attendance?.length > 0) {
      for (const a of backup.attendance) {
        await executeQuery(
          "INSERT INTO attendance (id, worker_id, date, status) VALUES (?, ?, ?, ?)",
          [a.id, a.worker_id, a.date, a.status],
        );
      }
    }

    if (backup.daily_metrics?.length > 0) {
      for (const m of backup.daily_metrics) {
        await executeQuery(
          "INSERT INTO daily_metrics (id, date, production_amount, total_earned, extra_expenses, is_holiday) VALUES (?, ?, ?, ?, ?, ?)",
          [m.id, m.date, m.production_amount, m.total_earned, m.extra_expenses, m.is_holiday],
        );
      }
    }

    if (backup.payments?.length > 0) {
      for (const p of backup.payments) {
        await executeQuery(
          "INSERT INTO payments (id, worker_id, amount, date, description) VALUES (?, ?, ?, ?, ?)",
          [p.id, p.worker_id, p.amount, p.date, p.description],
        );
      }
    }

    if (backup.audit_logs?.length > 0) {
      for (const l of backup.audit_logs) {
        await executeQuery(
          "INSERT INTO audit_logs (id, action_type, entity_table, record_id, old_data, new_data, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          [l.id, l.action_type, l.entity_table, l.record_id, l.old_data, l.new_data, l.created_at],
        );
      }
    }
  } finally {
    await executeQuery(CREATE_WORKERS_INSERT_LOG);
    await executeQuery(CREATE_WORKERS_UPDATE_LOG);
    await executeQuery(CREATE_WORKERS_DELETE_LOG);
    await executeQuery(CREATE_ATTENDANCE_INSERT_LOG);
    await executeQuery(CREATE_ATTENDANCE_UPDATE_LOG);
    await executeQuery(CREATE_ATTENDANCE_DELETE_LOG);
    await executeQuery(CREATE_DAILY_METRICS_INSERT_LOG);
    await executeQuery(CREATE_DAILY_METRICS_UPDATE_LOG);
    await executeQuery(CREATE_DAILY_METRICS_DELETE_LOG);
    await executeQuery(CREATE_PAYMENTS_INSERT_LOG);
    await executeQuery(CREATE_PAYMENTS_UPDATE_LOG);
    await executeQuery(CREATE_PAYMENTS_DELETE_LOG);

    await executeQuery(
      "INSERT INTO audit_logs (action_type, entity_table, record_id, new_data) VALUES (?, ?, ?, ?)",
      ["IMPORT", "backup", 0, `imported_at=${new Date().toISOString()}`],
    );
  }
};
