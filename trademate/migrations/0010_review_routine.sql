-- Trade review fields (self-grades, confluence/mistake tags) + pre-session routine tracking.
ALTER TABLE trades ADD COLUMN setup_grade TEXT;
ALTER TABLE trades ADD COLUMN execution_quality TEXT;
ALTER TABLE trades ADD COLUMN confluences TEXT NOT NULL DEFAULT '[]';
ALTER TABLE trades ADD COLUMN mistakes TEXT NOT NULL DEFAULT '[]';

CREATE TABLE IF NOT EXISTS routine_days (
  date TEXT PRIMARY KEY,
  done TEXT NOT NULL DEFAULT '[]',
  note TEXT
);
