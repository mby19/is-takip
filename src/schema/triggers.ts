/**
 * Denetim (audit) tetikleyicileri.
 *
 * Format: JSON (`json_object`). Eski kayıtlar pipe-delimited `anahtar=değer`
 * biçiminde kalmaya devam eder; `parseLogData` her iki formatı da tanır.
 * JSON'a geçişin sebebi: çalışan adında `|`, `=`, `:` veya `,` geçtiğinde eski
 * format ayrıştırmayı ve dolayısıyla "Geri Al" işlemini bozuyordu.
 *
 * Tanımların sürümü. Değiştirdiğinizde bu sayıyı artırın — `db.ts` yalnızca
 * sürüm değiştiğinde tetikleyicileri yeniden kurar.
 */
export const TRIGGER_SCHEMA_VERSION = 2;

export const DROP_TRIGGERS = [
  "DROP TRIGGER IF EXISTS attendance_insert_log;",
  "DROP TRIGGER IF EXISTS attendance_update_log;",
  "DROP TRIGGER IF EXISTS attendance_delete_log;",
  "DROP TRIGGER IF EXISTS daily_metrics_insert_log;",
  "DROP TRIGGER IF EXISTS daily_metrics_update_log;",
  "DROP TRIGGER IF EXISTS daily_metrics_delete_log;",
  "DROP TRIGGER IF EXISTS payments_insert_log;",
  "DROP TRIGGER IF EXISTS payments_update_log;",
  "DROP TRIGGER IF EXISTS payments_delete_log;",
  "DROP TRIGGER IF EXISTS workers_insert_log;",
  "DROP TRIGGER IF EXISTS workers_update_log;",
  "DROP TRIGGER IF EXISTS workers_delete_log;",
];

/** O güne ait tüm personelin durumunu JSON dizisi olarak toplayan alt sorgu. */
const attsSnapshot = (dateExpr: string) => `
      (SELECT json_group_array(json_object(
          'id', w.id,
          'name', w.name,
          'status', COALESCE(a.status, 'YOK')
       ))
       FROM workers w
       LEFT JOIN attendance a ON w.id = a.worker_id AND a.date = ${dateExpr})`;

export const CREATE_WORKERS_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS workers_insert_log AFTER INSERT ON workers
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'workers', NEW.id, json_object(
      'name', NEW.name,
      'type', NEW.worker_type,
      'wage', NEW.daily_wage,
      'is_active', COALESCE(NEW.is_active, 1)
    ));
  END;
`;

export const CREATE_WORKERS_UPDATE_LOG = `
  CREATE TRIGGER IF NOT EXISTS workers_update_log AFTER UPDATE ON workers
  WHEN OLD.name <> NEW.name OR OLD.daily_wage <> NEW.daily_wage OR OLD.worker_type <> NEW.worker_type OR OLD.is_active <> NEW.is_active
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'workers', NEW.id,
      json_object('name', OLD.name, 'type', OLD.worker_type, 'wage', OLD.daily_wage, 'is_active', COALESCE(OLD.is_active, 1)),
      json_object('name', NEW.name, 'type', NEW.worker_type, 'wage', NEW.daily_wage, 'is_active', COALESCE(NEW.is_active, 1))
    );
  END;
`;

export const CREATE_WORKERS_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS workers_delete_log AFTER DELETE ON workers
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'workers', OLD.id,
      json_object('name', OLD.name, 'type', OLD.worker_type, 'wage', OLD.daily_wage, 'is_active', COALESCE(OLD.is_active, 1))
    );
  END;
`;

export const CREATE_ATTENDANCE_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS attendance_insert_log AFTER INSERT ON attendance
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'attendance', NEW.id, json_object(
      'worker_id', NEW.worker_id,
      'worker_name', COALESCE((SELECT name FROM workers WHERE id = NEW.worker_id), 'Bilinmeyen'),
      'date', NEW.date,
      'status', NEW.status
    ));
  END;
`;

export const CREATE_ATTENDANCE_UPDATE_LOG = `
  CREATE TRIGGER IF NOT EXISTS attendance_update_log AFTER UPDATE ON attendance
  WHEN OLD.status <> NEW.status
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'attendance', NEW.id,
      json_object('worker_id', OLD.worker_id, 'worker_name', COALESCE((SELECT name FROM workers WHERE id = OLD.worker_id), 'Bilinmeyen'), 'date', OLD.date, 'status', OLD.status),
      json_object('worker_id', NEW.worker_id, 'worker_name', COALESCE((SELECT name FROM workers WHERE id = NEW.worker_id), 'Bilinmeyen'), 'date', NEW.date, 'status', NEW.status)
    );
  END;
`;

export const CREATE_ATTENDANCE_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS attendance_delete_log AFTER DELETE ON attendance
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'attendance', OLD.id,
      json_object('worker_id', OLD.worker_id, 'worker_name', COALESCE((SELECT name FROM workers WHERE id = OLD.worker_id), 'Bilinmeyen'), 'date', OLD.date, 'status', OLD.status)
    );
  END;
`;

export const CREATE_DAILY_METRICS_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS daily_metrics_insert_log AFTER INSERT ON daily_metrics
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'daily_metrics', NEW.id, json_object(
      'date', NEW.date,
      'production', COALESCE(NEW.production_amount, 0),
      'earned', COALESCE(NEW.total_earned, 0),
      'expenses', COALESCE(NEW.extra_expenses, 0),
      'holiday', COALESCE(NEW.is_holiday, 0),
      'atts', ${attsSnapshot("NEW.date")}
    ));
  END;
`;

export const CREATE_DAILY_METRICS_UPDATE_LOG = `
  CREATE TRIGGER IF NOT EXISTS daily_metrics_update_log AFTER UPDATE ON daily_metrics
  WHEN OLD.production_amount <> NEW.production_amount
    OR OLD.total_earned <> NEW.total_earned
    OR OLD.extra_expenses <> NEW.extra_expenses
    OR OLD.is_holiday <> NEW.is_holiday
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'daily_metrics', NEW.id,
      json_object(
        'date', OLD.date,
        'production', COALESCE(OLD.production_amount, 0),
        'earned', COALESCE(OLD.total_earned, 0),
        'expenses', COALESCE(OLD.extra_expenses, 0),
        'holiday', COALESCE(OLD.is_holiday, 0),
        'atts', ${attsSnapshot("OLD.date")}
      ),
      json_object(
        'date', NEW.date,
        'production', COALESCE(NEW.production_amount, 0),
        'earned', COALESCE(NEW.total_earned, 0),
        'expenses', COALESCE(NEW.extra_expenses, 0),
        'holiday', COALESCE(NEW.is_holiday, 0),
        'atts', ${attsSnapshot("NEW.date")}
      )
    );
  END;
`;

export const CREATE_DAILY_METRICS_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS daily_metrics_delete_log AFTER DELETE ON daily_metrics
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'daily_metrics', OLD.id, json_object(
      'date', OLD.date,
      'production', COALESCE(OLD.production_amount, 0),
      'earned', COALESCE(OLD.total_earned, 0),
      'expenses', COALESCE(OLD.extra_expenses, 0),
      'holiday', COALESCE(OLD.is_holiday, 0)
    ));
  END;
`;

export const CREATE_PAYMENTS_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS payments_insert_log AFTER INSERT ON payments
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'payments', NEW.id, json_object(
      'worker_id', NEW.worker_id,
      'worker_name', COALESCE((SELECT name FROM workers WHERE id = NEW.worker_id), 'Bilinmeyen'),
      'amount', NEW.amount,
      'date', NEW.date,
      'description', COALESCE(NEW.description, '')
    ));
  END;
`;

export const CREATE_PAYMENTS_UPDATE_LOG = `
  CREATE TRIGGER IF NOT EXISTS payments_update_log AFTER UPDATE ON payments
  WHEN OLD.amount <> NEW.amount OR OLD.date <> NEW.date OR COALESCE(OLD.description, '') <> COALESCE(NEW.description, '')
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'payments', NEW.id,
      json_object('worker_id', OLD.worker_id, 'worker_name', COALESCE((SELECT name FROM workers WHERE id = OLD.worker_id), 'Bilinmeyen'), 'amount', OLD.amount, 'date', OLD.date, 'description', COALESCE(OLD.description, '')),
      json_object('worker_id', NEW.worker_id, 'worker_name', COALESCE((SELECT name FROM workers WHERE id = NEW.worker_id), 'Bilinmeyen'), 'amount', NEW.amount, 'date', NEW.date, 'description', COALESCE(NEW.description, ''))
    );
  END;
`;

export const CREATE_PAYMENTS_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS payments_delete_log AFTER DELETE ON payments
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'payments', OLD.id, json_object(
      'worker_id', OLD.worker_id,
      'worker_name', COALESCE((SELECT name FROM workers WHERE id = OLD.worker_id), 'Bilinmeyen'),
      'amount', OLD.amount,
      'date', OLD.date,
      'description', COALESCE(OLD.description, '')
    ));
  END;
`;

/** Kurulum sırası: `db.ts` ve `backup.ts` bu listeyi kullanır. */
export const CREATE_TRIGGERS = [
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
];
