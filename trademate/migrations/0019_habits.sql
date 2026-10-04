-- Day structure: the habits that give the day a shape, ticked per local date.
-- "do" = done today; "avoid" = kept today (the tick means "I didn't").
CREATE TABLE habits (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('do','avoid')),
  time_hint TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE habit_days (
  date TEXT NOT NULL,
  habit_id TEXT NOT NULL REFERENCES habits(id),
  done INTEGER NOT NULL DEFAULT 1 CHECK (done IN (0,1)),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (date, habit_id)
);
CREATE INDEX habit_days_date ON habit_days(date);
-- The Sunday list (Oct 4 2026), editable in the app.
INSERT INTO habits (id, label, kind, time_hint, sort, archived, created_at, updated_at) VALUES
  ('hab-wake', 'Up at 07:30 — no going back to bed', 'do', '07:30', 10, 0, datetime('now'), datetime('now')),
  ('hab-nap', 'No daytime nap', 'avoid', 'day', 20, 0, datetime('now'), datetime('now')),
  ('hab-meals', 'Three meals', 'do', 'day', 30, 0, datetime('now'), datetime('now')),
  ('hab-body', 'Move the body — outside 20 min or gym', 'do', '15:30', 40, 0, datetime('now'), datetime('now')),
  ('hab-study', 'Study block — course or book, 45 min', 'do', 'morning', 50, 0, datetime('now'), datetime('now')),
  ('hab-work', 'Work block — Joy Form, shop app, applications', 'do', '10:00–17:00', 60, 0, datetime('now'), datetime('now')),
  ('hab-chart', 'No chart before an alert or 17:00', 'avoid', 'until 17:00', 70, 0, datetime('now'), datetime('now')),
  ('hab-gaming', 'Gaming stops at the cutoff', 'avoid', '22:00', 80, 0, datetime('now'), datetime('now')),
  ('hab-phone', 'Phone out of the bedroom', 'do', '23:00', 90, 0, datetime('now'), datetime('now')),
  ('hab-bed', 'In bed by 23:30', 'do', '23:30', 100, 0, datetime('now'), datetime('now'));
