-- Multi-account support + free-text feeling journaling.
CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'personal' CHECK (type IN ('personal','prop_eval','prop_funded','demo')),
  starting_balance REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

ALTER TABLE trades ADD COLUMN account_id TEXT;
ALTER TABLE trades ADD COLUMN feeling_note TEXT;

-- Seed the ledger from the current single-account profile; existing trades belong to it.
INSERT INTO accounts (id, label, type, starting_balance, active)
  SELECT 'acc-legacy', COALESCE(account_label, 'Legacy account'), COALESCE(account_type, 'prop_eval'), COALESCE(account_size, 0), 1
  FROM profile WHERE id = 1;
INSERT INTO accounts (id, label, type, starting_balance, active)
  SELECT 'acc-legacy', 'My account', 'personal', 0, 1
  WHERE NOT EXISTS (SELECT 1 FROM accounts);

UPDATE trades SET account_id = 'acc-legacy' WHERE account_id IS NULL;
