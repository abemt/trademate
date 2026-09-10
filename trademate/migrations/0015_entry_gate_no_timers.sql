-- v2 entry gate: no timers, no open-position rule. A planned entry only needs a live plan
-- for the same account/day (written before the entry) and a free slot under the daily cap.
-- Trigger kept on ONE line: the D1 remote query API splits multi-line trigger bodies.
DROP TRIGGER IF EXISTS enforce_entry_claim;

CREATE TRIGGER enforce_entry_claim BEFORE INSERT ON entry_ledger WHEN NEW.entry_mode = 'planned' BEGIN SELECT RAISE(ABORT, 'Entry plan missing, used, or cancelled') WHERE NOT EXISTS (SELECT 1 FROM entry_plans WHERE id = NEW.entry_plan_id AND account_id = NEW.account_id AND date = NEW.date AND cancelled_at IS NULL AND used_trade_id IS NULL AND julianday(created_at) <= julianday(NEW.created_at)); SELECT RAISE(ABORT, 'Trading is locked for this day') WHERE NOT EXISTS (SELECT 1 FROM entry_days WHERE account_id = NEW.account_id AND date = NEW.date AND sit_out_at IS NULL AND legacy_count + (SELECT COUNT(*) FROM entry_ledger WHERE account_id = NEW.account_id AND date = NEW.date) < max_trades); END;
