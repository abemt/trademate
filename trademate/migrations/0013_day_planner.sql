-- Day planner (pre-session: what I expect, what I must see) + written pre-trade plan on trades.
CREATE TABLE IF NOT EXISTS day_plans (
  date TEXT PRIMARY KEY,
  bias TEXT,
  narrative TEXT,
  must_see TEXT,
  invalidation TEXT,
  no_trade TEXT,
  review TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE trades ADD COLUMN plan_setup TEXT;
ALTER TABLE trades ADD COLUMN plan_entry TEXT;
ALTER TABLE trades ADD COLUMN lesson TEXT;
