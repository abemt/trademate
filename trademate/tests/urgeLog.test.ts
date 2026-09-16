import assert from "node:assert/strict";
import test from "node:test";
import { summarizeUrges, validateUrge } from "../shared/urges";
import { traderContext } from "../worker/context";
import { authedFetch, fixture } from "./fixture";

const entry = {
  id: "11111111-2222-4333-8444-555555555555", domain: "trading", intensity: 4,
  sentence: "One loss won't take me anywhere", feeling: "down $100, want it back", outcome: "pending", instead: null,
};

test("an urge entry needs where, how strong and an outcome; text is trimmed and optional", () => {
  assert.equal(validateUrge(entry).sentence, entry.sentence);
  assert.equal(validateUrge({ ...entry, feeling: "   " }).feeling, null);
  for (const bad of [{ domain: "work" }, { intensity: 0 }, { intensity: 3.5 }, { outcome: "maybe" }, { id: "x" }, { sentence: 5 }]) {
    assert.throws(() => validateUrge({ ...entry, ...bad }), `accepted ${JSON.stringify(bad)}`);
  }
});

test("summary counts catches vs slips and surfaces the most used permission sentence", () => {
  const rows = [
    { ...entry, id: "a", outcome: "resisted", created_at: "", updated_at: "" },
    { ...entry, id: "b", outcome: "resisted", created_at: "", updated_at: "", domain: "gaming" },
    { ...entry, id: "c", outcome: "acted", created_at: "", updated_at: "", sentence: "Just one more" },
    { ...entry, id: "d", outcome: "pending", created_at: "", updated_at: "" },
  ] as Parameters<typeof summarizeUrges>[0];
  const s = summarizeUrges(rows);
  assert.deepEqual([s.total, s.resisted, s.acted, s.pending, s.catchRate], [4, 2, 1, 1, 67]);
  assert.equal(s.topSentence?.text, entry.sentence);
  assert.deepEqual(s.byDomain, { trading: 3, gaming: 1 });
  assert.equal(summarizeUrges([]).catchRate, null);
});

test("API stores the catch, updates the outcome, rejects garbage, and Mate sees it", async () => {
  const { db, env } = fixture();
  const call = await authedFetch(env);
  assert.equal((await call("/urges", { method: "PUT", body: { ...entry, intensity: 9 } })).status, 400);
  const saved = await call("/urges", { method: "PUT", body: { ...entry, created_at: "2099-01-01T00:00:00.000Z" } });
  assert.equal(saved.status, 200, await saved.clone().text());
  const row = (await saved.json()).urge;
  assert.ok(Date.parse(row.created_at) <= Date.now(), "future client timestamps are replaced with server time");
  assert.equal(row.outcome, "pending");
  const patched = await call(`/urges/${entry.id}`, { method: "PATCH", body: { outcome: "resisted", instead: "walked to the kitchen" } });
  assert.equal((await patched.json()).urge.outcome, "resisted");
  assert.equal((await call(`/urges/${entry.id}`, { method: "PATCH", body: { outcome: "nope" } })).status, 400);
  const list = await (await call("/urges?days=7")).json();
  assert.equal(list.urges.length, 1);
  assert.equal(list.urges[0].instead, "walked to the kitchen");
  const context = await traderContext(env);
  assert.match(context, /Autopilot catch log[\s\S]*walked away 1/);
  assert.match(context, /One loss won't take me anywhere/);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM urge_log").get()!.n, 1, "upsert by id, no duplicate");
});
