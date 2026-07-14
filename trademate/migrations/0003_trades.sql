-- TradeMate journal — trades table
CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  instrument TEXT NOT NULL DEFAULT 'XAUUSD',
  direction TEXT NOT NULL CHECK (direction IN ('long','short')),
  setup_type TEXT,
  entry_trigger TEXT,
  session TEXT,
  timeframe TEXT,
  entry_price REAL,
  sl_price REAL,
  tp_price REAL,
  exit_price REAL,
  sl_pips REAL,
  lots REAL,
  risk_usd REAL,
  risk_pct REAL,
  pnl_usd REAL,
  r_multiple REAL,
  outcome TEXT CHECK (outcome IN ('win','loss','breakeven') OR outcome IS NULL),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  emotions TEXT NOT NULL DEFAULT '[]',
  followed_plan INTEGER,
  notes TEXT,
  opened_at TEXT NOT NULL,
  closed_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_trades_opened_at ON trades(opened_at DESC);
