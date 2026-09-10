import assert from 'node:assert/strict';
import test from 'node:test';
import { noTradeWin, planBlock, sessionBlock, tradingDate, validateEntryPlan } from '../shared/entryGate.ts';

const now = Date.parse('2026-09-10T06:00:00.000Z');
const input = {
  bias: 'bearish', direction: 'short', setup: 'm15_double',
  thesis: 'Back at the H1 supply that rejected twice.', invalidation_price: 3510,
  conditions: ['Price at my level', 'Second peak rejects', 'M15 closes below neckline'],
};
const state = (overrides = {}) => ({
  account_id: 'account-a', date: '2026-09-10', timezone: 'Africa/Addis_Ababa',
  server_now: new Date(now).toISOString(), trade_count: 0, open_count: 0, max_trades: 2, sit_out: null,
  plan: {
    id: 'plan-a', account_id: 'account-a', date: '2026-09-10',
    created_at: new Date(now).toISOString(), ready_at: new Date(now).toISOString(), confirmed_at: new Date(now).toISOString(),
    cancelled_at: null, used_trade_id: null, details: input,
  },
  ...overrides,
});

test('a plan needs bias, direction, setup, why, three different must-sees and an invalidation price', () => {
  assert.deepEqual(validateEntryPlan(input), input);
  for (const bad of [
    { bias: '' }, { setup: 'random' }, { thesis: 'ok' }, { invalidation_price: NaN }, { invalidation_price: -1 },
    { conditions: input.conditions.slice(0, 2) }, { conditions: Array(3).fill(input.conditions[0]) },
  ]) assert.throws(() => validateEntryPlan({ ...input, ...bad }), `accepted ${JSON.stringify(bad)}`);
});

test('secondary fields are optional; empty strings are dropped, bad values still rejected', () => {
  const full = validateEntryPlan({ ...input, alert_price: 3500, invalidation_rule: 'M15 close above', no_trade_if: 'it runs without me' });
  assert.equal(full.alert_price, 3500);
  assert.equal(full.no_trade_if, 'it runs without me');
  const sparse = validateEntryPlan({ ...input, alert_price: '', invalidation_rule: '', no_trade_if: undefined });
  assert.equal('alert_price' in sparse, false);
  assert.equal('invalidation_rule' in sparse, false);
  assert.throws(() => validateEntryPlan({ ...input, alert_price: -5 }));
});

test('direction may not contradict the bias; neutral allows both', () => {
  assert.throws(() => validateEntryPlan({ ...input, bias: 'bearish', direction: 'long' }), /contradicts/);
  assert.throws(() => validateEntryPlan({ ...input, bias: 'bullish', direction: 'short' }), /contradicts/);
  assert.ok(validateEntryPlan({ ...input, bias: 'neutral', direction: 'long' }));
  assert.ok(validateEntryPlan({ ...input, bias: 'neutral', direction: 'short' }));
});

test('a fresh plan is usable immediately — no waiting period, no window', () => {
  assert.equal(planBlock(state(), now), null);
  assert.equal(planBlock(state(), now + 3 * 3600_000), null, 'still usable hours later on the same day');
  assert.match(planBlock(state({ plan: null }), now), /plan before you enter/i);
});

test('used, cancelled, foreign or stale plans fail closed', () => {
  for (const patch of [{ used_trade_id: 'trade-a' }, { cancelled_at: new Date(now).toISOString() }, { account_id: 'other' }, { date: '2026-09-09' }]) {
    const current = state();
    Object.assign(current.plan, patch);
    assert.ok(planBlock(current, now), `passed with ${JSON.stringify(patch)}`);
  }
});

test('daily cap and explicit sit-out block new plans; an open position does not', () => {
  assert.match(sessionBlock(state({ trade_count: 2 }), now), /Daily limit/);
  assert.equal(sessionBlock(state({ open_count: 1 }), now), null);
  const done = state({ sit_out: { reason: 'No clean setup formed', created_at: new Date(now).toISOString() } });
  assert.match(sessionBlock(done, now), /finished/);
  assert.equal(noTradeWin(done), true);
  assert.equal(noTradeWin({ ...done, trade_count: 1 }), false);
  assert.equal(noTradeWin(state()), false, 'inactivity alone is not a win');
});

test('the trading day follows the profile timezone', () => {
  const lateUtc = Date.parse('2026-09-10T21:30:00.000Z');
  assert.equal(tradingDate('Africa/Addis_Ababa', lateUtc), '2026-09-11');
  assert.match(planBlock(state(), lateUtc), /new trading day/i);
});
