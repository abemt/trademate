-- Playbook (structured trade plans the AI grades against) + Notebook (auto-filled review notes).
CREATE TABLE IF NOT EXISTS plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  plan_type TEXT,
  charting_process TEXT NOT NULL DEFAULT '[]',
  entry_criteria TEXT NOT NULL DEFAULT '[]',
  management_rules TEXT,
  exit_criteria TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  screenshots TEXT NOT NULL DEFAULT '[]',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL DEFAULT 'free' CHECK (kind IN ('daily','weekly','monthly','free')),
  title TEXT NOT NULL DEFAULT 'Untitled',
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
