import { MATE_PERSONA, callAI, type AIMessage } from "./ai";

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
}

export async function recentTrades(env: Env, limit = 15): Promise<TradeRow[]> {
  try {
    const r = await env.DB.prepare(
      "SELECT opened_at, direction, setup_type, session, status, pnl_usd, r_multiple, emotions, followed_plan, notes, body_before, urge_before, autopilot, feeling_note FROM trades WHERE deleted = 0 ORDER BY opened_at DESC LIMIT ?",
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
    if (t.body_before != null || t.urge_before != null)
      bits.push(`body:${t.body_before ?? "?"}/5 urge:${t.urge_before ?? "?"}/5`);
    if (t.autopilot === 1) bits.push("AUTOPILOT-TOOK-OVER");
    if (t.feeling_note) bits.push(`felt:"${t.feeling_note.slice(0, 80)}"`);
    if (t.emotions && t.emotions !== "[]") bits.push(`tags:${t.emotions}`);
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
ACTIVE account: ${account.label} [${account.type}] — started $${startBalance}, live balance $${liveBalance}${otherAccounts ? `\nOther accounts: ${otherAccounts}` : ""}
His rules: risk ${profile.risk_pct_min}-${profile.risk_pct_max}%/trade, SL ${profile.sl_pips_min}-${profile.sl_pips_max} pips, MAX ${profile.max_trades_per_day} trades/day
Prop limits (prop accounts only): daily loss $${profile.prop_daily_loss_usd}, max drawdown $${profile.prop_max_drawdown_usd}, target $${profile.prop_profit_target_usd}
Known weaknesses: ${profile.weaknesses}
Market regime note: ${profile.market_regime_note ?? "n/a"}
His marked zones: ${zonesLine}
${checkinLine}
Today: ${todayCount} of ${profile.max_trades_per_day} trades used.
Nervous system: ${nervousLine}
Recent trades P&L (last ${closed.length} closed): ${recentPnl >= 0 ? "+" : ""}$${Math.round(recentPnl)}
Recent trades:
${tradeLines(trades)}

HIS BINDING CONTRACT (agreed Aug 2026 — hold him to it, quote it back when he drifts):
1. The small account's job is REPS, not compounding. Success = rule-compliant trades; balance is irrelevant.
2. Every trade is graded BEFORE entry (no grade, no trade), placed as a bracket order (entry+SL+TP together), then app closed and a 30-minute walk. No watching 1-minute candles — zone alerts and 15/30-minute glances only.
3. One trade per day maximum right now. One loss = done for the day.
4. SL moves to break-even ONLY after a new structure point confirms beyond entry on a 15-MINUTE CLOSE — never from fear, never on a wick.
5. Two rule violations total, or a blown account → demo only, until (a) stable income lands AND (b) 30 consecutive clean demo trades.
6. Red-flag sentences — call them out the moment you hear them: "one last $10", "one more try", "I'll win it back", or wanting to deposit right after a blowup. That is Autopilot talking, not him.`;
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
