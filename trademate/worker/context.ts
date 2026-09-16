import { MATE_PERSONA, callAI, type AIMessage } from "./ai";
import type { EntryPlanInput } from "../shared/entryGate";
import { summarizeUrges, type UrgeEntry } from "../shared/urges";

export interface Env {
  DB: D1Database;
  PASSCODE: string;
  JWT_SECRET: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  TWELVEDATA_API_KEY?: string;
  GITHUB_MODELS_TOKEN?: string;
  TELEGRAM_NEWS_CHANNEL?: string;
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_JWK?: string;
}

/** Mirrors the seed row in migrations — used until D1 is migrated. */
export const DEFAULT_PROFILE = {
  id: 1,
  trader_name: "Trader",
  timezone: "Africa/Addis_Ababa",
  instrument: "XAUUSD",
  account_type: "prop_eval",
  account_label: "Alpha Capital 10k Evaluation",
  account_size: 10000,
  risk_pct_min: 0.5,
  risk_pct_max: 1,
  sl_pips_min: 50,
  sl_pips_max: 100,
  max_trades_per_day: 2,
  eval_phase: 1,
  prop_daily_loss_usd: 500,
  prop_max_drawdown_usd: 1000,
  prop_profit_target_usd: 1000,
  prop_profit_target_p2_usd: 500,
  news_buffer_min: 5,
  news_restriction_applies: 0,
  market_regime: "choppy",
  market_regime_note:
    "Extremely choppy lately: zones get tested multiple times before the real move. Prefer confirmation entries, expect retests. Watch Trump Truth Social headline risk.",
  playbook: '["break_of_structure","break_and_retest","support_zone","resistance_zone"]',
  entry_triggers: '["double_top","double_bottom"]',
  weaknesses: '["overtrading","journaling_consistency","fear","greed"]',
};

export async function getProfile(env: Env): Promise<Record<string, unknown>> {
  try {
    const row = await env.DB.prepare("SELECT * FROM profile WHERE id = 1").first();
    if (row) return row as Record<string, unknown>;
  } catch {
    // not migrated yet
  }
  return DEFAULT_PROFILE;
}

/** Local YYYY-MM-DD in the trader's timezone. */
export function localDate(tz: string, d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d);
}

interface TradeRow {
  opened_at: string;
  direction: string;
  setup_type: string | null;
  session: string | null;
  status: string;
  pnl_usd: number | null;
  r_multiple: number | null;
  emotions: string;
  followed_plan: number | null;
  notes: string | null;
  body_before: number | null;
  urge_before: number | null;
  autopilot: number | null;
  feeling_note: string | null;
  plan_setup: string | null;
  plan_entry: string | null;
  lesson: string | null;
  mistakes: string | null;
}

export async function recentTrades(env: Env, limit = 15, accountId?: string): Promise<TradeRow[]> {
  try {
    const r = await env.DB.prepare(
      "SELECT opened_at, direction, setup_type, session, status, pnl_usd, r_multiple, emotions, followed_plan, notes, body_before, urge_before, autopilot, feeling_note, plan_setup, plan_entry, lesson, mistakes FROM trades WHERE deleted = 0 AND (? IS NULL OR COALESCE(account_id, 'acc-legacy') = ?) ORDER BY opened_at DESC LIMIT ?",
    )
      .bind(accountId ?? null, accountId ?? null, limit)
      .all();
    return r.results as unknown as TradeRow[];
  } catch {
    return [];
  }
}

export function tradeLines(trades: TradeRow[]): string {
  const lines = trades.map((t) => {
    const bits = [
      t.opened_at.slice(0, 16).replace("T", " "),
      t.direction.toUpperCase(),
      t.setup_type ?? "?",
      t.session ?? "",
      t.status === "open"
        ? "OPEN"
        : `${(t.pnl_usd ?? 0) >= 0 ? "+" : ""}$${t.pnl_usd}${t.r_multiple !== null ? ` (${t.r_multiple}R)` : ""}`,
    ];
    if (t.body_before != null || t.urge_before != null)
      bits.push(`body:${t.body_before ?? "?"}/5 urge:${t.urge_before ?? "?"}/5`);
    if (t.autopilot === 1) bits.push("AUTOPILOT-TOOK-OVER");
    if (t.plan_setup) bits.push(`his-plan:"${t.plan_setup.slice(0, 70)}"`);
    if (t.plan_entry) bits.push(`waited-for:"${t.plan_entry.slice(0, 70)}"`);
    if (t.feeling_note) bits.push(`felt:"${t.feeling_note.slice(0, 80)}"`);
    if (t.emotions && t.emotions !== "[]") bits.push(`tags:${t.emotions}`);
    if (t.mistakes && t.mistakes !== "[]") bits.push(`mistakes:${t.mistakes}`);
    if (t.followed_plan === 0) bits.push("BROKE-PLAN");
    if (t.lesson) bits.push(`his-lesson:"${t.lesson.slice(0, 90)}"`);
    if (t.notes) bits.push(`note:"${t.notes.slice(0, 90)}"`);
    return "- " + bits.filter(Boolean).join(" | ");
  });
  return lines.length ? lines.join("\n") : "- none logged yet";
}

/** Last two weeks of the autopilot catch log, for coaching context. */
export async function urgeLines(env: Env, days = 14): Promise<string> {
  try {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();
    const { results } = await env.DB.prepare("SELECT * FROM urge_log WHERE created_at >= ? ORDER BY created_at DESC LIMIT 60").bind(since).all<UrgeEntry>();
    if (!results.length) return `Autopilot catch log (last ${days} days): nothing logged. Absence of entries means he did not log, not that no urges happened.`;
    const s = summarizeUrges(results);
    const recent = results.slice(0, 6).map((entry) =>
      `- ${entry.created_at.slice(0, 16).replace("T", " ")}Z ${entry.domain} urge ${entry.intensity}/5 ${entry.outcome.toUpperCase()}${entry.sentence ? ` said:"${entry.sentence.slice(0, 60)}"` : ""}${entry.feeling ? ` felt:"${entry.feeling.slice(0, 80)}"` : ""}${entry.instead ? ` instead:"${entry.instead.slice(0, 50)}"` : ""}`,
    );
    return `Autopilot catch log (last ${days} days): ${s.total} logged — walked away ${s.resisted}, acted ${s.acted}, still open ${s.pending}${s.catchRate !== null ? ` (catch rate ${s.catchRate}%)` : ""}. By area: ${Object.entries(s.byDomain).map(([k, v]) => `${k} ${v}`).join(", ")}.${s.topSentence ? ` Most common permission sentence: "${s.topSentence.text}" (${s.topSentence.count}x).` : ""}\n${recent.join("\n")}`;
  } catch {
    return "Autopilot catch log unavailable.";
  }
}

export async function traderContext(env: Env): Promise<string> {
  const profile = await getProfile(env);
  const tz = String(profile.timezone ?? "Africa/Addis_Ababa");
  const today = localDate(tz);

  // Active account (falls back to the single-account profile pre-migration).
  let account = {
    id: "acc-legacy",
    label: String(profile.account_label ?? "Account"),
    type: String(profile.account_type ?? "personal"),
    starting_balance: Number(profile.account_size ?? 0),
  };
  let otherAccounts = "";
  try {
    const a = await env.DB.prepare("SELECT * FROM accounts WHERE active = 1 LIMIT 1").first<{
      id: string;
      label: string;
      type: string;
      starting_balance: number;
    }>();
    if (a) account = { id: a.id, label: a.label, type: a.type, starting_balance: Number(a.starting_balance) };
    const rest = await env.DB.prepare(
      "SELECT label, type FROM accounts WHERE archived = 0 AND active = 0",
    ).all<{ label: string; type: string }>();
    if (rest.results.length) {
      otherAccounts = rest.results.map((r) => `${r.label} [${r.type}]`).join(", ");
    }
  } catch {
    // accounts table may not exist yet
  }

  // Live balance for the ACTIVE account only (legacy rows may have NULL account_id).
  let netPnl = 0;
  try {
    const r = await env.DB.prepare(
      "SELECT COALESCE(SUM(pnl_usd), 0) AS net FROM trades WHERE deleted = 0 AND status = 'closed' AND pnl_usd IS NOT NULL AND (account_id = ?1 OR (?1 = 'acc-legacy' AND account_id IS NULL))",
    )
      .bind(account.id)
      .first<{ net: number }>();
    netPnl = r?.net ?? 0;
  } catch {
    // trades table may not exist yet
  }
  const startBalance = account.starting_balance;
  const liveBalance = Math.round((startBalance + netPnl) * 100) / 100;

  // Nervous-system aggregates across ALL closed trades — his body is the edge signal.
  let nervousLine = "No nervous-system data yet.";
  try {
    const n = await env.DB.prepare(
      `SELECT
        SUM(CASE WHEN body_before <= 2 THEN 1 ELSE 0 END) calmN,
        SUM(CASE WHEN body_before <= 2 AND pnl_usd > 0 THEN 1 ELSE 0 END) calmW,
        SUM(CASE WHEN body_before >= 3 THEN 1 ELSE 0 END) tenseN,
        SUM(CASE WHEN body_before >= 3 AND pnl_usd > 0 THEN 1 ELSE 0 END) tenseW,
        SUM(CASE WHEN autopilot IS NOT NULL THEN 1 ELSE 0 END) autoTotal,
        SUM(CASE WHEN autopilot = 1 THEN 1 ELSE 0 END) autoN
      FROM trades WHERE deleted = 0 AND status = 'closed' AND pnl_usd IS NOT NULL`,
    ).first<{ calmN: number; calmW: number; tenseN: number; tenseW: number; autoTotal: number; autoN: number }>();
    if (n && (n.calmN > 0 || n.tenseN > 0 || n.autoTotal > 0)) {
      const parts: string[] = [];
      if (n.calmN > 0) parts.push(`calm entries (body 1-2): ${Math.round((100 * n.calmW) / n.calmN)}% win over ${n.calmN}`);
      if (n.tenseN > 0) parts.push(`tense entries (body 3-5): ${Math.round((100 * n.tenseW) / n.tenseN)}% win over ${n.tenseN}`);
      if (n.autoTotal > 0) parts.push(`Autopilot took over ${Math.round((100 * n.autoN) / n.autoTotal)}% of ${n.autoTotal} closed`);
      nervousLine = parts.join(" · ");
    }
  } catch {
    // columns may not exist yet
  }

  const accountHistory = await recentTrades(env, 1000, account.id);
  const trades = accountHistory.slice(0, 15);
  const todayTrades = accountHistory.filter((trade) => localDate(tz, new Date(trade.opened_at)) === today);
  const todayCount = todayTrades.length;
  const todayClosed = todayTrades.filter((t) => t.status === "closed" && t.pnl_usd !== null);
  const todayNet = todayClosed.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);
  const todayBreaks = todayTrades.filter((t) => t.followed_plan === 0).length;
  const closed = trades.filter((t) => t.status === "closed" && t.pnl_usd !== null);
  const recentPnl = closed.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);

  let gateLine = "No locked entry-plan or sit-out record available. Missing records are not proof of discipline or avoidance.";
  try {
    const day = await env.DB.prepare(
      `SELECT sit_out_reason, sit_out_at, max_trades,
       legacy_count + (SELECT COUNT(*) FROM entry_ledger WHERE account_id = entry_days.account_id AND date = entry_days.date) AS entries
       FROM entry_days WHERE account_id = ? AND date = ?`,
    ).bind(account.id, today).first<{ sit_out_reason: string | null; sit_out_at: string | null; max_trades: number; entries: number }>();
    const locked = await env.DB.prepare("SELECT details, created_at, ready_at, confirmed_at FROM entry_plans WHERE account_id = ? AND date = ? AND cancelled_at IS NULL AND used_trade_id IS NULL ORDER BY created_at DESC LIMIT 1")
      .bind(account.id, today).first<{ details: string; created_at: string; ready_at: string; confirmed_at: string | null }>();
    const parts: string[] = [];
    if (day) parts.push(`Entry gate: ${day.entries}/${day.max_trades} entries (including deleted journal records); the day limit cannot be increased mid-session.`);
    if (day?.sit_out_at) parts.push(`${day.entries === 0 && todayCount === 0 ? "EXPLICIT NO-TRADE DISCIPLINE WIN" : "Finished for today, not a zero-trade win"}: "${day.sit_out_reason}" at ${day.sit_out_at}. No more entries on this account today; do not suggest overriding the lock.`);
    if (locked) {
      const details = JSON.parse(locked.details) as EntryPlanInput;
      parts.push(`PLAN WRITTEN BEFORE ENTRY at ${locked.created_at} (not yet used). Bias ${details.bias}, direction ${details.direction}; ${details.thesis}; must see ${details.conditions.join("; ")}; invalidation ${details.invalidation_price}${details.invalidation_rule ? `: ${details.invalidation_rule}` : ""}${details.no_trade_if ? `; walks away if ${details.no_trade_if}` : ""}. This snapshot overrides editable day-plan notes for this entry.`);
    }
    if (parts.length) gateLine = parts.join("\n");
  } catch {
    gateLine = "Entry gate data unavailable. Do not infer an unlocked session or invent a no-trade win.";
  }

  let checkinLine = "No check-in yet today.";
  try {
    const ci = await env.DB.prepare("SELECT * FROM checkins WHERE date = ?")
      .bind(today)
      .first<{ mood: number | null; sleep: number | null; plan: string | null }>();
    if (ci) {
      checkinLine = `Today's check-in: mood ${ci.mood ?? "?"}/5, sleep ${ci.sleep ?? "?"}/5${ci.plan ? `, plan: "${ci.plan.slice(0, 140)}"` : ""}`;
    }
  } catch {
    // table may not exist yet
  }

  let dayPlanLine = "No written day plan today.";
  try {
    const dp = await env.DB.prepare("SELECT * FROM day_plans WHERE date = ?")
      .bind(today)
      .first<{ bias: string | null; narrative: string | null; must_see: string | null; invalidation: string | null; no_trade: string | null; review: string | null }>();
    if (dp) {
      const p: string[] = [];
      if (dp.bias) p.push(`bias ${dp.bias.toUpperCase()}`);
      if (dp.narrative) p.push(`expects: "${dp.narrative.slice(0, 160)}"`);
      if (dp.must_see) p.push(`must see before entry: "${dp.must_see.slice(0, 160)}"`);
      if (dp.invalidation) p.push(`wrong if: "${dp.invalidation.slice(0, 100)}"`);
      if (dp.no_trade) p.push(`sits out if: "${dp.no_trade.slice(0, 100)}"`);
      if (dp.review) p.push(`his end-of-day review: "${dp.review.slice(0, 160)}"`);
      if (p.length) dayPlanLine = "Today's written day plan — " + p.join(" · ");
    }
  } catch {
    // table may not exist yet
  }

  let zonesLine = "none saved";
  try {
    const z = await env.DB.prepare(
      "SELECT kind, price_low, price_high, timeframe, note FROM zones WHERE active = 1 ORDER BY price_low DESC LIMIT 12",
    ).all<{ kind: string; price_low: number; price_high: number; timeframe: string | null; note: string | null }>();
    if (z.results.length) {
      zonesLine = z.results
        .map(
          (r) =>
            `${r.kind} ${r.price_low}-${r.price_high}${r.timeframe ? ` (${r.timeframe})` : ""}${r.note ? ` "${r.note.slice(0, 40)}"` : ""}`,
        )
        .join("; ");
    }
  } catch {
    // zones table may not exist yet
  }

  const urgeBlock = await urgeLines(env);

  return `TRADER CONTEXT (live from his journal, newest first)
Name: ${profile.trader_name} · Timezone: ${tz} · Instrument: ${profile.instrument}
ACTIVE account: ${account.label} [${account.type}] — started $${startBalance}, live balance $${liveBalance}${otherAccounts ? `\nOther accounts: ${otherAccounts}` : ""}
His rules: risk ${profile.risk_pct_min}-${profile.risk_pct_max}%/trade, SL ${profile.sl_pips_min}-${profile.sl_pips_max} pips, MAX ${profile.max_trades_per_day} trades/day
Prop limits (prop accounts only): daily loss $${profile.prop_daily_loss_usd}, max drawdown $${profile.prop_max_drawdown_usd}, target $${profile.prop_profit_target_usd}
Known weaknesses: ${profile.weaknesses}
Market regime note: ${profile.market_regime_note ?? "n/a"}
His marked zones: ${zonesLine}
${checkinLine}
Nervous system: ${nervousLine}
${urgeBlock}
Recent trades P&L (last ${closed.length} closed): ${recentPnl >= 0 ? "+" : ""}$${Math.round(recentPnl)}
Recent trades (HISTORY — includes previous days, check each date):
${tradeLines(trades)}

=== TODAY (${today}) — THE ONLY TRADES THAT COUNT AS TODAY ===
${dayPlanLine}
${gateLine}
Trades today: ${todayCount} of ${profile.max_trades_per_day} allowed · Net P&L today: ${todayNet >= 0 ? "+" : ""}$${Math.round(todayNet)} · Plan-breaks today: ${todayBreaks}
${tradeLines(todayTrades)}
Judge TODAY strictly from this account's section. Never attribute another account or day's trades to today. No recorded plan-breaks is not proof that every rule was followed. An explicit sit-out with zero recorded entries is a discipline win, not a missed profit opportunity. No activity without a sit-out record is unknown, not failure. A profitable unplanned trade remains a rule violation. TradeMate records self-attested market conditions and cannot control the broker or guarantee setup quality.

HIS CURRENT CONTRACT (LIVE — the numbers come from his profile and OVERRIDE any older version you remember):
1. The account's job is REPS, not compounding. Success = rule-compliant trades; balance is irrelevant.
2. Plan BEFORE entry, every time: bias, direction (must not contradict the bias), playbook setup, the three things he must see, and the invalidation price are written and saved before the order. No plan, no trade. An entry logged without a prior plan is a rule break even if it wins. No trade is owed to the market. Place broker protection as required by the trading plan; TradeMate does not place broker orders.
3. MAX ${profile.max_trades_per_day} trade(s) per day — this number is his CURRENT rule.${Number(profile.max_trades_per_day) === 1 ? " One loss = done for the day." : ""}
4. SL moves to break-even ONLY after a new structure point confirms beyond entry on a 15-MINUTE CLOSE — never from fear, never on a wick.
5. Red-flag sentences — call them out the moment you hear them: "one last $10", "one more try", "I'll win it back", "one loss won't take me anywhere", "it's basically there" / a "half" setup, or wanting to deposit right after a blowup. That is Autopilot talking, not him.
6. The loop he is breaking (it shows up in trading, in Rainbow Six and in daily life): cue -> permission sentence -> Autopilot acts -> regret. His job is to NOTICE and log it in the catch log before acting. When he reports an urge, name the loop, point at his own catch count, and tell him to step away for five minutes — the urge peaks and passes. A logged urge he walked away from is a rep won, whatever the market did afterwards.`;
}

export async function askMate(
  env: Env,
  userText: string,
  opts: { json?: boolean; maxTokens?: number; temperature?: number } = {},
): Promise<string> {
  const ctx = await traderContext(env);
  const messages: AIMessage[] = [
    { role: "system", text: `${MATE_PERSONA}\n\n${ctx}` },
    { role: "user", text: userText },
  ];
  return callAI(env, messages, opts);
}
