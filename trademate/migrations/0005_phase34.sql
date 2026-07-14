-- Phase 3+4: briefings cache, daily check-ins, news watch
CREATE TABLE IF NOT EXISTS briefings (
  key TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'daily',
  json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS checkins (
  date TEXT PRIMARY KEY,
  mood INTEGER,
  sleep INTEGER,
  plan TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS news_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL UNIQUE,
  pub_date TEXT,
  severity TEXT,
  gold_impact TEXT,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
