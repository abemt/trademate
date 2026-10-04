import assert from "node:assert/strict";
import test from "node:test";
import { autoGateLines, gateLabel, gateMissing, normalizeGate } from "../shared/gate";
import { habitLines, habitStreak, validateHabit, weekRate } from "../shared/habits";
import { traderContext } from "../worker/context";
import { authedFetch, fixture } from "./fixture";

test("gate: only the seven known lines count, each once, in order", () => {
  assert.deepEqual(normalizeGate(["close", "level", "close", "bogus", 3]), ["level", "close"]);
  assert.equal(gateLabel(["level", "touch", "close", "stop", "target", "state", "first"], 7), "A+ 7/7");
  assert.equal(gateLabel(["level", "touch", "close", "stop"], 4), "Half-setup 4/7 · missing 5, 6, 7");
  assert.equal(gateLabel([], null), null, "older trades were never graded");
  assert.deepEqual(gateMissing(["level"]).map((line) => line.n), [2, 3, 4, 5, 6, 7]);
});

test("gate: the ticket computes target, state and first; a wide stop fails line 4", () => {
  assert.deepEqual(autoGateLines({ plannedR: 2.3, stopPips: 59, urgeBefore: 1, tradesToday: 0 }), { target: true, state: true, first: true, stopTooWide: false });
  assert.deepEqual(autoGateLines({ plannedR: 1.9, stopPips: 145, urgeBefore: 2, tradesToday: 1 }), { target: false, state: false, first: false, stopTooWide: true });
  assert.equal(autoGateLines({ plannedR: null, stopPips: null, urgeBefore: null, tradesToday: null }).first, false, "unknown is not a pass");
});

test("gate: PUT /trades stores the passed lines and the score; Mate reads it", async () => {
  const { db, env } = fixture();
  // Mate only reads the active account's trades.
  db.exec("UPDATE accounts SET active = CASE WHEN id = 'gate-test' THEN 1 ELSE 0 END");
  const call = await authedFetch(env);
  const base = { account_id: "gate-test", instrument: "XAUUSD", direction: "short", status: "closed", pnl_usd: 200, r_multiple: 3.3, opened_at: "2026-10-01T13:41:00.000Z", closed_at: "2026-10-01T13:43:00.000Z", updated_at: new Date().toISOString(), entry_mode: "unplanned", unplanned_reason: "price came to my POI" };
  const half = await call("/trades", { method: "PUT", body: { trades: [{ ...base, id: "half-setup", gate: ["touch", "close", "stop", "target", "state", "junk"] }] } });
  assert.equal(half.status, 200, await half.clone().text());
  const row = db.prepare("SELECT gate, gate_score FROM trades WHERE id = 'half-setup'").get()!;
  assert.equal(row.gate, JSON.stringify(["touch", "close", "stop", "target", "state"]));
  assert.equal(row.gate_score, 5);
  // The offline queue sends the stored string form back; it round-trips without losing the score.
  const queued = await call("/trades", { method: "PUT", body: { trades: [{ ...base, id: "half-setup", gate: row.gate, gate_score: 5, updated_at: new Date(Date.now() + 1000).toISOString() }] } });
  assert.equal(queued.status, 200);
  assert.equal(db.prepare("SELECT gate_score FROM trades WHERE id = 'half-setup'").get()!.gate_score, 5);
  const ungraded = await call("/trades", { method: "PUT", body: { trades: [{ ...base, id: "legacy", opened_at: "2026-09-17T06:28:00.000Z" }] } });
  assert.equal(ungraded.status, 200);
  assert.equal(db.prepare("SELECT gate_score FROM trades WHERE id = 'legacy'").get()!.gate_score, null);
  const context = await traderContext(env);
  assert.match(context, /gate:Half-setup 5\/7 · missing 1, 7/);
  assert.match(context, /THE A\+ GATE/);
});

test("habits: validation, streaks and the week rate", () => {
  assert.equal(validateHabit({ id: "hab-wake", label: "  Up at 07:30 ", kind: "do", time_hint: "07:30", sort: 10 }).label, "Up at 07:30");
  for (const bad of [{ id: "bad id" }, { label: "x" }, { kind: "maybe" }]) {
    assert.throws(() => validateHabit({ id: "hab-ok", label: "Read 20 pages", kind: "do", ...bad }), `accepted ${JSON.stringify(bad)}`);
  }
  const days = [
    { date: "2026-10-04", habit_id: "a", done: 1, updated_at: "" },
    { date: "2026-10-03", habit_id: "a", done: 1, updated_at: "" },
    { date: "2026-10-01", habit_id: "a", done: 1, updated_at: "" },
    { date: "2026-10-03", habit_id: "b", done: 1, updated_at: "" },
  ];
  assert.equal(habitStreak(days, "a", "2026-10-04"), 2);
  assert.equal(habitStreak(days, "b", "2026-10-04"), 1, "today still open — the streak counts back from yesterday");
  assert.deepEqual(weekRate(days, [{ id: "a", archived: 0 }, { id: "b", archived: 0 }, { id: "c", archived: 1 }], "2026-10-04"), { done: 4, possible: 14, pct: 29 });
  const lines = habitLines([{ id: "a", label: "No nap", kind: "avoid", time_hint: "day", sort: 1, archived: 0, created_at: "", updated_at: "" }], days, "2026-10-04");
  assert.match(lines, /No nap \(day\): today KEPT · 3\/7 this week · streak 2/);
});

test("habits: API lists the seeded Sunday list, saves a new line, ticks a day, archives", async () => {
  const { db, env } = fixture();
  const call = await authedFetch(env);
  const seeded = await (await call("/habits")).json();
  assert.ok(seeded.habits.length >= 10, "the migration seeds the Sunday list");
  assert.equal((await call("/habits", { method: "PUT", body: { id: "hab-read", label: "R", kind: "do" } })).status, 400);
  const saved = await call("/habits", { method: "PUT", body: { id: "hab-read", label: "Read 20 pages", kind: "do", time_hint: "evening", sort: 110 } });
  assert.equal(saved.status, 200, await saved.clone().text());
  assert.equal((await call("/habits/days", { method: "PUT", body: { date: "2026-10-04", habit_id: "hab-read", done: 2 } })).status, 400);
  assert.equal((await call("/habits/days", { method: "PUT", body: { date: "2026-10-04", habit_id: "hab-missing", done: 1 } })).status, 404);
  const today = new Date().toISOString().slice(0, 10);
  assert.equal((await call("/habits/days", { method: "PUT", body: { date: today, habit_id: "hab-read", done: 1 } })).status, 200);
  assert.equal((await call("/habits/days", { method: "PUT", body: { date: today, habit_id: "hab-wake", done: 1 } })).status, 200);
  const listed = await (await call("/habits?days=7")).json();
  assert.equal(listed.days.filter((d: { done: number }) => d.done === 1).length, 2);
  const context = await traderContext(env);
  assert.match(context, /Day structure .*: 2\/\d+ ticks in the last 7 days/);
  assert.match(context, /Read 20 pages \(evening\): today DONE/);
  assert.equal((await call("/habits/hab-read", { method: "PATCH", body: { archived: 1 } })).status, 200);
  assert.equal(db.prepare("SELECT archived FROM habits WHERE id = 'hab-read'").get()!.archived, 1);
  assert.doesNotMatch(await traderContext(env), /Read 20 pages/);
});
