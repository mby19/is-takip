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

export const CREATE_WORKERS_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS workers_insert_log AFTER INSERT ON workers
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'workers', NEW.id, 'name=' || NEW.name || '|type=' || NEW.worker_type || '|wage=' || NEW.daily_wage);
  END;
`;

export const CREATE_WORKERS_UPDATE_LOG = `
  CREATE TRIGGER IF NOT EXISTS workers_update_log AFTER UPDATE ON workers
  WHEN OLD.name <> NEW.name OR OLD.daily_wage <> NEW.daily_wage OR OLD.worker_type <> NEW.worker_type OR OLD.is_active <> NEW.is_active
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'workers', NEW.id,
        'name=' || OLD.name || '|type=' || OLD.worker_type || '|wage=' || OLD.daily_wage || '|is_active=' || OLD.is_active,
        'name=' || NEW.name || '|type=' || NEW.worker_type || '|wage=' || NEW.daily_wage || '|is_active=' || NEW.is_active
    );
  END;
`;

export const CREATE_WORKERS_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS workers_delete_log AFTER DELETE ON workers
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'workers', OLD.id,
        'name=' || OLD.name || '|type=' || OLD.worker_type || '|wage=' || OLD.daily_wage || '|is_active=' || OLD.is_active
    );
  END;
`;

export const CREATE_ATTENDANCE_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS attendance_insert_log AFTER INSERT ON attendance
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'attendance', NEW.id, 'worker_id=' || NEW.worker_id || '|date=' || NEW.date || '|status=' || NEW.status);
  END;
`;

export const CREATE_ATTENDANCE_UPDATE_LOG = `
  CREATE TRIGGER IF NOT EXISTS attendance_update_log AFTER UPDATE ON attendance
  WHEN OLD.status <> NEW.status
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'attendance', NEW.id,
        'worker_id=' || OLD.worker_id || '|date=' || OLD.date || '|status=' || OLD.status,
        'worker_id=' || NEW.worker_id || '|date=' || NEW.date || '|status=' || NEW.status
    );
  END;
`;

export const CREATE_ATTENDANCE_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS attendance_delete_log AFTER DELETE ON attendance
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'attendance', OLD.id,
        'worker_id=' || OLD.worker_id || '|date=' || OLD.date || '|status=' || OLD.status
    );
  END;
`;

export const CREATE_DAILY_METRICS_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS daily_metrics_insert_log AFTER INSERT ON daily_metrics
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'daily_metrics', NEW.id,
        'date=' || NEW.date
        || '|production_amount=' || COALESCE(NEW.production_amount, 0)
        || '|total_earned=' || COALESCE(NEW.total_earned, 0)
        || '|extra_expenses=' || COALESCE(NEW.extra_expenses, 0)
        || '|is_holiday=' || COALESCE(NEW.is_holiday, 0)
    );
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
        'date=' || OLD.date || '|production_amount=' || COALESCE(OLD.production_amount, 0) || '|total_earned=' || COALESCE(OLD.total_earned, 0) || '|extra_expenses=' || COALESCE(OLD.extra_expenses, 0) || '|is_holiday=' || COALESCE(OLD.is_holiday, 0),
        'date=' || NEW.date || '|production_amount=' || COALESCE(NEW.production_amount, 0) || '|total_earned=' || COALESCE(NEW.total_earned, 0) || '|extra_expenses=' || COALESCE(NEW.extra_expenses, 0) || '|is_holiday=' || COALESCE(NEW.is_holiday, 0)
    );
  END;
`;

export const CREATE_DAILY_METRICS_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS daily_metrics_delete_log AFTER DELETE ON daily_metrics
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'daily_metrics', OLD.id,
        'date=' || OLD.date || '|production_amount=' || COALESCE(OLD.production_amount, 0) || '|total_earned=' || COALESCE(OLD.total_earned, 0) || '|extra_expenses=' || COALESCE(OLD.extra_expenses, 0) || '|is_holiday=' || COALESCE(OLD.is_holiday, 0)
    );
  END;
`;

export const CREATE_PAYMENTS_INSERT_LOG = `
  CREATE TRIGGER IF NOT EXISTS payments_insert_log AFTER INSERT ON payments
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'payments', NEW.id,
        'worker_id=' || NEW.worker_id
        || '|amount=' || NEW.amount
        || '|date=' || NEW.date
        || '|description=' || COALESCE(NEW.description, '')
    );
  END;
`;

export const CREATE_PAYMENTS_UPDATE_LOG = `
  CREATE TRIGGER IF NOT EXISTS payments_update_log AFTER UPDATE ON payments
  WHEN OLD.amount <> NEW.amount OR OLD.date <> NEW.date OR COALESCE(OLD.description, '') <> COALESCE(NEW.description, '')
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'payments', NEW.id,
        'worker_id=' || OLD.worker_id
        || '|amount=' || OLD.amount
        || '|date=' || OLD.date
        || '|description=' || COALESCE(OLD.description, ''),
        'worker_id=' || NEW.worker_id
        || '|amount=' || NEW.amount
        || '|date=' || NEW.date
        || '|description=' || COALESCE(NEW.description, '')
    );
  END;
`;

export const CREATE_PAYMENTS_DELETE_LOG = `
  CREATE TRIGGER IF NOT EXISTS payments_delete_log AFTER DELETE ON payments
  BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data)
    VALUES ('DELETE', 'payments', OLD.id,
        'worker_id=' || OLD.worker_id
        || '|amount=' || OLD.amount
        || '|date=' || OLD.date
        || '|description=' || COALESCE(OLD.description, '')
    );
  END;
`;
