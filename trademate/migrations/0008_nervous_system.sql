-- Nervous-system journal v2 — body-state checkpoints per trade.
-- body/urge: 1 (calm) … 5 (shaking). autopilot: did Autopilot-Abem take over?
ALTER TABLE trades ADD COLUMN body_before INTEGER;
ALTER TABLE trades ADD COLUMN urge_before INTEGER;
ALTER TABLE trades ADD COLUMN body_during INTEGER;
ALTER TABLE trades ADD COLUMN exit_feeling TEXT;
ALTER TABLE trades ADD COLUMN autopilot INTEGER;
