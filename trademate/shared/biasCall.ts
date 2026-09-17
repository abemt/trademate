/** The morning read: one locked directional call per day, graded against that day's bar. */

export const READ_CALLS = [
  { id: "bullish", label: "Bullish", hint: "I only look for longs" },
  { id: "bearish", label: "Bearish", hint: "I only look for shorts" },
  { id: "no_trade", label: "No trade", hint: "Choppy / no edge — sitting out is the trade" },
] as const;
export type ReadCall = (typeof READ_CALLS)[number]["id"];

export const READ_TRENDS = [
  { id: "up", label: "Higher highs & higher lows" },
  { id: "down", label: "Lower highs & lower lows" },
  { id: "range", label: "Overlapping — no clear structure" },
] as const;
export type ReadTrend = (typeof READ_TRENDS)[number]["id"];

export type ReadResult = "right" | "wrong" | "flat";

export interface DayPlan {
  date: string;
  bias: string | null;
  trend: ReadTrend | null;
  narrative: string | null;
  must_see: string | null;
  invalidation: string | null;
  invalidation_price: number | null;
  no_trade: string | null;
  review: string | null;
  price_at_call: number | null;
  called_at: string | null;
  scored_at: string | null;
  settle_close: number | null;
  settle_high: number | null;
  settle_low: number | null;
  atr: number | null;
  result: ReadResult | null;
  invalidated: number;
}

export interface DailyBar { date: string; open: number; high: number; low: number; close: number }

const NEWS_WORDS = /\b(fed|fomc|cpi|nfp|pce|ppi|powell|rate\s*(?:hike|cut|decision)s?|interest\s+rates?|hike[sd]?|yields?|inflation|fundamentals?|fundamentally|news|tariffs?|geopolit\w*|payrolls?|jobs\s+report|gdp|treasur(?:y|ies)|bonds?|stimulus|recession|election)\b/i;

/** Returns the first news word in a read, or null when the text talks about price only. */
export function structureOnlyProblem(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = NEWS_WORDS.exec(text);
  return match ? match[0] : null;
}

export function isReadCall(value: unknown): value is ReadCall {
  return READ_CALLS.some((call) => call.id === value);
}

export function isReadTrend(value: unknown): value is ReadTrend {
  return READ_TRENDS.some((trend) => trend.id === value);
}

/** A directional call against the structure he just named is the counter-trend bet that has never paid him. */
export function readConflict(trend: string | null, call: string | null): string | null {
  if (trend === "up" && call === "bearish") return "You just said higher highs and higher lows. A bearish call against that is a counter-trend bet — the worst-performing trade in your journal. Call it bullish, call it no trade, or go back and look at the structure again.";
  if (trend === "down" && call === "bullish") return "You just said lower highs and lower lows. A bullish call against that is a counter-trend bet — the worst-performing trade in your journal. Call it bearish, call it no trade, or go back and look at the structure again.";
  return null;
}

/** Average true range of the bars strictly before `date` (up to 14), or null when there is too little history. */
export function atrBefore(bars: DailyBar[], date: string, length = 14): number | null {
  const prior = bars.filter((bar) => bar.date < date).sort((a, b) => a.date.localeCompare(b.date)).slice(-(length + 1));
  if (prior.length < 3) return null;
  const ranges: number[] = [];
  for (let i = 1; i < prior.length; i++) {
    const bar = prior[i];
    const previousClose = prior[i - 1].close;
    ranges.push(Math.max(bar.high - bar.low, Math.abs(bar.high - previousClose), Math.abs(bar.low - previousClose)));
  }
  return ranges.reduce((sum, range) => sum + range, 0) / ranges.length;
}

/**
 * Grade a read. Direction calls need the close to travel at least 0.2 ATR from the price at the call;
 * a no-trade call is right when the close stayed within 0.35 ATR and wrong when the day ran 0.7 ATR or more.
 * `invalidated` marks that the day's range touched the line he said would prove him wrong.
 */
export function scoreRead(input: {
  call: string | null;
  priceAtCall: number;
  invalidationPrice: number | null;
  bar: Pick<DailyBar, "close" | "high" | "low">;
  atr: number;
}): { result: ReadResult; invalidated: boolean; move: number } {
  const move = input.bar.close - input.priceAtCall;
  const unit = Math.max(input.atr, 0.01);
  let result: ReadResult = "flat";
  if (input.call === "bullish") result = move >= 0.2 * unit ? "right" : move <= -0.2 * unit ? "wrong" : "flat";
  else if (input.call === "bearish") result = move <= -0.2 * unit ? "right" : move >= 0.2 * unit ? "wrong" : "flat";
  else if (input.call === "no_trade") result = Math.abs(move) <= 0.35 * unit ? "right" : Math.abs(move) >= 0.7 * unit ? "wrong" : "flat";
  const line = input.invalidationPrice;
  const invalidated = line !== null && Number.isFinite(line) && (
    (input.call === "bullish" && input.bar.low <= line) || (input.call === "bearish" && input.bar.high >= line)
  );
  return { result, invalidated, move };
}

/** Has the live price already crossed the line he wrote down this morning? */
export function lineCrossed(call: string | null, invalidationPrice: number | null, price: number | null): boolean {
  if (invalidationPrice === null || price === null || !Number.isFinite(price)) return false;
  return (call === "bullish" && price <= invalidationPrice) || (call === "bearish" && price >= invalidationPrice);
}

export interface ReadScorecard {
  scored: number;
  right: number;
  wrong: number;
  flat: number;
  invalidated: number;
  /** Right as a share of decided (non-flat) reads. */
  pct: number | null;
  streak: { result: ReadResult; length: number } | null;
}

export function summarizeReads(plans: Pick<DayPlan, "date" | "result" | "invalidated">[]): ReadScorecard {
  const scored = plans.filter((plan) => plan.result !== null).sort((a, b) => b.date.localeCompare(a.date));
  const right = scored.filter((plan) => plan.result === "right").length;
  const wrong = scored.filter((plan) => plan.result === "wrong").length;
  const flat = scored.length - right - wrong;
  const decided = right + wrong;
  let streak: ReadScorecard["streak"] = null;
  const firstDecided = scored.find((plan) => plan.result !== "flat");
  if (firstDecided) {
    let length = 0;
    for (const plan of scored) {
      if (plan.result === "flat") continue;
      if (plan.result !== firstDecided.result) break;
      length++;
    }
    streak = { result: firstDecided.result as ReadResult, length };
  }
  return {
    scored: scored.length, right, wrong, flat,
    invalidated: scored.filter((plan) => plan.invalidated).length,
    pct: decided ? Math.round((100 * right) / decided) : null,
    streak,
  };
}
