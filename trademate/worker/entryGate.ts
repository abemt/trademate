import { Hono } from "hono";
import { getProfile, type Env } from "./context";
import {
  allConfirmed, ENTRY_SETUPS, PLAN_WAIT_MS, planBlock, sessionBlock, tradingDate,
  validateEntryPlan, type EntryGateState, type EntryPlan, type EntryPlanInput,
} from "../shared/entryGate";

interface PlanRow extends Omit<EntryPlan, "details"> { details: string }
interface DayRow {
  max_trades: number;
  legacy_count: number;
  timezone: string;
  sit_out_reason: string | null;
  sit_out_at: string | null;
}

export async function entryState(env: Env, accountId: string, now = Date.now()): Promise<EntryGateState> {
  const account = await env.DB.prepare("SELECT id FROM accounts WHERE id = ? AND archived = 0").bind(accountId).first();
  if (!account) throw new Error("Select an available trading account first.");
  const profile = await getProfile(env);
  const timezone = String(profile.timezone ?? "Africa/Addis_Ababa");
  const date = tradingDate(timezone, now);
  const maxTrades = Math.max(1, Math.min(10, Number(profile.max_trades_per_day) || 2));
  const { results: legacy } = await env.DB.prepare(
    "SELECT opened_at FROM trades WHERE COALESCE(account_id, 'acc-legacy') = ? AND id NOT IN (SELECT trade_id FROM entry_ledger)",
  ).bind(accountId).all<{ opened_at: string }>();
  const legacyCount = legacy.filter((trade) => Number.isFinite(Date.parse(trade.opened_at)) && tradingDate(timezone, Date.parse(trade.opened_at)) === date).length;
  await env.DB.prepare(
    `INSERT INTO entry_days (account_id,date,timezone,max_trades,legacy_count) VALUES (?,?,?,?,?)
     ON CONFLICT(account_id,date) DO UPDATE SET legacy_count = MAX(entry_days.legacy_count, excluded.legacy_count)`,
  ).bind(accountId, date, timezone, maxTrades, legacyCount).run();
  const day = await env.DB.prepare("SELECT * FROM entry_days WHERE account_id = ? AND date = ?").bind(accountId, date).first<DayRow>();
  if (!day) throw new Error("The entry gate is unavailable.");
  const count = await env.DB.prepare("SELECT COUNT(*) AS total FROM entry_ledger WHERE account_id = ? AND date = ?").bind(accountId, date).first<{ total: number }>();
  const open = await env.DB.prepare("SELECT COUNT(*) AS total FROM trades WHERE COALESCE(account_id, 'acc-legacy') = ? AND status = 'open' AND deleted = 0").bind(accountId).first<{ total: number }>();
  const plan = await env.DB.prepare(
    "SELECT * FROM entry_plans WHERE account_id = ? AND date = ? AND cancelled_at IS NULL AND used_trade_id IS NULL ORDER BY created_at DESC LIMIT 1",
  ).bind(accountId, date).first<PlanRow>();
  const history = await env.DB.prepare(
    `SELECT date, sit_out_reason AS reason,
     legacy_count + (SELECT COUNT(*) FROM entry_ledger WHERE account_id = entry_days.account_id AND date = entry_days.date) AS entries
     FROM entry_days WHERE account_id = ? AND sit_out_at IS NOT NULL ORDER BY date DESC LIMIT 365`,
  ).bind(accountId).all<{ date: string; reason: string; entries: number }>();
  return {
    account_id: accountId, date, timezone: day.timezone, server_now: new Date(now).toISOString(),
    trade_count: day.legacy_count + (count?.total ?? 0), open_count: open?.total ?? 0, max_trades: day.max_trades,
    sit_out: day.sit_out_at ? { reason: day.sit_out_reason ?? "", created_at: day.sit_out_at } : null,
    sit_out_days: history.results,
    plan: plan ? { ...plan, details: JSON.parse(plan.details) as EntryPlanInput } : null,
  };
}

export const entryGateRoutes = new Hono<{ Bindings: Env }>();

entryGateRoutes.onError((error, context) => context.json({ error: error.message }, 409));

entryGateRoutes.get("/entry-gate", async (context) => {
  return context.json(await entryState(context.env, context.req.query("account_id") ?? ""));
});

entryGateRoutes.post("/entry-gate/plans", async (context) => {
  const body = await context.req.json<{ account_id: string; details: unknown; not_entered: boolean }>();
  if (body.not_entered !== true) throw new Error("An entry plan must be written before placing an order.");
  const details = validateEntryPlan(body.details);
  const now = Date.now();
  const state = await entryState(context.env, body.account_id, now);
  const blocked = sessionBlock(state, now);
  if (blocked) throw new Error(blocked);
  if (state.plan) throw new Error("Cancel the existing plan before replacing it. The wait will restart.");
  await context.env.DB.prepare(
    `INSERT INTO entry_plans (id,account_id,date,details,created_at,ready_at)
     SELECT ?,?,?,?,?,? WHERE NOT EXISTS (
       SELECT 1 FROM entry_days WHERE account_id = ? AND date = ? AND sit_out_at IS NOT NULL
     )`,
  ).bind(crypto.randomUUID(), state.account_id, state.date, JSON.stringify(details), new Date(now).toISOString(), new Date(now + PLAN_WAIT_MS).toISOString(), state.account_id, state.date).run();
  return context.json(await entryState(context.env, state.account_id), 201);
});

entryGateRoutes.post("/entry-gate/plans/:id/confirm", async (context) => {
  const body = await context.req.json<{ confirmations: unknown; not_entered: boolean; invalidation_clear: boolean }>();
  if (!allConfirmed(body.confirmations) || body.not_entered !== true || body.invalidation_clear !== true) {
    throw new Error("All three conditions must have occurred, required candles must be closed, and invalidation must remain intact before entry.");
  }
  const plan = await context.env.DB.prepare("SELECT * FROM entry_plans WHERE id = ?").bind(context.req.param("id")).first<PlanRow>();
  if (!plan) throw new Error("Entry plan not found.");
  const now = Date.now();
  const state = await entryState(context.env, plan.account_id, now);
  if (state.plan?.id !== plan.id) throw new Error("This plan is no longer active.");
  const blocked = planBlock(state, now);
  if (blocked) throw new Error(blocked);
  await context.env.DB.prepare(
    `UPDATE entry_plans SET confirmed_at = COALESCE(confirmed_at, ?)
     WHERE id = ? AND cancelled_at IS NULL AND used_trade_id IS NULL
       AND NOT EXISTS (SELECT 1 FROM entry_days WHERE account_id = ? AND date = ? AND sit_out_at IS NOT NULL)`,
  ).bind(new Date(now).toISOString(), plan.id, plan.account_id, plan.date).run();
  return context.json(await entryState(context.env, plan.account_id));
});

entryGateRoutes.post("/entry-gate/plans/:id/cancel", async (context) => {
  const plan = await context.env.DB.prepare("SELECT account_id FROM entry_plans WHERE id = ?").bind(context.req.param("id")).first<{ account_id: string }>();
  if (!plan) throw new Error("Entry plan not found.");
  await context.env.DB.prepare("UPDATE entry_plans SET cancelled_at = ? WHERE id = ? AND used_trade_id IS NULL AND cancelled_at IS NULL")
    .bind(new Date().toISOString(), context.req.param("id")).run();
  return context.json(await entryState(context.env, plan.account_id));
});

entryGateRoutes.post("/entry-gate/sit-out", async (context) => {
  const body = await context.req.json<{ account_id: string; reason: string }>();
  if (typeof body.reason !== "string" || body.reason.trim().length < 12 || body.reason.length > 1000) throw new Error("Write why you are finishing for today (12-1000 characters).");
  const state = await entryState(context.env, body.account_id);
  if (state.open_count) throw new Error("Manage the existing open position before finishing for today.");
  await context.env.DB.batch([
    context.env.DB.prepare(
      `UPDATE entry_days SET sit_out_reason = ?, sit_out_at = ? WHERE account_id = ? AND date = ? AND sit_out_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM trades WHERE COALESCE(account_id, 'acc-legacy') = ? AND status = 'open' AND deleted = 0)`,
    ).bind(body.reason.trim(), new Date().toISOString(), state.account_id, state.date, state.account_id),
    context.env.DB.prepare(
      `UPDATE entry_plans SET cancelled_at = ? WHERE account_id = ? AND date = ? AND used_trade_id IS NULL AND cancelled_at IS NULL
       AND EXISTS (SELECT 1 FROM entry_days WHERE account_id = ? AND date = ? AND sit_out_at IS NOT NULL)`,
    ).bind(new Date().toISOString(), state.account_id, state.date, state.account_id, state.date),
  ]);
  const updated = await entryState(context.env, state.account_id);
  if (!updated.sit_out) throw new Error("A position was opened while you were finishing. Review the journal.");
  return context.json(updated);
});

export async function guardTradeWrites(env: Env, trades: Record<string, unknown>[]) {
  const claims: D1PreparedStatement[] = [];
  const ids = new Set<string>();
  const plannedAccounts = new Set<string>();
  for (const trade of trades) {
    const id = String(trade.id);
    if (ids.has(id)) throw new Error("Duplicate trade IDs in this request.");
    ids.add(id);
    const previous = await env.DB.prepare("SELECT * FROM trades WHERE id = ?").bind(id).first<Record<string, unknown>>();
    if (previous) {
      if ((previous.status === "closed" && trade.status === "open") || (previous.deleted && !trade.deleted)) {
        throw new Error("Closed or deleted entries cannot be reopened as a new trade. Use the entry checkpoint.");
      }
      for (const field of ["account_id", "opened_at", "entry_plan_id", "entry_mode", "unplanned_reason"]) trade[field] = previous[field] ?? null;
      if (previous.entry_mode === "planned") {
        for (const field of ["direction", "instrument", "setup_type", "plan_setup", "plan_entry"]) trade[field] = previous[field];
      }
      if (previous.entry_mode === "unplanned") trade.followed_plan = 0;
      continue;
    }
    if (trade.deleted) throw new Error("Cannot delete a trade that has not been saved.");
    const accountId = typeof trade.account_id === "string" ? trade.account_id : "acc-legacy";
    const now = Date.now();
    const state = await entryState(env, accountId, now);
    trade.account_id = accountId;
    let date = state.date;
    let planId: string | null = null;
    if (trade.entry_mode === "unplanned") {
      const reason = typeof trade.unplanned_reason === "string" ? trade.unplanned_reason.trim() : "";
      if (reason.length < 12 || reason.length > 2000) throw new Error("Record what happened without a pre-entry plan (at least 12 characters).");
      const opened = Date.parse(String(trade.opened_at));
      if (!Number.isFinite(opened) || opened > now) throw new Error("Enter the actual entry time, not a future time.");
      date = tradingDate(state.timezone, opened);
      trade.entry_plan_id = null;
      trade.followed_plan = 0;
      trade.unplanned_reason = reason;
      trade.plan_setup = null;
      trade.plan_entry = null;
    } else {
      const blocked = planBlock(state, now, true);
      if (blocked) throw new Error(blocked);
      const plan = state.plan!;
      if (trade.entry_plan_id !== plan.id) throw new Error("A valid confirmed pre-entry plan is required.");
      if (plannedAccounts.has(accountId)) throw new Error("Only one new planned entry per account is allowed in a request.");
      plannedAccounts.add(accountId);
      if (trade.direction !== plan.details.direction || trade.instrument !== "XAUUSD") throw new Error("Entry direction and instrument must match the locked plan.");
      if (trade.status !== "open") throw new Error("Already-finished trades must use the unplanned-entry record.");
      planId = plan.id;
      trade.entry_mode = "planned";
      trade.unplanned_reason = null;
      trade.opened_at = new Date(now).toISOString();
      trade.closed_at = null;
      trade.setup_type = ENTRY_SETUPS.find((setup) => setup.id === plan.details.setup)!.label;
      trade.plan_setup = `${plan.details.bias.toUpperCase()}: ${plan.details.thesis}`;
      trade.plan_entry = `${ENTRY_SETUPS.find((setup) => setup.id === plan.details.setup)!.label}\n${plan.details.conditions.join("\n")}\nInvalidation: ${plan.details.invalidation_price} - ${plan.details.invalidation_rule}\nWalk away: ${plan.details.no_trade_if}`;
    }
    claims.push(env.DB.prepare(
      "INSERT INTO entry_ledger (trade_id,account_id,date,entry_plan_id,entry_mode,unplanned_reason,created_at) VALUES (?,?,?,?,?,?,?)",
    ).bind(id, accountId, date, planId, trade.entry_mode, trade.unplanned_reason ?? null, new Date(now).toISOString()));
  }
  return { trades, claims };
}