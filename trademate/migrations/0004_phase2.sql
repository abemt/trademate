-- Phase 2: personalization, trade screenshots, Mate chat, setup analyses
UPDATE profile SET trader_name = 'Abem', updated_at = datetime('now') WHERE id = 1;

ALTER TABLE trades ADD COLUMN screenshots TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  role TEXT NOT NULL CHECK (role IN ('user','assistant')),
  content TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS setups (
  id TEXT PRIMARY KEY,
  images TEXT NOT NULL DEFAULT '[]',
  direction TEXT,
  setup_type TEXT,
  timeframe TEXT,
  entry TEXT,
  sl TEXT,
  tp TEXT,
  notes TEXT,
  ai_json TEXT,
  decision TEXT,
  trade_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
