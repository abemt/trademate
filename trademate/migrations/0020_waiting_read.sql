-- A read that waits: both scenarios written before the session, the call made when price shows its hand.
-- waited_from keeps the time he showed up; called_at/price_at_call move to the moment of the call so the grade measures the call.
ALTER TABLE day_plans ADD COLUMN scenario_bull TEXT;
ALTER TABLE day_plans ADD COLUMN scenario_bear TEXT;
ALTER TABLE day_plans ADD COLUMN waited_from TEXT;
ALTER TABLE day_plans ADD COLUMN resolution_note TEXT;
