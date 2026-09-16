-- Autopilot catch log: the moment an urge is noticed (trading, gaming or life),
-- what the brain said, how strong it was, and whether he walked away.
CREATE TABLE urge_log (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('trading','gaming','life')),
  intensity INTEGER NOT NULL CHECK (intensity BETWEEN 1 AND 5),
  sentence TEXT,
  feeling TEXT,
  outcome TEXT NOT NULL CHECK (outcome IN ('resisted','acted','pending')),
  instead TEXT
);

CREATE INDEX urge_log_created ON urge_log(created_at);
