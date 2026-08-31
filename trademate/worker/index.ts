import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";
import { MATE_PERSONA, callAI, parseAIJson, type AIImage, type AIMessage } from "./ai";
import {
  DEFAULT_PROFILE,
  getProfile,
  localDate,
  traderContext,
  type Env,
} from "./context";
import { generateBriefing, scanNews, weeklyReport } from "./market";
import { pushAll } from "./push";

const COOKIE = "tm_session";
const SESSION_DAYS = 30;

/** Constant-time string comparison (single-user passcode check). */
function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}

const app = new Hono<{ Bindings: Env }>().basePath("/api");

// ---------- public routes ----------

app.get("/health", (c) =>
  c.json({ ok: true, service: "trademate", time: new Date().toISOString() }),
);

app.post("/auth/login", async (c) => {
  const body = await c.req
    .json<{ passcode?: string }>()
    .catch(() => ({}) as { passcode?: string });
  const passcode = body.passcode ?? "";
  if (!c.env.PASSCODE || !passcode || !timingSafeEqual(passcode, c.env.PASSCODE)) {
    return c.json({ error: "Wrong passcode" }, 401);
  }
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await sign({ sub: "trader", exp }, c.env.JWT_SECRET);
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    // Secure in production (always https behind Cloudflare); plain http in local dev.
    secure: new URL(c.req.url).protocol === "https:",
    sameSite: "Strict",
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  return c.json({ ok: true });
});

app.post("/auth/logout", (c) => {
  deleteCookie(c, COOKIE, { path: "/" });
  return c.json({ ok: true });
});

app.get("/auth/me", async (c) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ authed: false });
  try {
    await verify(token, c.env.JWT_SECRET, "HS256");
    return c.json({ authed: true });
  } catch {
    return c.json({ authed: false });
  }
});

// ---------- auth wall: everything registered below requires a session ----------

app.use("*", async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) return c.json({ error: "Unauthorized" }, 401);
  try {
    await verify(token, c.env.JWT_SECRET, "HS256");
  } catch {
    return c.json({ error: "Unauthorized" }, 401);
  }
  return next();
});

// ---------- protected routes ----------

app.get("/profile", async (c) => {
  try {
    const row = await c.env.DB.prepare("SELECT * FROM profile WHERE id = 1").first();
    if (row) return c.json({ profile: row, source: "d1" });
  } catch {
    // D1 not created/migrated yet — fall back to defaults below.
  }
  return c.json({ profile: DEFAULT_PROFILE, source: "defaults" });
});

// ---------- trades (journal) ----------

const TRADE_FIELDS = [
  "id", "instrument", "direction", "setup_type", "entry_trigger", "session", "timeframe",
  "entry_price", "sl_price", "tp_price", "exit_price", "sl_pips", "lots", "risk_usd",
  "risk_pct", "pnl_usd", "r_multiple", "outcome", "status", "emotions", "screenshots",
  "followed_plan", "notes", "opened_at", "closed_at", "updated_at", "deleted",
  "body_before", "urge_before", "body_during", "exit_feeling", "autopilot",
  "account_id", "feeling_note", "setup_grade", "execution_quality", "confluences", "mistakes",
  "plan_id", "plan_setup", "plan_entry", "lesson",
] as const;

const UPSERT_TRADE_SQL = `
INSERT INTO trades (${TRADE_FIELDS.join(",")})
VALUES (${TRADE_FIELDS.map(() => "?").join(",")})
ON CONFLICT(id) DO UPDATE SET
${TRADE_FIELDS.filter((f) => f !== "id").map((f) => `${f}=excluded.${f}`).join(",")}
WHERE excluded.updated_at >= trades.updated_at`;

function cleanTrade(x: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof x.id !== "string" || x.id.length === 0 || x.id.length > 64) return null;
  if (x.direction !== "long" && x.direction !== "short") return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const scale5 = (v: unknown) =>
    typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
  const str = (v: unknown, max: number) =>
    typeof v === "string" && v.length > 0 ? v.slice(0, max) : null;
  let emotions = "[]";
  if (typeof x.emotions === "string") emotions = x.emotions.slice(0, 500);
  else if (Array.isArray(x.emotions)) {
    emotions = JSON.stringify(x.emotions.filter((e) => typeof e === "string").slice(0, 12));
  }
  let screenshots = "[]";
  if (typeof x.screenshots === "string") screenshots = x.screenshots.slice(0, 2000);
  else if (Array.isArray(x.screenshots)) {
    screenshots = JSON.stringify(
      x.screenshots.filter((e) => typeof e === "string").slice(0, 6),
    );
  }
  const strArr = (v: unknown, max: number) => {
    if (typeof v === "string") return v.slice(0, 800);
    if (Array.isArray(v)) return JSON.stringify(v.filter((e) => typeof e === "string").slice(0, max));
    return "[]";
  };
  const now = new Date().toISOString();
  return {
    id: x.id,
    instrument: str(x.instrument, 20) ?? "XAUUSD",
    direction: x.direction,
    setup_type: str(x.setup_type, 40),
    entry_trigger: str(x.entry_trigger, 40),
    session: str(x.session, 20),
    timeframe: str(x.timeframe, 10),
    entry_price: num(x.entry_price),
    sl_price: num(x.sl_price),
    tp_price: num(x.tp_price),
    exit_price: num(x.exit_price),
    sl_pips: num(x.sl_pips),
    lots: num(x.lots),
    risk_usd: num(x.risk_usd),
    risk_pct: num(x.risk_pct),
    pnl_usd: num(x.pnl_usd),
    r_multiple: num(x.r_multiple),
    outcome:
      x.outcome === "win" || x.outcome === "loss" || x.outcome === "breakeven"
        ? x.outcome
        : null,
    status: x.status === "closed" ? "closed" : "open",
    emotions,
    screenshots,
    followed_plan: x.followed_plan === 1 || x.followed_plan === 0 ? x.followed_plan : null,
    notes: str(x.notes, 4000),
    opened_at: str(x.opened_at, 40) ?? now,
    closed_at: str(x.closed_at, 40),
    updated_at: str(x.updated_at, 40) ?? now,
    deleted: x.deleted ? 1 : 0,
    body_before: scale5(x.body_before),
    urge_before: scale5(x.urge_before),
    body_during: scale5(x.body_during),
    exit_feeling: str(x.exit_feeling, 20),
    autopilot: x.autopilot === 1 || x.autopilot === 0 ? x.autopilot : null,
    account_id: str(x.account_id, 64),
    feeling_note: str(x.feeling_note, 2000),
    setup_grade: str(x.setup_grade, 4),
    execution_quality: str(x.execution_quality, 12),
    confluences: strArr(x.confluences, 10),
    mistakes: strArr(x.mistakes, 10),
    plan_id: str(x.plan_id, 64),
    plan_setup: str(x.plan_setup, 1000),
    plan_entry: str(x.plan_entry, 1000),
    lesson: str(x.lesson, 2000),
  };
}

// ---------- pre-session routine ----------

app.get("/dayplan", async (c) => {
  const date = c.req.query("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ plan: null });
  try {
    const row = await c.env.DB.prepare("SELECT * FROM day_plans WHERE date = ?")
      .bind(date)
      .first();
    return c.json({ plan: row ?? null });
  } catch {
    return c.json({ plan: null });
  }
});

app.post("/dayplan", async (c) => {
  const b = await c.req
    .json<{ date?: string; bias?: string; narrative?: string; must_see?: string; invalidation?: string; no_trade?: string; review?: string }>()
    .catch(() => null);
  if (!b?.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) return c.json({ error: "date required" }, 400);
  const s = (v: unknown, max: number) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
  const bias = ["bullish", "bearish", "neutral", "both"].includes(b.bias ?? "") ? b.bias : null;
  await c.env.DB.prepare(
    `INSERT INTO day_plans (date, bias, narrative, must_see, invalidation, no_trade, review, updated_at)
     VALUES (?,?,?,?,?,?,?,datetime('now'))
     ON CONFLICT(date) DO UPDATE SET bias=excluded.bias, narrative=excluded.narrative, must_see=excluded.must_see,
       invalidation=excluded.invalidation, no_trade=excluded.no_trade, review=excluded.review, updated_at=excluded.updated_at`,
  )
    .bind(b.date, bias, s(b.narrative, 2000), s(b.must_see, 2000), s(b.invalidation, 1000), s(b.no_trade, 1000), s(b.review, 2000))
    .run();
  return c.json({ ok: true });
});

app.get("/routine", async (c) => {
  const date = c.req.query("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return c.json({ routine: null });
  try {
    const row = await c.env.DB.prepare("SELECT * FROM routine_days WHERE date = ?")
      .bind(date)
      .first();
    return c.json({ routine: row ?? null });
  } catch {
    return c.json({ routine: null });
  }
});

app.post("/routine", async (c) => {
  const b = await c.req
    .json<{ date?: string; done?: unknown[]; note?: string }>()
    .catch(() => null);
  if (!b?.date || !/^\d{4}-\d{2}-\d{2}$/.test(b.date)) {
    return c.json({ error: "date required" }, 400);
  }
  const done = JSON.stringify(
    Array.isArray(b.done) ? b.done.filter((x) => typeof x === "string").slice(0, 12) : [],
  );
  const note = typeof b.note === "string" && b.note ? b.note.slice(0, 1000) : null;
  await c.env.DB.prepare(
    "INSERT INTO routine_days (date, done, note) VALUES (?,?,?) ON CONFLICT(date) DO UPDATE SET done = excluded.done, note = excluded.note",
  )
    .bind(b.date, done, note)
    .run();
  return c.json({ ok: true });
});

// ---------- briefing accuracy ----------

app.get("/briefing/accuracy", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT key, json FROM briefings WHERE kind = 'daily' ORDER BY key ASC LIMIT 60",
    ).all<{ key: string; json: string }>();
    const days = results
      .map((r) => {
        try {
          const b = JSON.parse(r.json) as { price?: number | null; analysis?: { bias?: string } };
          return { key: r.key, price: b.price ?? null, bias: (b.analysis?.bias ?? "neutral").toLowerCase() };
        } catch {
          return null;
        }
      })
      .filter((d): d is { key: string; price: number | null; bias: string } => !!d && d.price !== null);
    // A call is graded against the move to the NEXT morning's price.
    let hits = 0;
    let calls = 0;
    for (let i = 0; i < days.length - 1; i++) {
      const bias = days[i].bias;
      if (bias !== "bullish" && bias !== "bearish") continue;
      const delta = (days[i + 1].price as number) - (days[i].price as number);
      if (Math.abs(delta) < 0.01) continue;
      calls++;
      if ((bias === "bullish" && delta > 0) || (bias === "bearish" && delta < 0)) hits++;
    }
    return c.json({ calls, hits, pct: calls > 0 ? Math.round((100 * hits) / calls) : null });
  } catch {
    return c.json({ calls: 0, hits: 0, pct: null });
  }
});

// ---------- playbook (trade plans) ----------

app.get("/plans", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM plans WHERE archived = 0 ORDER BY created_at ASC",
    ).all();
    return c.json({ plans: results });
  } catch {
    return c.json({ plans: [] });
  }
});

app.post("/plans", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b) return c.json({ error: "Bad payload" }, 400);
  const name =
    typeof b.name === "string" && b.name.trim() ? b.name.trim().slice(0, 80) : null;
  if (!name) return c.json({ error: "Plan name required" }, 400);
  const arr = (v: unknown, max: number) =>
    JSON.stringify(
      Array.isArray(v)
        ? v.filter((x) => typeof x === "string" && x.trim()).map((x) => (x as string).slice(0, 200)).slice(0, max)
        : [],
    );
  const txt = (v: unknown, max: number) =>
    typeof v === "string" && v.trim() ? v.slice(0, max) : null;
  const id =
    typeof b.id === "string" && b.id ? b.id.slice(0, 64) : `plan-${crypto.randomUUID().slice(0, 8)}`;
  await c.env.DB.prepare(
    `INSERT INTO plans (id, name, plan_type, charting_process, entry_criteria, management_rules, exit_criteria, notes, screenshots)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, plan_type=excluded.plan_type,
       charting_process=excluded.charting_process, entry_criteria=excluded.entry_criteria,
       management_rules=excluded.management_rules, exit_criteria=excluded.exit_criteria,
       notes=excluded.notes, screenshots=excluded.screenshots, updated_at=datetime('now')`,
  )
    .bind(
      id,
      name,
      txt(b.plan_type, 60),
      arr(b.charting_process, 10),
      arr(b.entry_criteria, 10),
      txt(b.management_rules, 2000),
      arr(b.exit_criteria, 10),
      txt(b.notes, 2000),
      arr(b.screenshots, 4),
    )
    .run();
  return c.json({ id });
});

app.post("/plans/archive", async (c) => {
  const b = await c.req.json<{ id?: string }>().catch(() => null);
  if (!b?.id) return c.json({ error: "id required" }, 400);
  await c.env.DB.prepare("UPDATE plans SET archived = 1 WHERE id = ?").bind(b.id).run();
  return c.json({ ok: true });
});

// ---------- notebook ----------

app.get("/notes", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT id, kind, title, body, updated_at FROM notes ORDER BY updated_at DESC LIMIT 200",
    ).all();
    return c.json({ notes: results });
  } catch {
    return c.json({ notes: [] });
  }
});

app.post("/notes", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b) return c.json({ error: "Bad payload" }, 400);
  const id =
    typeof b.id === "string" && b.id ? b.id.slice(0, 64) : `note-${crypto.randomUUID().slice(0, 8)}`;
  const kind = ["daily", "weekly", "monthly", "free"].includes(String(b.kind))
    ? String(b.kind)
    : "free";
  const title =
    typeof b.title === "string" && b.title.trim() ? b.title.trim().slice(0, 120) : "Untitled";
  const bodyTxt = typeof b.body === "string" ? b.body.slice(0, 20000) : "";
  await c.env.DB.prepare(
    `INSERT INTO notes (id, kind, title, body) VALUES (?,?,?,?)
     ON CONFLICT(id) DO UPDATE SET kind=excluded.kind, title=excluded.title, body=excluded.body, updated_at=datetime('now')`,
  )
    .bind(id, kind, title, bodyTxt)
    .run();
  return c.json({ id });
});

app.post("/notes/delete", async (c) => {
  const b = await c.req.json<{ id?: string }>().catch(() => null);
  if (!b?.id) return c.json({ error: "id required" }, 400);
  await c.env.DB.prepare("DELETE FROM notes WHERE id = ?").bind(b.id).run();
  return c.json({ ok: true });
});

// ---------- accounts ----------

const ACCOUNT_TYPES = ["personal", "prop_eval", "prop_funded", "demo"];

app.get("/accounts", async (c) => {
  try {
    const { results } = await c.env.DB.prepare(
      "SELECT * FROM accounts ORDER BY archived ASC, active DESC, created_at ASC",
    ).all();
    return c.json({ accounts: results });
  } catch {
    return c.json({ accounts: [] });
  }
});

app.post("/accounts", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  const label =
    b && typeof b.label === "string" && b.label.trim() ? b.label.trim().slice(0, 60) : null;
  if (!label) return c.json({ error: "Label required" }, 400);
  const type = ACCOUNT_TYPES.includes(String(b?.type)) ? String(b?.type) : "personal";
  const start =
    typeof b?.starting_balance === "number" && Number.isFinite(b.starting_balance)
      ? b.starting_balance
      : 0;
  const id = `acc-${crypto.randomUUID().slice(0, 8)}`;
  await c.env.DB.prepare("UPDATE accounts SET active = 0").run();
  await c.env.DB.prepare(
    "INSERT INTO accounts (id, label, type, starting_balance, active) VALUES (?,?,?,?,1)",
  )
    .bind(id, label, type, start)
    .run();
  return c.json({ id });
});

app.post("/accounts/activate", async (c) => {
  const b = await c.req.json<{ id?: string }>().catch(() => null);
  if (!b?.id) return c.json({ error: "id required" }, 400);
  await c.env.DB.prepare("UPDATE accounts SET active = 0").run();
  await c.env.DB.prepare("UPDATE accounts SET active = 1, archived = 0 WHERE id = ?")
    .bind(b.id)
    .run();
  return c.json({ ok: true });
});

app.post("/accounts/archive", async (c) => {
  const b = await c.req.json<{ id?: string }>().catch(() => null);
  if (!b?.id) return c.json({ error: "id required" }, 400);
  const other = await c.env.DB.prepare(
    "SELECT id FROM accounts WHERE archived = 0 AND id != ? LIMIT 1",
  )
    .bind(b.id)
    .first<{ id: string }>();
  if (!other) return c.json({ error: "Add another account before archiving your only one" }, 400);
  const was = await c.env.DB.prepare("SELECT active FROM accounts WHERE id = ?")
    .bind(b.id)
    .first<{ active: number }>();
  await c.env.DB.prepare("UPDATE accounts SET archived = 1, active = 0 WHERE id = ?")
    .bind(b.id)
    .run();
  if (was?.active) {
    await c.env.DB.prepare("UPDATE accounts SET active = 1 WHERE id = ?").bind(other.id).run();
  }
  return c.json({ ok: true });
});

app.get("/trades", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM trades WHERE deleted = 0 ORDER BY opened_at DESC LIMIT 1000",
  ).all();
  return c.json({ trades: results });
});

app.put("/trades", async (c) => {
  const body = await c.req.json<{ trades?: unknown[] }>().catch(() => null);
  if (!body || !Array.isArray(body.trades) || body.trades.length === 0) {
    return c.json({ error: "No trades in payload" }, 400);
  }
  if (body.trades.length > 100) return c.json({ error: "Max 100 trades per request" }, 400);
  const rows = body.trades
    .map((t) => cleanTrade(t as Record<string, unknown>))
    .filter((r): r is Record<string, unknown> => r !== null);
  if (rows.length === 0) return c.json({ error: "No valid trades" }, 400);
  const stmt = c.env.DB.prepare(UPSERT_TRADE_SQL);
  await c.env.DB.batch(rows.map((r) => stmt.bind(...TRADE_FIELDS.map((f) => r[f]))));
  return c.json({ ok: true, count: rows.length });
});

// ---------- screenshots (stored as D1 blobs) ----------

function blobToBytes(data: unknown): Uint8Array | null {
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (Array.isArray(data)) return new Uint8Array(data as number[]);
  return null;
}

app.post("/screenshots", async (c) => {
  const ct = c.req.header("content-type") ?? "";
  if (!ct.startsWith("image/")) return c.json({ error: "Images only" }, 400);
  const buf = await c.req.arrayBuffer();
  if (buf.byteLength === 0) return c.json({ error: "Empty file" }, 400);
  if (buf.byteLength > 1.5 * 1024 * 1024) return c.json({ error: "Max 1.5 MB" }, 413);
  const ext = ct.includes("png") ? "png" : ct.includes("jpeg") ? "jpg" : "webp";
  const id = `${crypto.randomUUID()}.${ext}`;
  await c.env.DB.prepare("INSERT INTO blobs (id, mime, data) VALUES (?,?,?)")
    .bind(id, ct, buf)
    .run();
  return c.json({ id });
});

app.get("/screenshots/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[\w-]+\.(webp|png|jpg)$/.test(id)) return c.json({ error: "Bad id" }, 400);
  const row = await c.env.DB.prepare("SELECT mime, data FROM blobs WHERE id = ?")
    .bind(id)
    .first<{ mime: string; data: unknown }>();
  const bytes = row ? blobToBytes(row.data) : null;
  if (!row || !bytes) return c.json({ error: "Not found" }, 404);
  return new Response(bytes, {
    headers: {
      "Content-Type": row.mime || "image/webp",
      "Cache-Control": "private, max-age=31536000, immutable",
    },
  });
});

// ---------- Mate: chat ----------

app.get("/chat", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, role, content, created_at FROM chat_messages ORDER BY id DESC LIMIT 500",
  ).all();
  return c.json({ messages: (results as unknown[]).reverse() });
});

app.post("/chat", async (c) => {
  const body = await c.req.json<{ message?: string }>().catch(() => null);
  const message = body?.message?.trim();
  if (!message) return c.json({ error: "Empty message" }, 400);
  if (message.length > 4000) return c.json({ error: "Message too long" }, 400);

  await c.env.DB.prepare("INSERT INTO chat_messages (role, content) VALUES ('user', ?)")
    .bind(message)
    .run();

  const { results } = await c.env.DB.prepare(
    "SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 20",
  ).all();
  const history = (results as { role: "user" | "assistant"; content: string }[]).reverse();

  const ctx = await traderContext(c.env);
  const messages: AIMessage[] = [
    { role: "system", text: `${MATE_PERSONA}\n\n${ctx}` },
    ...history.map((m) => ({ role: m.role, text: m.content })),
  ];

  try {
    const reply = await callAI(c.env, messages, { maxTokens: 2048 });
    await c.env.DB.prepare("INSERT INTO chat_messages (role, content) VALUES ('assistant', ?)")
      .bind(reply)
      .run();
    return c.json({ reply });
  } catch (e) {
    return c.json({ error: `Mate couldn't reach the AI: ${String(e).slice(0, 200)}` }, 502);
  }
});

// ---------- Mate: setup analyzer ----------

const ANALYZE_CONTRACT = `Return STRICT JSON only, matching exactly:
{
  "grade": "A" | "B" | "C",
  "headline": "one honest sentence, friend voice",
  "checklist": [
    {"item": "HTF trend alignment", "pass": true, "note": "short reason"},
    {"item": "Zone quality", "pass": false, "note": "short reason"},
    {"item": "Structure break clean", "pass": true, "note": "short reason"},
    {"item": "Entry trigger quality", "pass": true, "note": "short reason"},
    {"item": "R:R at least 1:1.5", "pass": true, "note": "short reason"},
    {"item": "Regime fit (choppy)", "pass": false, "note": "short reason"}
  ],
  "likes": ["1-3 things that are genuinely good"],
  "concerns": ["1-3 honest worries"],
  "alternative": "a better play on this same chart, or null",
  "verdict": "1-2 sentences: what you'd tell him over the shoulder. Grade A = textbook, B = decent but flawed, C = skip it."
}`;

app.post("/analyze", async (c) => {
  const body = await c.req
    .json<{
      images?: string[];
      direction?: string;
      setup_type?: string;
      timeframe?: string;
      entry?: string;
      sl?: string;
      tp?: string;
      notes?: string;
      plan_id?: string;
    }>()
    .catch(() => null);
  if (!body) return c.json({ error: "Bad payload" }, 400);
  const imageIds = (body.images ?? []).filter((s) => typeof s === "string").slice(0, 3);
  if (imageIds.length === 0 && !body.notes?.trim()) {
    return c.json({ error: "Add a chart screenshot or describe the idea" }, 400);
  }

  const images: AIImage[] = [];
  for (const id of imageIds) {
    if (!/^[\w-]+\.(webp|png|jpg)$/.test(id)) continue;
    const row = await c.env.DB.prepare("SELECT mime, data FROM blobs WHERE id = ?")
      .bind(id)
      .first<{ mime: string; data: unknown }>();
    const bytes = row ? blobToBytes(row.data) : null;
    if (!row || !bytes) continue;
    let bin = "";
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    images.push({
      mime: row.mime || "image/webp",
      dataB64: btoa(bin),
    });
  }

  const ctx = await traderContext(c.env);

  // Grade against his own written plan when one is selected.
  let planBlock = "";
  if (typeof body.plan_id === "string" && body.plan_id) {
    try {
      const p = await c.env.DB.prepare("SELECT * FROM plans WHERE id = ? AND archived = 0")
        .bind(body.plan_id.slice(0, 64))
        .first<Record<string, string | null>>();
      if (p) {
        const lines = (raw: string | null) => {
          try {
            const a = JSON.parse(raw ?? "[]");
            return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
          } catch {
            return [];
          }
        };
        const proc = lines(p.charting_process);
        const entry = lines(p.entry_criteria);
        const exits = lines(p.exit_criteria);
        planBlock = [
          `HIS WRITTEN TRADE PLAN — "${p.name}"${p.plan_type ? ` (${p.plan_type})` : ""}. Grade STRICTLY against it:`,
          proc.length ? `Charting process: ${proc.map((s, i) => `${i + 1}) ${s}`).join(" ")}` : "",
          entry.length
            ? `Entry criteria — the checklist array MUST use exactly these as its items (plus "R:R at least 1:1.5" and "Regime fit"): ${entry.join(" · ")}`
            : "",
          p.management_rules ? `Management rules: ${p.management_rules}` : "",
          exits.length ? `Exit criteria: ${exits.join(" · ")}` : "",
          p.notes ? `Plan notes: ${p.notes}` : "",
          "If the chart doesn't satisfy the plan's entry criteria, the grade cannot be A — a good trade outside the plan is still a broken plan.",
        ]
          .filter(Boolean)
          .join("\n");
      }
    } catch {
      // plans table may not exist yet
    }
  }

  const idea = [
    `Analyze this XAUUSD setup idea${images.length ? " from the attached chart screenshot(s)" : ""}.`,
    body.direction ? `Direction: ${body.direction}.` : "",
    body.setup_type ? `Setup type he's claiming: ${body.setup_type}.` : "",
    body.timeframe ? `Timeframe: ${body.timeframe}.` : "",
    body.entry ? `Entry: ${body.entry}.` : "",
    body.sl ? `SL: ${body.sl}.` : "",
    body.tp ? `TP: ${body.tp}.` : "",
    body.notes ? `His notes: ${body.notes}` : "",
    "",
    planBlock,
    "",
    "Be honest like a trader friend reviewing over his shoulder. Remember the regime is CHOPPY — penalize first-touch zone entries without confirmation. Verify his claimed setup actually exists on the chart.",
    ANALYZE_CONTRACT,
  ]
    .filter(Boolean)
    .join("\n");

  const messages: AIMessage[] = [
    { role: "system", text: `${MATE_PERSONA}\n\n${ctx}` },
    { role: "user", text: idea, images },
  ];

  try {
    const raw = await callAI(c.env, messages, { json: true, maxTokens: 1600, temperature: 0.5 });
    const analysis = parseAIJson<Record<string, unknown>>(raw);
    const id = crypto.randomUUID();
    await c.env.DB.prepare(
      "INSERT INTO setups (id, images, direction, setup_type, timeframe, entry, sl, tp, notes, ai_json) VALUES (?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        JSON.stringify(imageIds),
        body.direction ?? null,
        body.setup_type ?? null,
        body.timeframe ?? null,
        body.entry ?? null,
        body.sl ?? null,
        body.tp ?? null,
        body.notes ?? null,
        JSON.stringify(analysis),
      )
      .run();
    return c.json({ id, analysis });
  } catch (e) {
    return c.json({ error: `Analysis failed: ${String(e).slice(0, 200)}` }, 502);
  }
});

app.get("/setups", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT id, images, direction, setup_type, timeframe, ai_json, decision, created_at FROM setups ORDER BY created_at DESC LIMIT 15",
  ).all();
  return c.json({ setups: results });
});

app.patch("/setups/:id", async (c) => {
  const body = await c.req.json<{ decision?: string }>().catch(() => null);
  const decision = body?.decision === "taken" || body?.decision === "skipped" ? body.decision : null;
  if (!decision) return c.json({ error: "decision must be taken|skipped" }, 400);
  await c.env.DB.prepare("UPDATE setups SET decision = ? WHERE id = ?")
    .bind(decision, c.req.param("id"))
    .run();
  return c.json({ ok: true });
});

// ---------- daily briefing ----------

app.get("/briefing", async (c) => {
  const profile = await getProfile(c.env);
  const today = localDate(String(profile.timezone ?? "Africa/Addis_Ababa"));
  const row = await c.env.DB.prepare("SELECT json FROM briefings WHERE key = ?")
    .bind(`daily-${today}`)
    .first<{ json: string }>();
  return c.json({ briefing: row ? JSON.parse(row.json) : null });
});

app.post("/briefing", async (c) => {
  try {
    const briefing = await generateBriefing(c.env);
    return c.json({ briefing });
  } catch (e) {
    return c.json({ error: `Briefing failed: ${String(e).slice(0, 200)}` }, 502);
  }
});

// ---------- live news watch ----------

app.get("/newswatch", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT title, pub_date, severity, gold_impact, note, created_at FROM news_events ORDER BY id DESC LIMIT 20",
  ).all();
  return c.json({ events: results });
});

app.post("/newswatch/scan", async (c) => {
  try {
    const r = await scanNews(c.env);
    return c.json(r);
  } catch (e) {
    return c.json({ error: String(e).slice(0, 200) }, 502);
  }
});

// ---------- check-ins ----------

app.get("/checkins", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT date, mood, sleep, plan FROM checkins ORDER BY date DESC LIMIT 30",
  ).all();
  return c.json({ checkins: results });
});

app.post("/checkins", async (c) => {
  const body = await c.req
    .json<{ mood?: number; sleep?: number; plan?: string }>()
    .catch(() => null);
  if (!body) return c.json({ error: "Bad payload" }, 400);
  const clamp = (v: unknown) =>
    typeof v === "number" && v >= 1 && v <= 5 ? Math.round(v) : null;
  const profile = await getProfile(c.env);
  const today = localDate(String(profile.timezone ?? "Africa/Addis_Ababa"));
  await c.env.DB.prepare(
    "INSERT INTO checkins (date, mood, sleep, plan) VALUES (?,?,?,?) ON CONFLICT(date) DO UPDATE SET mood = excluded.mood, sleep = excluded.sleep, plan = excluded.plan",
  )
    .bind(
      today,
      clamp(body.mood),
      clamp(body.sleep),
      typeof body.plan === "string" ? body.plan.slice(0, 500) : null,
    )
    .run();
  return c.json({ ok: true, date: today });
});

// ---------- weekly coach report ----------

app.post("/coach/weekly", async (c) => {
  const body = await c.req.json<{ refresh?: boolean }>().catch(() => ({ refresh: false }));
  try {
    const report = await weeklyReport(c.env, Boolean(body?.refresh));
    return c.json({ report });
  } catch (e) {
    return c.json({ error: `Report failed: ${String(e).slice(0, 200)}` }, 502);
  }
});

// ---------- live price (90s edge cache to respect TwelveData free tier) ----------

app.get("/price", async (c) => {
  if (!c.env.TWELVEDATA_API_KEY) return c.json({ price: null });
  const cacheKey = new Request("https://cache.trademate.internal/price");
  try {
    const hit = await caches.default.match(cacheKey);
    if (hit) {
      const body = await hit.text();
      return new Response(body, {
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      });
    }
  } catch {
    // cache unavailable (workers.dev) — fall through
  }
  let price: number | null = null;
  try {
    const r = (await (
      await fetch(
        `https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${c.env.TWELVEDATA_API_KEY}`,
      )
    ).json()) as { price?: string };
    if (r.price) price = Number.parseFloat(r.price);
  } catch {
    // provider down
  }
  const payload = JSON.stringify({ price, at: new Date().toISOString() });
  try {
    await caches.default.put(
      cacheKey,
      new Response(payload, {
        headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=30" },
      }),
    );
  } catch {
    // cache unavailable
  }
  return new Response(payload, {
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
});

// ---------- zones ----------

app.get("/zones", async (c) => {
  const { results } = await c.env.DB.prepare(
    "SELECT * FROM zones WHERE active = 1 ORDER BY price_low DESC LIMIT 50",
  ).all();
  return c.json({ zones: results });
});

app.post("/zones", async (c) => {
  const b = await c.req
    .json<{ kind?: string; price_low?: number; price_high?: number; timeframe?: string; note?: string }>()
    .catch(() => null);
  if (!b || (b.kind !== "support" && b.kind !== "resistance")) {
    return c.json({ error: "kind must be support|resistance" }, 400);
  }
  const lo = typeof b.price_low === "number" && Number.isFinite(b.price_low) ? b.price_low : null;
  const hi = typeof b.price_high === "number" && Number.isFinite(b.price_high) ? b.price_high : lo;
  if (lo === null || hi === null) return c.json({ error: "Enter a price" }, 400);
  const id = crypto.randomUUID();
  await c.env.DB.prepare(
    "INSERT INTO zones (id, kind, price_low, price_high, timeframe, note) VALUES (?,?,?,?,?,?)",
  )
    .bind(
      id,
      b.kind,
      Math.min(lo, hi),
      Math.max(lo, hi),
      typeof b.timeframe === "string" ? b.timeframe.slice(0, 10) : null,
      typeof b.note === "string" && b.note.trim() ? b.note.trim().slice(0, 200) : null,
    )
    .run();
  return c.json({ ok: true, id });
});

app.delete("/zones/:id", async (c) => {
  await c.env.DB.prepare("DELETE FROM zones WHERE id = ?").bind(c.req.param("id")).run();
  return c.json({ ok: true });
});

// ---------- profile update (Settings) ----------

app.put("/profile", async (c) => {
  const b = await c.req.json<Record<string, unknown>>().catch(() => null);
  if (!b) return c.json({ error: "Bad payload" }, 400);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const num = (v: unknown, min: number, max: number) =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : undefined;

  if (typeof b.trader_name === "string" && b.trader_name.trim()) {
    sets.push("trader_name = ?");
    vals.push(b.trader_name.trim().slice(0, 40));
  }
  const acct = num(b.account_size, 10, 100_000_000);
  if (acct !== undefined) {
    sets.push("account_size = ?");
    vals.push(acct);
  }
  const maxT = num(b.max_trades_per_day, 1, 10);
  if (maxT !== undefined) {
    sets.push("max_trades_per_day = ?");
    vals.push(Math.round(maxT));
  }
  const phase = num(b.eval_phase, 1, 2);
  if (phase !== undefined) {
    sets.push("eval_phase = ?");
    vals.push(Math.round(phase));
  }
  const rMin = num(b.risk_pct_min, 0.1, 5);
  if (rMin !== undefined) {
    sets.push("risk_pct_min = ?");
    vals.push(rMin);
  }
  const rMax = num(b.risk_pct_max, 0.1, 10);
  if (rMax !== undefined) {
    sets.push("risk_pct_max = ?");
    vals.push(rMax);
  }
  if (b.market_regime === "choppy" || b.market_regime === "trending" || b.market_regime === "mixed") {
    sets.push("market_regime = ?");
    vals.push(b.market_regime);
  }
  if (sets.length === 0) return c.json({ error: "Nothing to update" }, 400);
  sets.push("updated_at = datetime('now')");
  await c.env.DB.prepare(`UPDATE profile SET ${sets.join(", ")} WHERE id = 1`)
    .bind(...vals)
    .run();
  const row = await c.env.DB.prepare("SELECT * FROM profile WHERE id = 1").first();
  return c.json({ profile: row });
});

// ---------- web push ----------

app.get("/push/key", (c) => c.json({ key: c.env.VAPID_PUBLIC_KEY ?? null }));

app.post("/push/subscribe", async (c) => {
  const b = await c.req
    .json<{ endpoint?: string; keys?: { p256dh?: string; auth?: string } }>()
    .catch(() => null);
  if (!b?.endpoint || !b.endpoint.startsWith("https://")) {
    return c.json({ error: "Bad subscription" }, 400);
  }
  await c.env.DB.prepare(
    "INSERT INTO push_subscriptions (endpoint, p256dh, auth) VALUES (?,?,?) ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth",
  )
    .bind(b.endpoint.slice(0, 1000), b.keys?.p256dh ?? null, b.keys?.auth ?? null)
    .run();
  return c.json({ ok: true });
});

app.post("/push/test", async (c) => {
  const n = await pushAll(c.env, {
    title: "TradeMate push works",
    body: "You'll get briefings and market alerts here — even with the app closed.",
    url: "/",
  });
  return c.json({ ok: true, sent: n });
});

app.get("/push/latest", async (c) => {
  const row = await c.env.DB.prepare("SELECT json FROM briefings WHERE key = 'push-latest'")
    .first<{ json: string }>();
  if (!row) return c.json({ title: "TradeMate", body: "Open the app for the latest." });
  return c.json(JSON.parse(row.json));
});

/** Market open-ish: Sunday 21:00 UTC through Friday 21:00 UTC. */
function marketOpen(d = new Date()): boolean {
  const day = d.getUTCDay();
  const h = d.getUTCHours();
  if (day === 6) return false;
  if (day === 0) return h >= 21;
  if (day === 5) return h < 21;
  return true;
}

export default {
  fetch: app.fetch,
  scheduled: async (event: ScheduledController, env: Env) => {
    if (event.cron === "0 5 * * 1-5") {
      await generateBriefing(env, { push: true }).catch(() => {});
    } else if (marketOpen()) {
      await scanNews(env).catch(() => {});
    }
  },
} satisfies ExportedHandler<Env>;
