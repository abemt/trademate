-- TradeMate schema v1 — trader profile
CREATE TABLE IF NOT EXISTS profile (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  trader_name TEXT NOT NULL DEFAULT 'Trader',
  timezone TEXT NOT NULL DEFAULT 'Africa/Addis_Ababa',
  instrument TEXT NOT NULL DEFAULT 'XAUUSD',
  account_type TEXT NOT NULL DEFAULT 'prop_eval',
  account_label TEXT NOT NULL DEFAULT 'Alpha Capital 10k Evaluation',
  account_size REAL NOT NULL DEFAULT 10000,
  risk_pct_min REAL NOT NULL DEFAULT 0.5,
  risk_pct_max REAL NOT NULL DEFAULT 1.0,
  sl_pips_min INTEGER NOT NULL DEFAULT 50,
  sl_pips_max INTEGER NOT NULL DEFAULT 100,
  max_trades_per_day INTEGER NOT NULL DEFAULT 2,
  -- Alpha Capital eval limits — fill in from the firm's rules (Settings, Phase 1)
  prop_daily_loss_pct REAL,
  prop_max_drawdown_pct REAL,
  prop_profit_target_pct REAL,
  playbook TEXT NOT NULL DEFAULT '["break_of_structure","break_and_retest","support_zone","resistance_zone"]',
  entry_triggers TEXT NOT NULL DEFAULT '["double_top","double_bottom"]',
  weaknesses TEXT NOT NULL DEFAULT '["overtrading","journaling_consistency","fear","greed"]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT OR IGNORE INTO profile (id) VALUES (1);
