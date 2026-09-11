export type WorkerType = "ORTAK" | "GUNLUK";

export type AttendanceStatus = "FULL" | "HALF" | "ABSENT" | "HOLIDAY";

export interface Worker {
  id: number;
  name: string;
  /** Güncel yevmiye. Geçmiş hesaplar için `worker_rate_history` kullanılır. */
  daily_wage: number;
  /** Güncel tip. Geçmiş hesaplar için `worker_rate_history` kullanılır. */
  worker_type: WorkerType;
  created_at: string;
  is_active: boolean;
  /** Tabloda ayırt etmek için seçilen renk anahtarı. Boşsa id'den türetilir. */
  color?: string | null;
  /** Tabloda gösterilen kısa etiket. Boşsa baş harflerden üretilir. */
  short_label?: string | null;
}

/**
 * Tarih etkili ücret/tip kaydı. Bir çalışanın yevmiyesi değiştiğinde geçmiş
 * aylar yeniden hesaplanmasın diye tutulur.
 */
export interface WorkerRate {
  id: number;
  worker_id: number;
  /** YYYY-MM-DD — bu tarihten itibaren geçerli. */
  valid_from: string;
  daily_wage: number;
  worker_type: WorkerType;
  created_at?: string;
}

export interface Attendance {
  id: number;
  worker_id: number;
  date: string; // YYYY-MM-DD
  status: AttendanceStatus;
}

export interface DailyMetric {
  id: number;
  date: string; // YYYY-MM-DD
  production_amount: number;
  total_earned: number;
  extra_expenses: number;
  is_holiday?: boolean;
}

export interface Payment {
  id: number;
  worker_id: number;
  amount: number;
  date: string;
  description: string;
}

export type AuditActionType =
  | "INSERT"
  | "UPDATE"
  | "DELETE"
  | "REVERT"
  | "EXPORT"
  | "IMPORT"
  | "DELETE_FILE"
  | "CLOSE_PERIOD"
  | "REOPEN_PERIOD";

export interface AuditLog {
  id: number;
  action_type: AuditActionType;
  entity_table: string;
  record_id: number;
  old_data: string | null;
  new_data: string | null;
  created_at: string;
  /** Dolu ise bu kayıt geri alınmıştır. */
  reverted_at?: string | null;
}
