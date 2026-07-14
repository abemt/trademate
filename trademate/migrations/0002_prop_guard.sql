-- Alpha Capital eval rules + news restriction + market regime (2026-07-14)
ALTER TABLE profile ADD COLUMN eval_phase INTEGER NOT NULL DEFAULT 1;
ALTER TABLE profile ADD COLUMN prop_daily_loss_usd REAL;
ALTER TABLE profile ADD COLUMN prop_max_drawdown_usd REAL;
ALTER TABLE profile ADD COLUMN prop_profit_target_usd REAL;
ALTER TABLE profile ADD COLUMN prop_profit_target_p2_usd REAL;
-- Firm rule: flat ±N minutes around red news. Applies when funded; relaxed on eval.
ALTER TABLE profile ADD COLUMN news_buffer_min INTEGER NOT NULL DEFAULT 5;
ALTER TABLE profile ADD COLUMN news_restriction_applies INTEGER NOT NULL DEFAULT 0;
ALTER TABLE profile ADD COLUMN market_regime TEXT NOT NULL DEFAULT 'choppy';
ALTER TABLE profile ADD COLUMN market_regime_note TEXT;

ALTER TABLE profile DROP COLUMN prop_daily_loss_pct;
ALTER TABLE profile DROP COLUMN prop_max_drawdown_pct;
ALTER TABLE profile DROP COLUMN prop_profit_target_pct;

UPDATE profile SET
  prop_daily_loss_usd = 500,
  prop_max_drawdown_usd = 1000,
  prop_profit_target_usd = 1000,
  prop_profit_target_p2_usd = 500,
  market_regime_note = 'Extremely choppy lately: zones get tested multiple times before the real move, and first-touch setups that used to work are underperforming. Prefer confirmation entries (double top/bottom), expect retests. Headline risk: Trump Truth Social posts (Iran, Strait of Hormuz, tariffs) can spike gold instantly.'
WHERE id = 1;
