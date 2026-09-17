import assert from "node:assert/strict";
import test from "node:test";
import { atrBefore, lineCrossed, readConflict, scoreRead, structureOnlyProblem, summarizeReads, type DailyBar } from "../shared/biasCall";
import { traderContext } from "../worker/context";
import { scoreDayPlans } from "../worker/price";
import { authedFetch, fixture } from "./fixture";

test("the read must talk about price, not news", () => {
  assert.equal(structureOnlyProblem("4H broke above 4340 and is pulling back into it"), null);
  assert.equal(structureOnlyProblem("bearish day because the Fed hiked"), "Fed");
  assert.equal(structureOnlyProblem("fundamentally gold is under pressure"), "fundamentally");
  assert.equal(structureOnlyProblem("yields dropping so gold up"), "yields");
  assert.equal(structureOnlyProblem("price is forward-testing the range"), null, "word boundaries: no false hit inside other words");
  assert.equal(structureOnlyProblem(null), null);
  assert.match(readConflict("up", "bearish") ?? "", /higher highs/);
  assert.match(readConflict("down", "bullish") ?? "", /lower highs/);
  for (const [trend, call] of [["up", "bullish"], ["down", "bearish"], ["range", "bearish"], ["up", "no_trade"], [null, "bearish"]] as const) {
    assert.equal(readConflict(trend, call), null, `${trend}/${call} is allowed`);
  }
});

function bars(): DailyBar[] {
  const out: DailyBar[] = [];
  for (let i = 1; i <= 16; i++) {
    const base = 4000 + i * 10;
    out.push({ date: `2026-09-${String(i).padStart(2, "0")}`, open: base, high: base + 20, low: base - 20, close: base + 5 });
  }
  return out;
}

test("ATR uses only bars before the graded day and needs some history", () => {
  const atr = atrBefore(bars(), "2026-09-16");
  assert.ok(atr !== null && atr > 39 && atr < 41, `true range of these bars is ~40, got ${atr}`);
  assert.equal(atrBefore(bars().slice(0, 2), "2026-09-16"), null);
});

test("direction reads need a real move; a no-trade read is right when the day goes nowhere; the line is checked against the range", () => {
  const atr = 40;
  const bull = (close: number, low = close - 5) => scoreRead({ call: "bullish", priceAtCall: 4300, invalidationPrice: 4280, bar: { close, high: close + 5, low }, atr });
  assert.equal(bull(4320).result, "right");
  assert.equal(bull(4285).result, "wrong");
  assert.equal(bull(4303).result, "flat");
  assert.equal(bull(4320, 4275).invalidated, true, "closed up but the line was touched first");
  const bear = scoreRead({ call: "bearish", priceAtCall: 4300, invalidationPrice: 4356, bar: { close: 4398, high: 4402, low: 4296 }, atr });
  assert.deepEqual([bear.result, bear.invalidated], ["wrong", true]);
  const flatDay = scoreRead({ call: "no_trade", priceAtCall: 4300, invalidationPrice: null, bar: { close: 4308, high: 4320, low: 4290 }, atr });
  assert.equal(flatDay.result, "right");
  const trendDay = scoreRead({ call: "no_trade", priceAtCall: 4300, invalidationPrice: null, bar: { close: 4340, high: 4345, low: 4298 }, atr });
  assert.equal(trendDay.result, "wrong");
  assert.equal(lineCrossed("bearish", 4356, 4363), true);
  assert.equal(lineCrossed("bullish", 4280, 4290), false);
  assert.equal(lineCrossed("no_trade", 4280, 4200), false);
});

test("scorecard counts decided reads, flat days and crossed lines, and knows the current streak", () => {
  const card = summarizeReads([
    { date: "2026-09-17", result: "wrong", invalidated: 1 },
    { date: "2026-09-16", result: "flat", invalidated: 0 },
    { date: "2026-09-15", result: "wrong", invalidated: 1 },
    { date: "2026-09-14", result: "right", invalidated: 0 },
    { date: "2026-09-11", result: null, invalidated: 0 },
  ]);
  assert.deepEqual([card.scored, card.right, card.wrong, card.flat, card.invalidated, card.pct], [4, 1, 2, 1, 2, 33]);
  assert.deepEqual(card.streak, { result: "wrong", length: 2 });
  assert.equal(summarizeReads([]).pct, null);
});

test("API: a read locks with the live price, rejects news, ignores later edits to the call, and is graded from the next day", async () => {
  const { db, env } = fixture();
  env.TWELVEDATA_API_KEY = "test-key";
  const realFetch = globalThis.fetch;
  const history = bars();
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/price?")) return new Response(JSON.stringify({ price: "4300.5" }));
    if (url.includes("/time_series")) {
      return new Response(JSON.stringify({ values: [...history].reverse().map((bar) => ({ datetime: bar.date, open: String(bar.open), high: String(bar.high), low: String(bar.low), close: String(bar.close) })) }));
    }
    return realFetch(input);
  }) as typeof fetch;
  try {
    const call = await authedFetch(env);
    const rejected = await call("/dayplan", { method: "POST", body: { date: "2026-09-16", bias: "bearish", trend: "down", narrative: "bearish day, the Fed hiked", invalidation_price: 4356 } });
    assert.equal(rejected.status, 400);
    assert.match((await rejected.json()).error, /Fed/);
    assert.equal((await call("/dayplan", { method: "POST", body: { date: "2026-09-16", bias: "bearish", trend: "up", narrative: "higher highs but I want to sell the top", invalidation_price: 4356 } })).status, 400, "a call against the named structure is refused");
    assert.equal((await call("/dayplan", { method: "POST", body: { date: "2026-09-16", bias: "bearish", trend: "down", narrative: "lower highs on 4H, pulled back to 4340", invalidation_price: 4356 } })).status, 200);
    const noLine = await call("/dayplan", { method: "POST", body: { date: "2026-09-15", bias: "bullish", trend: "up", narrative: "higher lows holding above 4240" } });
    assert.equal(noLine.status, 400, "a directional read without a line is refused");
    const saved = (await (await call("/dayplan?date=2026-09-16")).json()).plan;
    assert.equal(saved.price_at_call, 4300.5);
    assert.ok(saved.called_at);
    const flipped = await call("/dayplan", { method: "POST", body: { date: "2026-09-16", bias: "bullish", trend: "up", narrative: "actually it is going up", invalidation_price: 4200, review: "stayed out" } });
    const after = (await flipped.json()).plan;
    assert.deepEqual([after.bias, after.trend, after.invalidation_price, after.review], ["bearish", "down", 4356, "stayed out"], "the call is locked; only the review moved");
    // 2026-09-16 bar: close 4165, high 4180, low 4140 relative to a 4300.5 call → bearish read right, line never touched.
    // The GET above already graded it lazily, so an explicit pass has nothing left to do.
    assert.equal(await scoreDayPlans(env, new Date("2026-09-17T06:00:00Z")), 0, "already graded when the app looked at it");
    const row = db.prepare("SELECT result, invalidated, settle_close, atr, scored_at FROM day_plans WHERE date = '2026-09-16'").get() as { result: string; invalidated: number; settle_close: number; atr: number; scored_at: string };
    assert.deepEqual([row.result, row.invalidated, row.settle_close], ["right", 0, 4165]);
    assert.ok(row.atr > 0 && row.scored_at);
    // A read written straight into the table is picked up by the cron pass.
    db.prepare("INSERT INTO day_plans (date, bias, trend, narrative, invalidation_price, price_at_call, called_at) VALUES ('2026-09-15','bullish','up','higher lows',4120,4100,'2026-09-15T06:00:00Z')").run();
    assert.equal(await scoreDayPlans(env, new Date("2026-09-16T12:00:00Z")), 1);
    assert.equal((db.prepare("SELECT result FROM day_plans WHERE date = '2026-09-15'").get() as { result: string }).result, "right");
    const list = (await (await call("/dayplan/history?limit=5")).json()).plans;
    assert.equal(list[0].result, "right");
    // Mate sees today's locked read and the crossed line when spot is past it.
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Addis_Ababa" }).format(new Date());
    assert.equal((await call("/dayplan", { method: "POST", body: { date: today, bias: "bearish", trend: "down", narrative: "lower highs on the 4H into 4300", invalidation_price: 4290 } })).status, 200);
    const context = await traderContext(env);
    assert.match(context, /MORNING READ locked/);
    assert.match(context, /LINE \(4290\) HAS BEEN CROSSED/);
    assert.match(context, /Morning-read scorecard \(last 2 graded days\): 2 right, 0 wrong/);
  } finally {
    globalThis.fetch = realFetch;
  }
});
