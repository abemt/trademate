import assert from 'node:assert/strict';
import test from 'node:test';
import { allConfirmed, ENTRY_WINDOW_MS, noTradeWin, PLAN_WAIT_MS, planBlock, tradingDate, validateEntryPlan } from '../shared/entryGate.ts';

const start = Date.parse('2026-09-09T06:00:00.000Z');
const input = {
  bias: 'bearish', direction: 'short', setup: 'm15_double',
  thesis: 'Price is testing the previously marked resistance.', alert_price: 3500,
  invalidation_price: 3510, invalidation_rule: 'An M15 close above resistance cancels the idea.',
  conditions: ['Price reaches my marked resistance.', 'The second M15 peak rejects the level.', 'A closed M15 candle breaks the neckline.'],
  no_trade_if: 'Walk away if price breaks above the zone.', alert_set: true,
};
const state = () => ({
  account_id: 'account-a', date: '2026-09-09', timezone: 'Africa/Addis_Ababa',
  server_now: new Date(start).toISOString(), trade_count: 0, open_count: 0, max_trades: 2, sit_out: null,
  plan: {
    id: 'plan-a', account_id: 'account-a', date: '2026-09-09',
    created_at: new Date(start).toISOString(), ready_at: new Date(start + PLAN_WAIT_MS).toISOString(),
    confirmed_at: null, cancelled_at: null, used_trade_id: null, details: input,
  },
});

test('a specific plan needs three different conditions, an alert and invalidation', () => {
  assert.deepEqual(validateEntryPlan(input), input);
  for (const bad of [
    { thesis: 'vibes' }, { invalidation_price: NaN }, { alert_set: false },
    { conditions: input.conditions.slice(0, 2) }, { conditions: Array(3).fill(input.conditions[0]) },
    { direction: 'long' },
  ]) assert.throws(() => validateEntryPlan({ ...input, ...bad }));
});

test('locking and logging immediately cannot pass the wait', () => {
  assert.match(planBlock(state(), start), /15-minute/);
  assert.match(planBlock(state(), start + PLAN_WAIT_MS, true), /Confirm/);
  assert.equal(planBlock(state(), start + PLAN_WAIT_MS), null);
});

test('confirmed entry is short-lived and cannot be reused', () => {
  const current = state();
  const ready = start + PLAN_WAIT_MS;
  current.plan.confirmed_at = new Date(ready).toISOString();
  assert.equal(planBlock(current, ready, true), null);
  assert.match(planBlock(current, ready + ENTRY_WINDOW_MS, true), /expired/);
  current.plan.used_trade_id = 'trade-a';
  assert.match(planBlock(current, ready, true), /no longer/);
});

test('account, cancellation, open position and daily cap all fail closed', () => {
  const ready = start + PLAN_WAIT_MS;
  for (const patch of [{ account_id: 'other' }, { cancelled_at: new Date(start).toISOString() }, { ready_at: new Date(start).toISOString() }]) {
    const current = state();
    Object.assign(current.plan, patch);
    assert.ok(planBlock(current, ready));
  }
  assert.match(planBlock({ ...state(), trade_count: 2 }, ready), /limit/);
  assert.match(planBlock({ ...state(), open_count: 1 }, ready), /existing position/);
});

test('explicit sit-out locks entries; inactivity alone is not a discipline win', () => {
  const current = state();
  assert.equal(noTradeWin(current), false);
  current.sit_out = { reason: 'The setup did not develop.', created_at: new Date(start).toISOString() };
  assert.equal(noTradeWin(current), true);
  assert.match(planBlock(current, start + PLAN_WAIT_MS), /finished/);
  assert.equal(noTradeWin({ ...current, trade_count: 1 }), false);
});

test('the profile timezone controls midnight and stale plans fail', () => {
  const midnight = Date.parse('2026-09-09T21:00:00.000Z');
  assert.equal(tradingDate('Africa/Addis_Ababa', midnight), '2026-09-10');
  assert.match(planBlock(state(), midnight), /new trading day/i);
  assert.equal(allConfirmed([true, true, false]), false);
  assert.equal(allConfirmed([true, true, true, true]), false);
  assert.equal(allConfirmed([true, true, true]), true);
});