-- Zones, push subscriptions, exact balance
CREATE TABLE IF NOT EXISTS zones (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('support','resistance')),
  price_low REAL NOT NULL,
  price_high REAL NOT NULL,
  timeframe TEXT,
  note TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint TEXT PRIMARY KEY,
  p256dh TEXT,
  auth TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE profile SET account_size = 10032.10, updated_at = datetime('now') WHERE id = 1;
