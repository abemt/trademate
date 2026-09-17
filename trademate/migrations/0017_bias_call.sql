-- Scored morning read: the day plan locks once the call is written and is graded against that day's bar.
ALTER TABLE day_plans ADD COLUMN trend TEXT;
ALTER TABLE day_plans ADD COLUMN invalidation_price REAL;
ALTER TABLE day_plans ADD COLUMN price_at_call REAL;
ALTER TABLE day_plans ADD COLUMN called_at TEXT;
ALTER TABLE day_plans ADD COLUMN scored_at TEXT;
ALTER TABLE day_plans ADD COLUMN settle_close REAL;
ALTER TABLE day_plans ADD COLUMN settle_high REAL;
ALTER TABLE day_plans ADD COLUMN settle_low REAL;
ALTER TABLE day_plans ADD COLUMN atr REAL;
ALTER TABLE day_plans ADD COLUMN result TEXT;
ALTER TABLE day_plans ADD COLUMN invalidated INTEGER NOT NULL DEFAULT 0;
