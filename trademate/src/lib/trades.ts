import { SESSIONS, sessionStatus } from "./sessions";

export interface Trade {
  id: string;
  instrument: string;
  direction: "long" | "short";
  setup_type: string | null;
  entry_trigger: string | null;
  session: string | null;
  timeframe: string | null;
  entry_price: number | null;
  sl_price: number | null;
  tp_price: number | null;
  exit_price: number | null;
  sl_pips: number | null;
  lots: number | null;
  risk_usd: number | null;
  risk_pct: number | null;
  pnl_usd: number | null;
  r_multiple: number | null;
  outcome: "win" | "loss" | "breakeven" | null;
  status: "open" | "closed";
  emotions: string[];
  screenshots: string[];
  followed_plan: number | null;
  notes: string | null;
  opened_at: string;
  closed_at: string | null;
  updated_at: string;
  deleted: number;
}

export interface Option {
  id: string;
  label: string;
}

export const SETUPS: readonly Option[] = [
  { id: "break_of_structure", label: "BOS" },
  { id: "break_and_retest", label: "Break & Retest" },
  { id: "support_zone", label: "Support zone" },
  { id: "resistance_zone", label: "Resistance zone" },
  { id: "other", label: "Other" },
];

export const TRIGGERS: readonly Option[] = [
  { id: "double_bottom", label: "Double bottom" },
  { id: "double_top", label: "Double top" },
  { id: "none", label: "No trigger" },
];

export const TIMEFRAMES = ["M1", "M5", "M15", "H1", "H4"] as const;

export const EMOTIONS: readonly Option[] = [
  { id: "confident", label: "Confident" },
  { id: "calm", label: "Calm" },
  { id: "fomo", label: "FOMO" },
  { id: "revenge", label: "Revenge" },
  { id: "hesitant", label: "Hesitation" },
  { id: "anxious", label: "Anxious" },
  { id: "greedy", label: "Greedy" },
  { id: "bored", label: "Bored" },
];

export const TRADE_SESSIONS: readonly Option[] = [
  { id: "asia", label: "Asia" },
  { id: "london", label: "London" },
  { id: "newyork", label: "New York" },
];

export function optionLabel(list: readonly Option[], id: string | null): string | null {
  return list.find((x) => x.id === id)?.label ?? null;
}

/** Which session are we in right now? Later sessions win overlaps (NY > London). */
export function currentSessionId(now = new Date()): string {
  let current = "newyork";
  SESSIONS.forEach((s, i) => {
    if (sessionStatus(s, now).open) current = TRADE_SESSIONS[i].id;
  });
  return current;
}

/** Local-timezone YYYY-MM-DD for grouping by trading day. */
export function localDateKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA");
}

export function fmtUsd(v: number): string {
  const sign = v > 0 ? "+" : v < 0 ? "-" : "";
  return `${sign}$${Math.abs(v).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

/** Live account balance: starting balance + every closed trade's P&L from the journal. */
export function currentBalance(startingBalance: number, trades: Trade[]): number {
  return trades.reduce(
    (bal, t) =>
      !t.deleted && t.status === "closed" && t.pnl_usd !== null ? bal + t.pnl_usd : bal,
    startingBalance,
  );
}

export function fmtR(v: number): string {
  const r = Math.round(v * 100) / 100;
  return `${r > 0 ? "+" : ""}${r}R`;
}

export interface Breakdown extends Option {
  n: number;
  wins: number;
  netUsd: number;
  netR: number;
}

export interface TradeStats {
  closedCount: number;
  openCount: number;
  netUsd: number;
  netR: number;
  winRate: number | null;
  avgR: number | null;
  profitFactor: number | null;
  /** cumulative P&L after each closed trade, starting at 0 */
  equity: number[];
  todayPnl: number;
  drawdownFromPeak: number;
  overRuleDays: number;
  tradeDays: number;
  planFollowedPct: number | null;
  bySetup: Breakdown[];
  bySession: Breakdown[];
  byEmotion: Breakdown[];
}

export function computeStats(trades: Trade[], maxPerDay: number): TradeStats {
  const closed = trades
    .filter((t) => t.status === "closed" && t.pnl_usd !== null)
    .sort((a, b) => (a.closed_at ?? a.opened_at).localeCompare(b.closed_at ?? b.opened_at));

  let cum = 0;
  let peak = 0;
  let grossWin = 0;
  let grossLoss = 0;
  let wins = 0;
  let rSum = 0;
  let rCount = 0;
  const equity: number[] = [0];
  for (const t of closed) {
    const pnl = t.pnl_usd!;
    cum += pnl;
    peak = Math.max(peak, cum);
    equity.push(cum);
    if (pnl > 0) {
      wins++;
      grossWin += pnl;
    } else if (pnl < 0) {
      grossLoss += -pnl;
    }
    if (t.r_multiple !== null) {
      rSum += t.r_multiple;
      rCount++;
    }
  }

  const today = localDateKey(new Date().toISOString());
  const todayPnl = closed
    .filter((t) => localDateKey(t.closed_at ?? t.opened_at) === today)
    .reduce((s, t) => s + t.pnl_usd!, 0);

  const byDay = new Map<string, number>();
  for (const t of trades) {
    const k = localDateKey(t.opened_at);
    byDay.set(k, (byDay.get(k) ?? 0) + 1);
  }

  const planKnown = closed.filter((t) => t.followed_plan !== null);

  const breakdown = (defs: readonly Option[], match: (t: Trade, id: string) => boolean) =>
    defs
      .map((d) => {
        const list = closed.filter((t) => match(t, d.id));
        return {
          ...d,
          n: list.length,
          wins: list.filter((t) => t.pnl_usd! > 0).length,
          netUsd: list.reduce((s, t) => s + t.pnl_usd!, 0),
          netR: list.reduce((s, t) => s + (t.r_multiple ?? 0), 0),
        };
      })
      .filter((b) => b.n > 0);

  // Include custom ("Other") setups: derive defs from the actual values used.
  const setupDefs: Option[] = [...new Set(closed.map((t) => t.setup_type).filter(Boolean))].map(
    (id) => ({ id: id!, label: optionLabel(SETUPS, id) ?? id! }),
  );

  return {
    closedCount: closed.length,
    openCount: trades.filter((t) => t.status === "open").length,
    netUsd: cum,
    netR: rSum,
    winRate: closed.length ? Math.round((100 * wins) / closed.length) : null,
    avgR: rCount ? rSum / rCount : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    equity,
    todayPnl,
    drawdownFromPeak: peak - cum,
    overRuleDays: [...byDay.values()].filter((n) => n > maxPerDay).length,
    tradeDays: byDay.size,
    planFollowedPct: planKnown.length
      ? Math.round((100 * planKnown.filter((t) => t.followed_plan === 1).length) / planKnown.length)
      : null,
    bySetup: breakdown(setupDefs, (t, id) => t.setup_type === id),
    bySession: breakdown(TRADE_SESSIONS, (t, id) => t.session === id),
    byEmotion: breakdown(EMOTIONS, (t, id) => t.emotions.includes(id)),
  };
}
