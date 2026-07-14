-- Screenshots stored as D1 blobs (R2 requires dashboard/billing activation).
-- 5 GB free D1 ≈ decades of ~150 KB compressed chart shots for one trader.
CREATE TABLE IF NOT EXISTS blobs (
  id TEXT PRIMARY KEY,
  mime TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
