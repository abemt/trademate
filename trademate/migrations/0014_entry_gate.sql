CREATE TABLE entry_days (
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  timezone TEXT NOT NULL,
  max_trades INTEGER NOT NULL,
  legacy_count INTEGER NOT NULL DEFAULT 0,
  sit_out_reason TEXT,
  sit_out_at TEXT,
  PRIMARY KEY (account_id, date)
);

CREATE TABLE entry_plans (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  details TEXT NOT NULL,
  created_at TEXT NOT NULL,
  ready_at TEXT NOT NULL,
  confirmed_at TEXT,
  cancelled_at TEXT,
  used_trade_id TEXT
);

CREATE UNIQUE INDEX one_live_entry_plan ON entry_plans(account_id, date)
  WHERE cancelled_at IS NULL AND used_trade_id IS NULL;

CREATE TABLE entry_ledger (
  trade_id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  date TEXT NOT NULL,
  entry_plan_id TEXT UNIQUE,
  entry_mode TEXT NOT NULL CHECK (entry_mode IN ('planned', 'unplanned')),
  unplanned_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX entry_ledger_day ON entry_ledger(account_id, date);

ALTER TABLE trades ADD COLUMN entry_plan_id TEXT;
ALTER TABLE trades ADD COLUMN entry_mode TEXT;
ALTER TABLE trades ADD COLUMN unplanned_reason TEXT;

-- Triggers are kept on ONE line each: the D1 remote query API splits multi-line trigger bodies at inner semicolons.
CREATE TRIGGER enforce_entry_claim BEFORE INSERT ON entry_ledger WHEN NEW.entry_mode = 'planned' BEGIN SELECT RAISE(ABORT, 'Entry plan missing, used, or expired') WHERE NOT EXISTS (SELECT 1 FROM entry_plans WHERE id = NEW.entry_plan_id AND account_id = NEW.account_id AND date = NEW.date AND cancelled_at IS NULL AND used_trade_id IS NULL AND confirmed_at IS NOT NULL AND julianday(ready_at) >= julianday(created_at) + 15.0 / 1440 - 0.00000001 AND julianday(confirmed_at) >= julianday(ready_at) AND julianday('now') >= julianday(confirmed_at) AND julianday('now') < julianday(confirmed_at) + 5.0 / 1440); SELECT RAISE(ABORT, 'Trading is locked for this day') WHERE NOT EXISTS (SELECT 1 FROM entry_days WHERE account_id = NEW.account_id AND date = NEW.date AND sit_out_at IS NULL AND legacy_count + (SELECT COUNT(*) FROM entry_ledger WHERE account_id = NEW.account_id AND date = NEW.date) < max_trades); SELECT RAISE(ABORT, 'An existing position is still open') WHERE EXISTS (SELECT 1 FROM trades WHERE COALESCE(account_id, 'acc-legacy') = NEW.account_id AND status = 'open' AND deleted = 0); END;

CREATE TRIGGER consume_entry_plan AFTER INSERT ON entry_ledger WHEN NEW.entry_mode = 'planned' BEGIN UPDATE entry_plans SET used_trade_id = NEW.trade_id WHERE id = NEW.entry_plan_id; END;