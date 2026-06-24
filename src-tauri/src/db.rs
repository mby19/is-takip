use tauri_plugin_sql::{Migration, MigrationKind};

pub fn get_migrations() -> Vec<Migration> {
    vec![
        Migration {
            version: 1,
            description: "initial_schema_v2",
            sql: "
CREATE TABLE IF NOT EXISTS workers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    daily_wage REAL NOT NULL,
    worker_type TEXT CHECK( worker_type IN ('ORTAK', 'GUNLUK') ) NOT NULL,
    created_at DATETIME DEFAULT (DATETIME('now', 'localtime')),
    is_active BOOLEAN DEFAULT 1
);

CREATE TABLE IF NOT EXISTS attendance (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT CHECK( status IN ('FULL', 'HALF', 'ABSENT') ) NOT NULL,
    UNIQUE(worker_id, date),
    FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS daily_metrics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    date TEXT UNIQUE NOT NULL,
    production_amount INTEGER NOT NULL DEFAULT 0,
    total_earned REAL NOT NULL DEFAULT 0.0,
    extra_expenses REAL NOT NULL DEFAULT 0.0,
    is_holiday INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    description TEXT,
    FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type TEXT NOT NULL,
    entity_table TEXT NOT NULL,
    record_id INTEGER NOT NULL,
    old_data TEXT,
    new_data TEXT,
    created_at DATETIME DEFAULT (DATETIME('now', 'localtime'))
);

-- === TRIGGERS === --
CREATE TRIGGER IF NOT EXISTS workers_insert_log AFTER INSERT ON workers
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'workers', NEW.id, 'Worker: ' || NEW.name);
END;

CREATE TRIGGER IF NOT EXISTS attendance_insert_log AFTER INSERT ON attendance
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'attendance', NEW.id, 'Attendance: ' || NEW.status || ' on ' || NEW.date);
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "add_update_triggers",
            sql: "
CREATE TRIGGER IF NOT EXISTS daily_metrics_update_log AFTER UPDATE ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'daily_metrics', NEW.id, 'Production: ' || OLD.production_amount, 'Production: ' || NEW.production_amount);
END;

CREATE TRIGGER IF NOT EXISTS daily_metrics_insert_log AFTER INSERT ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'daily_metrics', NEW.id, 'Daily production added');
END;

CREATE TRIGGER IF NOT EXISTS attendance_update_log AFTER UPDATE ON attendance
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'attendance', NEW.id, 'Old: ' || OLD.status, 'New: ' || NEW.status);
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 3,
            description: "add_indexes",
            sql: "
CREATE INDEX IF NOT EXISTS idx_attendance_date ON attendance(date);
CREATE INDEX IF NOT EXISTS idx_daily_metrics_date ON daily_metrics(date);
CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(date);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 4,
            description: "rich_trigger_data",
            sql: "
-- Eski trigger'ları temizle
DROP TRIGGER IF EXISTS workers_insert_log;
DROP TRIGGER IF EXISTS attendance_insert_log;
DROP TRIGGER IF EXISTS attendance_update_log;
DROP TRIGGER IF EXISTS daily_metrics_insert_log;
DROP TRIGGER IF EXISTS daily_metrics_update_log;

-- Yeni trigger'lar: pipe-delimited key=value formatı
CREATE TRIGGER workers_insert_log AFTER INSERT ON workers
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'workers', NEW.id, 'name=' || NEW.name || '|type=' || NEW.worker_type || '|wage=' || NEW.daily_wage);
END;

CREATE TRIGGER attendance_insert_log AFTER INSERT ON attendance
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'attendance', NEW.id, 'worker_id=' || NEW.worker_id || '|date=' || NEW.date || '|status=' || NEW.status);
END;

CREATE TRIGGER attendance_update_log AFTER UPDATE ON attendance
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'attendance', NEW.id,
        'worker_id=' || OLD.worker_id || '|date=' || OLD.date || '|status=' || OLD.status,
        'worker_id=' || NEW.worker_id || '|date=' || NEW.date || '|status=' || NEW.status
    );
END;

CREATE TRIGGER daily_metrics_insert_log AFTER INSERT ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'daily_metrics', NEW.id, 'date=' || NEW.date || '|production=' || NEW.production_amount || '|earned=' || NEW.total_earned || '|expenses=' || NEW.extra_expenses || '|holiday=' || NEW.is_holiday);
END;

CREATE TRIGGER daily_metrics_update_log AFTER UPDATE ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'daily_metrics', NEW.id,
        'date=' || OLD.date || '|production=' || OLD.production_amount || '|earned=' || OLD.total_earned || '|expenses=' || OLD.extra_expenses || '|holiday=' || OLD.is_holiday,
        'date=' || NEW.date || '|production=' || NEW.production_amount || '|earned=' || NEW.total_earned || '|expenses=' || NEW.extra_expenses || '|holiday=' || NEW.is_holiday
    );
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 5,
            description: "force_repair_triggers",
            sql: "
-- Tüm trigger'ları temizle ve en sağlam haliyle (v5) yeniden kur
DROP TRIGGER IF EXISTS workers_insert_log;
DROP TRIGGER IF EXISTS attendance_insert_log;
DROP TRIGGER IF EXISTS attendance_update_log;
DROP TRIGGER IF EXISTS daily_metrics_insert_log;
DROP TRIGGER IF EXISTS daily_metrics_update_log;

-- Workers
CREATE TRIGGER workers_insert_log AFTER INSERT ON workers
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'workers', NEW.id, 'name=' || NEW.name || '|type=' || NEW.worker_type || '|wage=' || NEW.daily_wage);
END;

-- Attendance
CREATE TRIGGER attendance_insert_log AFTER INSERT ON attendance
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'attendance', NEW.id, 'worker_id=' || NEW.worker_id || '|date=' || NEW.date || '|status=' || NEW.status);
END;

CREATE TRIGGER attendance_update_log AFTER UPDATE ON attendance
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'attendance', NEW.id,
        'worker_id=' || OLD.worker_id || '|date=' || OLD.date || '|status=' || OLD.status,
        'worker_id=' || NEW.worker_id || '|date=' || NEW.date || '|status=' || NEW.status
    );
END;

-- Daily Metrics (Burası kritik: Gelir, Gider ve Üretim artık bir arada)
CREATE TRIGGER daily_metrics_insert_log AFTER INSERT ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'daily_metrics', NEW.id, 
        'date=' || NEW.date || 
        '|production=' || COALESCE(NEW.production_amount, 0) || 
        '|earned=' || COALESCE(NEW.total_earned, 0) || 
        '|expenses=' || COALESCE(NEW.extra_expenses, 0) || 
        '|holiday=' || COALESCE(NEW.is_holiday, 0)
    );
END;

CREATE TRIGGER daily_metrics_update_log AFTER UPDATE ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'daily_metrics', NEW.id,
        'date=' || OLD.date || 
        '|production=' || COALESCE(OLD.production_amount, 0) || 
        '|earned=' || COALESCE(OLD.total_earned, 0) || 
        '|expenses=' || COALESCE(OLD.extra_expenses, 0) || 
        '|holiday=' || COALESCE(OLD.is_holiday, 0),
        'date=' || NEW.date || 
        '|production=' || COALESCE(NEW.production_amount, 0) || 
        '|earned=' || COALESCE(NEW.total_earned, 0) || 
        '|expenses=' || COALESCE(NEW.extra_expenses, 0) || 
        '|holiday=' || COALESCE(NEW.is_holiday, 0)
    );
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 6,
            description: "optimize_logs_with_when",
            sql: "
-- Tetikleyicileri güncelle: Sadece veri değiştiğinde log at
DROP TRIGGER IF EXISTS attendance_update_log;
DROP TRIGGER IF EXISTS daily_metrics_update_log;

-- Attendance
CREATE TRIGGER attendance_update_log AFTER UPDATE ON attendance
WHEN OLD.status <> NEW.status
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'attendance', NEW.id,
        'worker_id=' || OLD.worker_id || '|date=' || OLD.date || '|status=' || OLD.status,
        'worker_id=' || NEW.worker_id || '|date=' || NEW.date || '|status=' || NEW.status
    );
END;

-- Daily Metrics
CREATE TRIGGER daily_metrics_update_log AFTER UPDATE ON daily_metrics
WHEN (
    OLD.production_amount <> NEW.production_amount OR
    OLD.total_earned <> NEW.total_earned OR
    OLD.extra_expenses <> NEW.extra_expenses OR
    OLD.is_holiday <> NEW.is_holiday
)
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'daily_metrics', NEW.id,
        'date=' || OLD.date || 
        '|production=' || COALESCE(OLD.production_amount, 0) || 
        '|earned=' || COALESCE(OLD.total_earned, 0) || 
        '|expenses=' || COALESCE(OLD.extra_expenses, 0) || 
        '|holiday=' || COALESCE(OLD.is_holiday, 0),
        'date=' || NEW.date || 
        '|production=' || COALESCE(NEW.production_amount, 0) || 
        '|earned=' || COALESCE(NEW.total_earned, 0) || 
        '|expenses=' || COALESCE(NEW.extra_expenses, 0) || 
        '|holiday=' || COALESCE(NEW.is_holiday, 0)
    );
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 7,
            description: "rich_day_snapshots",
            sql: "
-- Tetikleyicileri zenginleştir: Tüm günün özetini tek logda topla
DROP TRIGGER IF EXISTS attendance_insert_log;
DROP TRIGGER IF EXISTS attendance_update_log;
DROP TRIGGER IF EXISTS daily_metrics_insert_log;
DROP TRIGGER IF EXISTS daily_metrics_update_log;

-- Attendance Insert (Çalışan adını ekle)
CREATE TRIGGER attendance_insert_log AFTER INSERT ON attendance
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'attendance', NEW.id, 
        'worker_name=' || (SELECT name FROM workers WHERE id = NEW.worker_id) || 
        '|date=' || NEW.date || 
        '|status=' || NEW.status
    );
END;

-- Attendance Update (Çalışan adını ekle)
CREATE TRIGGER attendance_update_log AFTER UPDATE ON attendance
WHEN OLD.status <> NEW.status
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'attendance', NEW.id,
        'worker_name=' || (SELECT name FROM workers WHERE id = OLD.worker_id) || '|date=' || OLD.date || '|status=' || OLD.status,
        'worker_name=' || (SELECT name FROM workers WHERE id = NEW.worker_id) || '|date=' || NEW.date || '|status=' || NEW.status
    );
END;

-- Daily Metrics Insert (Tüm personelin o günkü durumunu snapshot al)
CREATE TRIGGER daily_metrics_insert_log AFTER INSERT ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'daily_metrics', NEW.id, 
        'date=' || NEW.date || 
        '|production=' || COALESCE(NEW.production_amount, 0) || 
        '|earned=' || COALESCE(NEW.total_earned, 0) || 
        '|expenses=' || COALESCE(NEW.extra_expenses, 0) || 
        '|atts=' || (SELECT group_concat(w.name || ':' || COALESCE(a.status, 'YOK'), ', ') 
                     FROM workers w LEFT JOIN attendance a ON w.id = a.worker_id AND a.date = NEW.date)
    );
END;

-- Daily Metrics Update (Tüm personelin o günkü durumunu snapshot al)
CREATE TRIGGER daily_metrics_update_log AFTER UPDATE ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'daily_metrics', NEW.id,
        'date=' || OLD.date || 
        '|production=' || COALESCE(OLD.production_amount, 0) || 
        '|earned=' || COALESCE(OLD.total_earned, 0) || 
        '|expenses=' || COALESCE(OLD.extra_expenses, 0) || 
        '|atts=' || (SELECT group_concat(w.name || ':' || COALESCE(a.status, 'YOK'), ', ') 
                     FROM workers w LEFT JOIN attendance a ON w.id = a.worker_id AND a.date = OLD.date),
        'date=' || NEW.date || 
        '|production=' || COALESCE(NEW.production_amount, 0) || 
        '|earned=' || COALESCE(NEW.total_earned, 0) || 
        '|expenses=' || COALESCE(NEW.extra_expenses, 0) || 
        '|atts=' || (SELECT group_concat(w.name || ':' || COALESCE(a.status, 'YOK'), ', ') 
                     FROM workers w LEFT JOIN attendance a ON w.id = a.worker_id AND a.date = NEW.date)
    );
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 8,
            description: "id_in_atts_snapshot",
            sql: "
-- Snapshot formatını güncelle: id:isim:durum (Geri alma işlemi için ID gerekli)
DROP TRIGGER IF EXISTS daily_metrics_insert_log;
DROP TRIGGER IF EXISTS daily_metrics_update_log;

CREATE TRIGGER daily_metrics_insert_log AFTER INSERT ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'daily_metrics', NEW.id, 
        'date=' || NEW.date || 
        '|production=' || COALESCE(NEW.production_amount, 0) || 
        '|earned=' || COALESCE(NEW.total_earned, 0) || 
        '|expenses=' || COALESCE(NEW.extra_expenses, 0) || 
        '|atts=' || (SELECT group_concat(w.id || ':' || w.name || ':' || COALESCE(a.status, 'YOK'), ', ') 
                     FROM workers w LEFT JOIN attendance a ON w.id = a.worker_id AND a.date = NEW.date)
    );
END;

CREATE TRIGGER daily_metrics_update_log AFTER UPDATE ON daily_metrics
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'daily_metrics', NEW.id,
        'date=' || OLD.date || 
        '|production=' || COALESCE(OLD.production_amount, 0) || 
        '|earned=' || COALESCE(OLD.total_earned, 0) || 
        '|expenses=' || COALESCE(OLD.extra_expenses, 0) || 
        '|atts=' || (SELECT group_concat(w.id || ':' || w.name || ':' || COALESCE(a.status, 'YOK'), ', ') 
                     FROM workers w LEFT JOIN attendance a ON w.id = a.worker_id AND a.date = OLD.date),
        'date=' || NEW.date || 
        '|production=' || COALESCE(NEW.production_amount, 0) || 
        '|earned=' || COALESCE(NEW.total_earned, 0) || 
        '|expenses=' || COALESCE(NEW.extra_expenses, 0) || 
        '|atts=' || (SELECT group_concat(w.id || ':' || w.name || ':' || COALESCE(a.status, 'YOK'), ', ') 
                     FROM workers w LEFT JOIN attendance a ON w.id = a.worker_id AND a.date = NEW.date)
    );
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 9,
            description: "drop_redundant_triggers_and_add_payments",
            sql: "
-- Attendance tetikleyicilerini kaldır (mükerrer log kalabalığını engellemek için)
DROP TRIGGER IF EXISTS attendance_insert_log;
DROP TRIGGER IF EXISTS attendance_update_log;
DROP TRIGGER IF EXISTS attendance_delete_log;

-- Daily Metrics tetikleyicilerini kaldır (puantaj geçiş oklarını JS seviyesinde el ile mükemmel loglamak için)
DROP TRIGGER IF EXISTS daily_metrics_insert_log;
DROP TRIGGER IF EXISTS daily_metrics_update_log;

-- Payments triggers
CREATE TRIGGER IF NOT EXISTS payments_insert_log AFTER INSERT ON payments
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, new_data)
    VALUES ('INSERT', 'payments', NEW.id,
        'worker_id=' || NEW.worker_id || '|worker_name=' || COALESCE((SELECT name FROM workers WHERE id = NEW.worker_id), 'Bilinmeyen') || '|amount=' || NEW.amount || '|date=' || NEW.date || '|description=' || COALESCE(NEW.description, '')
    );
END;

CREATE TRIGGER IF NOT EXISTS payments_update_log AFTER UPDATE ON payments
WHEN OLD.amount <> NEW.amount OR OLD.date <> NEW.date OR COALESCE(OLD.description, '') <> COALESCE(NEW.description, '')
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('UPDATE', 'payments', NEW.id,
        'worker_id=' || OLD.worker_id || '|worker_name=' || COALESCE((SELECT name FROM workers WHERE id = OLD.worker_id), 'Bilinmeyen') || '|amount=' || OLD.amount || '|date=' || OLD.date || '|description=' || COALESCE(OLD.description, ''),
        'worker_id=' || NEW.worker_id || '|worker_name=' || COALESCE((SELECT name FROM workers WHERE id = NEW.worker_id), 'Bilinmeyen') || '|amount=' || NEW.amount || '|date=' || NEW.date || '|description=' || COALESCE(NEW.description, '')
    );
END;

CREATE TRIGGER IF NOT EXISTS payments_delete_log AFTER DELETE ON payments
BEGIN
    INSERT INTO audit_logs (action_type, entity_table, record_id, old_data, new_data)
    VALUES ('DELETE', 'payments', OLD.id,
        'worker_id=' || OLD.worker_id || '|worker_name=' || COALESCE((SELECT name FROM workers WHERE id = OLD.worker_id), 'Bilinmeyen') || '|amount=' || OLD.amount || '|date=' || OLD.date || '|description=' || COALESCE(OLD.description, ''),
        NULL
    );
END;
",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 10,
            description: "add_holiday_to_attendance_check",
            sql: "
-- NOT: Tetikleyiciler (trigger'lar) JS tarafindan yönetilir (src/schema/triggers.ts).
-- Rust migration'lari sadece tablo şemasini ve index'leri yönetir.
-- Detay: docs/adr/0003-tetikleyici-yonetimi.md

-- attendance tablosundaki CHECK constraint'ine 'HOLIDAY' ekle
-- SQLite ALTER TABLE CHECK constraint desteklemez, bu yüzden tabloyu yeniden oluşturuyoruz
PRAGMA foreign_keys=OFF;

CREATE TABLE attendance_new (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    worker_id INTEGER NOT NULL,
    date TEXT NOT NULL,
    status TEXT CHECK( status IN ('FULL', 'HALF', 'ABSENT', 'HOLIDAY') ) NOT NULL,
    UNIQUE(worker_id, date),
    FOREIGN KEY(worker_id) REFERENCES workers(id) ON DELETE CASCADE
);

INSERT INTO attendance_new SELECT * FROM attendance;
DROP TABLE attendance;
ALTER TABLE attendance_new RENAME TO attendance;

PRAGMA foreign_keys=ON;
",
            kind: MigrationKind::Up,
        },
    ]
}

