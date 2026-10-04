-- The A+ gate: seven yes/no lines answered on the ticket before the click.
-- gate = JSON array of the line ids that passed; gate_score = how many (7 = A+), NULL = never graded (older trades).
ALTER TABLE trades ADD COLUMN gate TEXT NOT NULL DEFAULT '[]';
ALTER TABLE trades ADD COLUMN gate_score INTEGER;
