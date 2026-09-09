import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import type { Env } from "../worker/context";
import { entryGateRoutes, entryState, guardTradeWrites } from "../worker/entryGate";
import { PLAN_WAIT_MS } from "../shared/entryGate";
import worker from "../worker/index";
import { sign } from "hono/jwt";
import { traderContext } from "../worker/context";

class Statement {
  values: (string | number | null)[] = [];
  constructor(readonly db: DatabaseSync, readonly sql: string) {}
  bind(...values: (string | number | null)[]) { this.values = values; return this; }
  async first() { return this.db.prepare(this.sql).get(...this.values) ?? null; }
  async all() { return { results: this.db.prepare(this.sql).all(...this.values) }; }
  async run() { return { meta: this.db.prepare(this.sql).run(...this.values) }; }
}

function fixture() {
  const db = new DatabaseSync(":memory:");
  const directory = new URL("../migrations/", import.meta.url);
  for (const filename of readdirSync(directory).filter((name) => name.endsWith(".sql")).sort()) db.exec(readFileSync(new URL(filename, directory), "utf8"));
  db.prepare("INSERT INTO accounts (id,label,type,starting_balance,active,archived,created_at) VALUES ('gate-test','Test','demo',10000,0,0,datetime('now'))").run();
  const env = { DB: {
    prepare: (sql: string) => new Statement(db, sql),
    batch: async (statements: Statement[]) => {
      db.exec("BEGIN");
      try { const result = []; for (const statement of statements) result.push(await statement.run()); db.exec("COMMIT"); return result; }
      catch (error) { db.exec("ROLLBACK"); throw error; }
    },
  } } as unknown as Env;
  const request = (route: string, value?: unknown) => entryGateRoutes.request(`http://localhost${route}`, value ? {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(value),
  } : undefined, env);
  return { db, env, request };
}

const details = {
  bias: "bearish", direction: "short", setup: "m15_double", thesis: "Price must reject the premarked resistance zone.",
  alert_price: 3500, invalidation_price: 3510, invalidation_rule: "An M15 candle closes above the resistance zone.",
  conditions: ["Price tests the premarked resistance zone.", "The second M15 peak rejects the level.", "An M15 candle closes below the neckline."],
  no_trade_if: "Cancel the idea when the alert zone is broken.", alert_set: true,
};

test("real SQL migration and API enforce pre-entry timing and single-use claims", async () => {
  const { db, env, request } = fixture();
  try {
    const created = await request("/entry-gate/plans", { account_id: "gate-test", details, not_entered: true });
    assert.equal(created.status, 201, await created.clone().text());
    const state = await created.json();
    const planId = state.plan.id;
    assert.equal(Date.parse(state.plan.ready_at) - Date.parse(state.plan.created_at), PLAN_WAIT_MS);
    assert.equal((await request(`/entry-gate/plans/${planId}/confirm`, { confirmations: [true, true, true], not_entered: true, invalidation_clear: true })).status, 409);
    const now = Date.now();
    db.prepare("UPDATE entry_plans SET created_at = ?, ready_at = ? WHERE id = ?").run(new Date(now - PLAN_WAIT_MS - 10000).toISOString(), new Date(now - 10000).toISOString(), planId);
    assert.equal((await request(`/entry-gate/plans/${planId}/confirm`, { confirmations: [true, true, false], not_entered: true, invalidation_clear: true })).status, 409);
    assert.equal((await request(`/entry-gate/plans/${planId}/confirm`, { confirmations: [true, true, true], not_entered: true, invalidation_clear: true })).status, 200);
    const trade = { id: "test-trade", account_id: "gate-test", direction: "short", instrument: "XAUUSD", status: "open", entry_plan_id: planId };
    const first = await guardTradeWrites(env, [{ ...trade }]);
    const competing = await guardTradeWrites(env, [{ ...trade, id: "other-trade" }]);
    await env.DB.batch(first.claims);
    await assert.rejects(() => env.DB.batch(competing.claims), /used|expired/);
    assert.equal((await entryState(env, "gate-test")).trade_count, 1);
    assert.equal((await entryState(env, "gate-test")).plan, null);
    assert.match(String(first.trades[0].plan_entry), /Invalidation: 3510/);
    assert.ok(first.trades[0].opened_at);
  } finally { db.close(); }
});

test("sit-out is durable and overrides a previously confirmed plan", async () => {
  const { db, env, request } = fixture();
  try {
    const created = await request("/entry-gate/plans", { account_id: "gate-test", details, not_entered: true });
    const state = await created.json();
    assert.equal((await request("/entry-gate/sit-out", { account_id: "gate-test", reason: "No clean setup has formed today." })).status, 200);
    assert.ok((await entryState(env, "gate-test")).sit_out);
    assert.equal((await entryState(env, "gate-test")).sit_out_days?.[0].entries, 0);
    assert.equal((await request("/entry-gate/plans", { account_id: "gate-test", details, not_entered: true })).status, 409);
    assert.equal((await request(`/entry-gate/plans/${state.plan.id}/confirm`, { confirmations: [true, true, true], not_entered: true, invalidation_clear: true })).status, 409);
    await assert.rejects(() => guardTradeWrites(env, [{ id: "bypass", account_id: "gate-test", entry_plan_id: state.plan.id }]), /finished/);
    const violation = await guardTradeWrites(env, [{ id: "honest-record", account_id: "gate-test", entry_mode: "unplanned", unplanned_reason: "I entered before writing and confirming a plan.", opened_at: new Date(Date.now() - 1000).toISOString() }]);
    await env.DB.batch(violation.claims);
    assert.equal(violation.trades[0].followed_plan, 0);
    assert.equal((await entryState(env, "gate-test")).trade_count, 1);
    assert.equal((await entryState(env, "gate-test")).sit_out_days?.[0].entries, 1);
    assert.equal((await entryState(env, "acc-legacy")).sit_out, null);
  } finally { db.close(); }
});

test("API rejects unsupported plans and new trades without prior plans", async () => {
  const { db, env, request } = fixture();
  try {
    assert.equal((await request("/entry-gate/plans", { account_id: "gate-test", details, not_entered: false })).status, 409);
    assert.equal((await request("/entry-gate/plans", { account_id: "gate-test", details: { ...details, conditions: [] }, not_entered: true })).status, 409);
    await assert.rejects(() => guardTradeWrites(env, [{ id: "new", account_id: "gate-test" }]), /Lock a plan/);
    await assert.rejects(() => guardTradeWrites(env, [{ id: "new", account_id: "missing" }]), /account/);
  } finally { db.close(); }
});

test("authenticated trade endpoint rejects bypasses and preserves legacy close-outs", async () => {
  const { db, env } = fixture();
  env.JWT_SECRET = "local-test-only-signing-key-not-a-real-credential";
  const token = await sign({ sub: "trader", exp: Math.floor(Date.now() / 1000) + 60 }, env.JWT_SECRET);
  const put = (trades: unknown[]) => worker.fetch(new Request("http://localhost/api/trades", {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: `tm_session=${token}` }, body: JSON.stringify({ trades }),
  }), env, {} as ExecutionContext);
  try {
    const base = { id: "legacy-test", account_id: "gate-test", instrument: "XAUUSD", direction: "long", status: "open", opened_at: new Date(Date.now() - 1000).toISOString(), updated_at: new Date().toISOString() };
    assert.equal((await put([base])).status, 409);
    db.prepare("INSERT INTO trades (id,instrument,direction,status,opened_at,updated_at,account_id) VALUES (?,?,?,?,?,?,?)").run(base.id, base.instrument, base.direction, base.status, base.opened_at, base.updated_at, base.account_id);
    const closed = await put([{ ...base, status: "closed", pnl_usd: 0, account_id: "acc-legacy", opened_at: "2020-01-01T00:00:00.000Z" }]);
    assert.equal(closed.status, 200, await closed.clone().text());
    const saved = (await closed.json()).trades[0];
    assert.equal(saved.account_id, "gate-test");
    assert.equal(saved.opened_at, base.opened_at);
    assert.equal(saved.status, "closed");
    assert.equal((await put([{ ...saved, status: "open" }])).status, 409);
    assert.equal((await entryState(env, "gate-test")).trade_count, 1);
    assert.equal((await put([{ ...saved, deleted: 1, updated_at: new Date().toISOString() }])).status, 200);
    assert.equal((await entryState(env, "gate-test")).trade_count, 1);
    assert.equal((await worker.fetch(new Request("http://localhost/api/entry-gate?account_id=gate-test"), env, {} as ExecutionContext)).status, 401);
  } finally { db.close(); }
});

test("Mate recognizes the active account's explicit no-trade decision", async () => {
  const { db, env, request } = fixture();
  try {
    db.exec("UPDATE accounts SET active = CASE WHEN id = 'gate-test' THEN 1 ELSE 0 END");
    await request("/entry-gate/sit-out", { account_id: "gate-test", reason: "The market did not complete my entry conditions." });
    const context = await traderContext(env);
    assert.match(context, /EXPLICIT NO-TRADE DISCIPLINE WIN/);
    assert.match(context, /The market did not complete my entry conditions/);
    assert.doesNotMatch(context, /today WAS a rule-compliant day/);
  } finally { db.close(); }
});