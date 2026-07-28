import { MATE_PERSONA, callAI, type AIMessage } from "./ai";

export interface Env {
  DB: D1Database;
  PASSCODE: string;
  JWT_SECRET: string;
  GEMINI_API_KEY?: string;
  GROQ_API_KEY?: string;
  TWELVEDATA_API_KEY?: string;
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
}

export async function recentTrades(env: Env, limit = 15): Promise<TradeRow[]> {
  try {
    const r = await env.DB.prepare(
      "SELECT opened_at, direction, setup_type, session, status, pnl_usd, r_multiple, emotions, followed_plan, notes FROM trades WHERE deleted = 0 ORDER BY opened_at DESC LIMIT ?",
    )
      .bind(limit)
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
    if (t.emotions && t.emotions !== "[]") bits.push(`felt:${t.emotions}`);
    if (t.followed_plan === 0) bits.push("BROKE-PLAN");
    if (t.notes) bits.push(`note:"${t.notes.slice(0, 90)}"`);
    return "- " + bits.filter(Boolean).join(" | ");
  });
  return lines.length ? lines.join("\n") : "- none logged yet";
}

export async function traderContext(env: Env): Promise<string> {
  const profile = await getProfile(env);
  const trades = await recentTrades(env, 15);
  const tz = String(profile.timezone ?? "Africa/Addis_Ababa");
  const today = localDate(tz);

  // Live balance = starting balance + net P&L of ALL closed trades (not just recent).
  let netPnl = 0;
  try {
    const r = await env.DB.prepare(
      "SELECT COALESCE(SUM(pnl_usd), 0) AS net FROM trades WHERE deleted = 0 AND status = 'closed' AND pnl_usd IS NOT NULL",
    ).first<{ net: number }>();
    netPnl = r?.net ?? 0;
  } catch {
    // trades table may not exist yet
  }
  const startBalance = Number(profile.account_size ?? 0);
  const liveBalance = Math.round(startBalance + netPnl);

  const todayCount = trades.filter(
    (t) => localDate(tz, new Date(t.opened_at)) === today,
  ).length;
  const closed = trades.filter((t) => t.status === "closed" && t.pnl_usd !== null);
  const recentPnl = closed.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);

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

  return `TRADER CONTEXT (live from his journal, newest first)
Name: ${profile.trader_name} · Timezone: ${tz} · Instrument: ${profile.instrument}
Account: ${profile.account_label} (started $${startBalance}, live balance $${liveBalance}), eval phase ${profile.eval_phase}
His rules: risk ${profile.risk_pct_min}-${profile.risk_pct_max}%/trade, SL ${profile.sl_pips_min}-${profile.sl_pips_max} pips, MAX ${profile.max_trades_per_day} trades/day
Prop limits: daily loss $${profile.prop_daily_loss_usd}, max drawdown $${profile.prop_max_drawdown_usd}, target $${profile.prop_profit_target_usd}
Known weaknesses: ${profile.weaknesses}
Market regime note: ${profile.market_regime_note ?? "n/a"}
His marked zones: ${zonesLine}
${checkinLine}
Today: ${todayCount} of ${profile.max_trades_per_day} trades used.
Recent trades P&L (last ${closed.length} closed): ${recentPnl >= 0 ? "+" : ""}$${Math.round(recentPnl)}
Recent trades:
${tradeLines(trades)}`;
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
