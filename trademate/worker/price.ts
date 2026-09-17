import { atrBefore, scoreRead, type DailyBar, type DayPlan } from "../shared/biasCall";
import { getProfile, localDate, type Env } from "./context";

async function cached(key: string): Promise<string | null> {
  try {
    if (typeof caches === "undefined") return null;
    const hit = await caches.default.match(new Request(key));
    return hit ? await hit.text() : null;
  } catch {
    return null;
  }
}

async function remember(key: string, body: string, seconds: number): Promise<void> {
  try {
    if (typeof caches === "undefined") return;
    await caches.default.put(new Request(key), new Response(body, {
      headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${seconds}` },
    }));
  } catch {
    // cache unavailable (workers.dev / tests)
  }
}

/** Live XAU/USD spot with a short edge cache so the free TwelveData tier is respected. */
export async function spotPrice(env: Env): Promise<{ price: number | null; at: string }> {
  if (!env.TWELVEDATA_API_KEY) return { price: null, at: new Date().toISOString() };
  const key = "https://cache.trademate.internal/price";
  const hit = await cached(key);
  if (hit) {
    try { return JSON.parse(hit) as { price: number | null; at: string }; } catch { /* refetch */ }
  }
  let price: number | null = null;
  try {
    const r = (await (await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${env.TWELVEDATA_API_KEY}`)).json()) as { price?: string };
    if (r.price) price = Number.parseFloat(r.price);
  } catch {
    // provider down
  }
  const payload = { price: Number.isFinite(price as number) ? price : null, at: new Date().toISOString() };
  await remember(key, JSON.stringify(payload), 30);
  return payload;
}

/** Recent completed-and-current daily bars, oldest first. */
export async function dailyBars(env: Env, count = 40): Promise<DailyBar[]> {
  if (!env.TWELVEDATA_API_KEY) return [];
  const key = `https://cache.trademate.internal/daily-bars/${count}`;
  const hit = await cached(key);
  if (hit) {
    try { return JSON.parse(hit) as DailyBar[]; } catch { /* refetch */ }
  }
  const r = (await (await fetch(
    `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1day&outputsize=${count}&timezone=UTC&apikey=${env.TWELVEDATA_API_KEY}`,
  )).json()) as { values?: { datetime: string; open: string; high: string; low: string; close: string }[] };
  const bars = (r.values ?? [])
    .map((v) => ({ date: v.datetime.slice(0, 10), open: Number(v.open), high: Number(v.high), low: Number(v.low), close: Number(v.close) }))
    .filter((bar) => [bar.open, bar.high, bar.low, bar.close].every(Number.isFinite))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (bars.length) await remember(key, JSON.stringify(bars), 600);
  return bars;
}

/**
 * Grade every locked read from a finished day. Only bars from days before today (UTC) are used,
 * so a read is never scored against a candle that is still forming.
 */
export async function scoreDayPlans(env: Env, now = new Date()): Promise<number> {
  const profile = await getProfile(env);
  const today = localDate(String(profile.timezone ?? "Africa/Addis_Ababa"), now);
  const utcToday = now.toISOString().slice(0, 10);
  const { results } = await env.DB.prepare(
    "SELECT date, bias, price_at_call, invalidation_price FROM day_plans WHERE scored_at IS NULL AND price_at_call IS NOT NULL AND bias IN ('bullish','bearish','no_trade') AND date < ? ORDER BY date ASC LIMIT 30",
  ).bind(today).all<Pick<DayPlan, "date" | "bias" | "price_at_call" | "invalidation_price">>();
  if (!results.length) return 0;
  const bars = await dailyBars(env);
  if (!bars.length) return 0;
  let scored = 0;
  for (const plan of results) {
    const bar = bars.find((candidate) => candidate.date === plan.date);
    if (!bar || bar.date >= utcToday) continue;
    const atr = atrBefore(bars, plan.date);
    if (atr === null) continue;
    const graded = scoreRead({ call: plan.bias, priceAtCall: plan.price_at_call as number, invalidationPrice: plan.invalidation_price, bar, atr });
    await env.DB.prepare(
      "UPDATE day_plans SET scored_at = ?, settle_close = ?, settle_high = ?, settle_low = ?, atr = ?, result = ?, invalidated = ? WHERE date = ? AND scored_at IS NULL",
    ).bind(now.toISOString(), bar.close, bar.high, bar.low, Math.round(atr * 100) / 100, graded.result, graded.invalidated ? 1 : 0, plan.date).run();
    scored++;
  }
  return scored;
}
