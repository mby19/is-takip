export interface Worker {
  id: number;
  name: string;
  daily_wage: number;
  worker_type: "ORTAK" | "GUNLUK";
  created_at: string;
  is_active: boolean;
}

export interface Attendance {
  id: number;
  worker_id: number;
  date: string; // YYYY-MM-DD
  status: "FULL" | "HALF" | "ABSENT" | "HOLIDAY";
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

export interface AuditLog {
  id: number;
  action_type: "INSERT" | "UPDATE" | "DELETE";
  entity_table: string;
  record_id: number;
  old_data: string | null;
  new_data: string | null;
  created_at: string;
}
