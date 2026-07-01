-- Barney Tracker D1 Schema

CREATE TABLE IF NOT EXISTS feeding (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  amount TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS toilet (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  type TEXT NOT NULL -- 'wee' or 'poo'
);

CREATE TABLE IF NOT EXISTS food_stock (
  id INTEGER PRIMARY KEY DEFAULT 1,
  pouches INTEGER NOT NULL DEFAULT 0,
  alert_at INTEGER NOT NULL DEFAULT 5,
  updated_at TEXT NOT NULL,
  updated_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS treatments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL, -- 'flea' or 'worm'
  treated_at TEXT NOT NULL,
  logged_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calendar_events (
  id TEXT PRIMARY KEY,
  event_date TEXT NOT NULL,
  location_id TEXT NOT NULL,
  start_time TEXT,
  end_time TEXT,
  all_day INTEGER NOT NULL DEFAULT 0,
  note TEXT,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS weight (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_date TEXT NOT NULL,
  weight_kg REAL NOT NULL,
  logged_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS walks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  duration_mins INTEGER NOT NULL,
  distance TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS medications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  name TEXT NOT NULL,
  dose TEXT,
  note TEXT
);

CREATE TABLE IF NOT EXISTS behaviour (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  type TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS vet_appointments (
  id TEXT PRIMARY KEY,
  appt_date TEXT NOT NULL,
  reason TEXT NOT NULL,
  notes TEXT,
  upcoming INTEGER NOT NULL DEFAULT 1,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS info_card (
  id INTEGER PRIMARY KEY DEFAULT 1,
  microchip TEXT,
  vet TEXT,
  vet_phone TEXT,
  insurance TEXT,
  emergency_name TEXT,
  emergency_phone TEXT,
  notes TEXT,
  updated_at TEXT
);

CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  photo_date TEXT NOT NULL,
  caption TEXT,
  data TEXT NOT NULL,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS grooming (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  type TEXT NOT NULL, -- 'bath', 'brush', 'nails', 'other'
  note TEXT
);

CREATE TABLE IF NOT EXISTS training (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  commands TEXT NOT NULL,
  rating TEXT NOT NULL,
  note TEXT
);

CREATE TABLE IF NOT EXISTS milestones (
  id TEXT PRIMARY KEY,
  milestone_date TEXT NOT NULL,
  title TEXT NOT NULL,
  note TEXT,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  expense_date TEXT NOT NULL,
  category TEXT NOT NULL,
  amount REAL NOT NULL,
  description TEXT,
  added_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS mood (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  logged_date TEXT NOT NULL,
  mood TEXT NOT NULL,
  logged_by TEXT NOT NULL,
  note TEXT
);

-- Seed food_stock row so UPDATE always works
INSERT OR IGNORE INTO food_stock (id, pouches, alert_at, updated_at, updated_by)
VALUES (1, 0, 5, datetime('now'), 'system');

-- Seed info_card row
INSERT OR IGNORE INTO info_card (id) VALUES (1);
