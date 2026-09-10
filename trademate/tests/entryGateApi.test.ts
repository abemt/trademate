import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { sign } from "hono/jwt";
import type { Env } from "../worker/context";
import { traderContext } from "../worker/context";
import { entryGateRoutes, entryState, guardTradeWrites } from "../worker/entryGate";
import worker from "../worker/index";

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
  bias: "bearish", direction: "short", setup: "m15_double", thesis: "Back at the H1 supply that rejected twice.",
  invalidation_price: 3510, conditions: ["Price at my level", "Second peak rejects", "M15 closes below neckline"],
};

test("plan then enter: a plan is claimable at once, exactly once, and the trigger enforces it", async () => {
  const { env, request } = fixture();
  const created = await request("/entry-gate/plans", { account_id: "gate-test", details });
  assert.equal(created.status, 201, await created.clone().text());
  const state = await created.json();
  assert.ok(state.plan.id);
  const trade = { id: "test-trade", account_id: "gate-test", direction: "short", instrument: "XAUUSD", status: "open", entry_plan_id: state.plan.id };
  const first = await guardTradeWrites(env, [{ ...trade }]);
  const competing = await guardTradeWrites(env, [{ ...trade, id: "other-trade" }]);
  await env.DB.batch(first.claims);
  await assert.rejects(() => env.DB.batch(competing.claims), /missing, used, or cancelled/);
  const after = await entryState(env, "gate-test");
  assert.equal(after.trade_count, 1);
  assert.equal(after.plan, null, "the used plan is no longer live");
  assert.equal(first.trades[0].setup_type, "M15 double top / bottom");
  assert.match(String(first.trades[0].plan_entry), /Invalidation: 3510/);
  assert.ok(Date.parse(String(first.trades[0].opened_at)) >= Date.parse(state.plan.created_at), "entry cannot predate the plan");
});

test("a scalp can be logged already closed, and the entry time is clamped to after the plan", async () => {
  const { env, request } = fixture();
  const state = await (await request("/entry-gate/plans", { account_id: "gate-test", details })).json();
  const guarded = await guardTradeWrites(env, [{ id: "scalp", account_id: "gate-test", direction: "short", instrument: "XAUUSD", status: "closed", pnl_usd: 40, closed_at: new Date().toISOString(), opened_at: "2020-01-01T00:00:00.000Z", entry_plan_id: state.plan.id }]);
  await env.DB.batch(guarded.claims);
  assert.equal(guarded.trades[0].status, "closed");
  assert.equal(guarded.trades[0].opened_at, state.plan.created_at);
  assert.ok(guarded.trades[0].closed_at);
});

test("writing a new plan replaces the unused one; direction must match the plan", async () => {
  const { db, env, request } = fixture();
  const first = await (await request("/entry-gate/plans", { account_id: "gate-test", details })).json();
  const second = await (await request("/entry-gate/plans", { account_id: "gate-test", details: { ...details, bias: "neutral", direction: "long" } })).json();
  assert.notEqual(second.plan.id, first.plan.id);
  assert.equal(db.prepare("SELECT cancelled_at FROM entry_plans WHERE id = ?").get(first.plan.id)!.cancelled_at !== null, true);
  await assert.rejects(() => guardTradeWrites(env, [{ id: "stale", account_id: "gate-test", direction: "long", instrument: "XAUUSD", status: "open", entry_plan_id: first.plan.id }]), /plan first/);
  await assert.rejects(() => guardTradeWrites(env, [{ id: "wrong-way", account_id: "gate-test", direction: "short", instrument: "XAUUSD", status: "open", entry_plan_id: second.plan.id }]), /must match/);
  assert.equal((await request("/entry-gate/plans", { account_id: "gate-test", details: { ...details, direction: "long" } })).status, 409, "bias/direction conflict rejected server-side");
});

test("the daily cap blocks a third planned entry but the honest unplanned record still works", async () => {
  const { env, request } = fixture();
  for (const id of ["one", "two"]) {
    const state = await (await request("/entry-gate/plans", { account_id: "gate-test", details })).json();
    const guarded = await guardTradeWrites(env, [{ id, account_id: "gate-test", direction: "short", instrument: "XAUUSD", status: "open", entry_plan_id: state.plan.id }]);
    await env.DB.batch(guarded.claims);
  }
  assert.equal((await request("/entry-gate/plans", { account_id: "gate-test", details })).status, 409);
  const violation = await guardTradeWrites(env, [{ id: "three", account_id: "gate-test", entry_mode: "unplanned", unplanned_reason: "chased it", opened_at: new Date(Date.now() - 1000).toISOString() }]);
  await env.DB.batch(violation.claims);
  assert.equal(violation.trades[0].followed_plan, 0);
  assert.equal((await entryState(env, "gate-test")).trade_count, 3);
});

test("sit-out locks the day, cancels the live plan, and counts as a win only with zero entries", async () => {
  const { env, request } = fixture();
  const state = await (await request("/entry-gate/plans", { account_id: "gate-test", details })).json();
  assert.equal((await request("/entry-gate/sit-out", { account_id: "gate-test", reason: "No clean setup formed" })).status, 200);
  const locked = await entryState(env, "gate-test");
  assert.ok(locked.sit_out);
  assert.equal(locked.plan, null);
  assert.equal(locked.sit_out_days?.[0].entries, 0);
  assert.equal((await request("/entry-gate/plans", { account_id: "gate-test", details })).status, 409);
  await assert.rejects(() => guardTradeWrites(env, [{ id: "bypass", account_id: "gate-test", direction: "short", instrument: "XAUUSD", status: "open", entry_plan_id: state.plan.id }]), /finished/);
  assert.equal((await entryState(env, "acc-legacy")).sit_out, null, "other accounts unaffected");
});

test("authenticated trade endpoint: no plan → 409, legacy trades still close, deletes keep the count", async () => {
  const { db, env } = fixture();
  env.JWT_SECRET = "local-test-only-signing-key-not-a-real-credential";
  const token = await sign({ sub: "trader", exp: Math.floor(Date.now() / 1000) + 60 }, env.JWT_SECRET);
  const put = (trades: unknown[]) => worker.fetch(new Request("http://localhost/api/trades", {
    method: "PUT", headers: { "Content-Type": "application/json", Cookie: `tm_session=${token}` }, body: JSON.stringify({ trades }),
  }), env, {} as ExecutionContext);
  const base = { id: "legacy-test", account_id: "gate-test", instrument: "XAUUSD", direction: "long", status: "open", opened_at: new Date(Date.now() - 1000).toISOString(), updated_at: new Date().toISOString() };
  assert.equal((await put([base])).status, 409);
  db.prepare("INSERT INTO trades (id,instrument,direction,status,opened_at,updated_at,account_id) VALUES (?,?,?,?,?,?,?)").run(base.id, base.instrument, base.direction, base.status, base.opened_at, base.updated_at, base.account_id);
  const closed = await put([{ ...base, status: "closed", pnl_usd: 0 }]);
  assert.equal(closed.status, 200, await closed.clone().text());
  assert.equal((await closed.json()).trades[0].status, "closed");
  assert.equal((await put([{ ...base, status: "open" }])).status, 409, "closed trades cannot be reopened");
  assert.equal((await entryState(env, "gate-test")).trade_count, 1);
  assert.equal((await put([{ ...base, status: "closed", deleted: 1, updated_at: new Date().toISOString() }])).status, 200);
  assert.equal((await entryState(env, "gate-test")).trade_count, 1);
  assert.equal((await worker.fetch(new Request("http://localhost/api/entry-gate?account_id=gate-test"), env, {} as ExecutionContext)).status, 401);
});

test("Mate sees the written plan and the explicit no-trade decision", async () => {
  const { db, env, request } = fixture();
  db.exec("UPDATE accounts SET active = CASE WHEN id = 'gate-test' THEN 1 ELSE 0 END");
  await request("/entry-gate/plans", { account_id: "gate-test", details });
  assert.match(await traderContext(env), /PLAN WRITTEN BEFORE ENTRY[\s\S]*Second peak rejects/);
  await request("/entry-gate/sit-out", { account_id: "gate-test", reason: "No clean setup formed" });
  const context = await traderContext(env);
  assert.match(context, /EXPLICIT NO-TRADE DISCIPLINE WIN/);
  assert.doesNotMatch(context, /15 minutes|five minutes/i);
});
