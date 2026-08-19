/** Market data fetchers + briefing/news/weekly-report generators. All free sources. */
import { parseAIJson } from "./ai";
import { askMate, getProfile, localDate, recentTrades, tradeLines, type Env } from "./context";
import { pushAll } from "./push";

// ---------- data sources ----------

export interface CalEvent {
  title: string;
  country: string;
  date: string; // ISO with offset
  impact: string;
  forecast?: string;
  previous?: string;
}

export async function fetchFFCalendar(): Promise<CalEvent[]> {
  const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json", {
    headers: { "User-Agent": "Mozilla/5.0 TradeMate/1.0" },
  });
  if (!res.ok) throw new Error(`FF calendar HTTP ${res.status}`);
  const data = (await res.json()) as CalEvent[];
  return Array.isArray(data) ? data : [];
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

export interface Headline {
  title: string;
  pubDate: string;
}

export async function fetchNewsRSS(query: string, max = 15): Promise<Headline[]> {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;
  const res = await fetch(url, { headers: { "User-Agent": "Mozilla/5.0 TradeMate/1.0" } });
  if (!res.ok) throw new Error(`news RSS HTTP ${res.status}`);
  const xml = await res.text();
  const items: Headline[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const block = m[1];
    const title = block.match(/<title>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1] ?? "";
    const pubDate = block.match(/<pubDate>([\s\S]*?)<\/pubDate>/)?.[1] ?? "";
    if (title) items.push({ title: decodeEntities(title.trim()), pubDate: pubDate.trim() });
    if (items.length >= max) break;
  }
  return items;
}

/** Public-channel scrape via t.me/s — no API key, works from a Worker. */
export async function fetchTelegramNews(handle: string, max = 20): Promise<Headline[]> {
  const res = await fetch(`https://t.me/s/${encodeURIComponent(handle)}`, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; TradeMate/1.0)" },
  });
  if (!res.ok) throw new Error(`t.me HTTP ${res.status}`);
  const html = await res.text();
  const items: Headline[] = [];
  // Page lists oldest→newest; each message sits in a tgme_widget_message_wrap block.
  const blocks = html.split('class="tgme_widget_message_wrap').slice(1);
  for (const block of blocks) {
    const textM = block.match(/class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/);
    if (!textM) continue;
    const raw = textM[1]
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/<[^>]+>/g, "")
      .trim();
    const title = decodeEntities(raw).replace(/\s+/g, " ").slice(0, 220);
    const pubDate = block.match(/<time[^>]+datetime="([^"]+)"/)?.[1] ?? "";
    if (title.length > 15) items.push({ title, pubDate });
  }
  return items.slice(-max).reverse(); // newest first
}

/** USD/gold relevance for the raw Telegram firehose. */
const GOLD_USD_RE =
  /gold|xau|silver|dxy|dollar|usd|treasur|yield|fomc|fed\b|powell|cpi|ppi|pce|nfp|payroll|jobless|gdp|rate (cut|hike|decision)|trump|tariff|sanction|geopolit|iran|israel|china|war|risk[ -]off|safe haven/i;

interface Candle {
  datetime: string;
  open: string;
  high: string;
  low: string;
  close: string;
}

export async function fetchGold(key: string): Promise<{
  price: number | null;
  candles: Candle[];
}> {
  let price: number | null = null;
  let candles: Candle[] = [];
  try {
    const p = (await (
      await fetch(`https://api.twelvedata.com/price?symbol=XAU/USD&apikey=${key}`)
    ).json()) as { price?: string };
    if (p.price) price = Number.parseFloat(p.price);
  } catch {
    // price unavailable
  }
  try {
    const ts = (await (
      await fetch(
        `https://api.twelvedata.com/time_series?symbol=XAU/USD&interval=1day&outputsize=10&apikey=${key}`,
      )
    ).json()) as { values?: Candle[] };
    if (Array.isArray(ts.values)) candles = ts.values;
  } catch {
    // candles unavailable
  }
  return { price, candles };
}

// ---------- daily briefing ----------

const BRIEFING_CONTRACT = `Return STRICT JSON only:
{
  "bias": "bullish" | "bearish" | "neutral",
  "confidence": 0-100,
  "one_liner": "the day in one honest sentence",
  "drivers": ["2-4 fundamental drivers actually moving gold today, most important first"],
  "narrative": "3-5 sentences weaving macro, news sentiment and price action together, plain text",
  "sentiment": "one sentence on the news/positioning mood",
  "key_levels": {"support": [numbers from the candle data], "resistance": [numbers]},
  "landmines": [{"event": "name", "time_utc": "ISO time", "why": "one line"}],
  "invalidation": "what price/event action would flip this bias"
}
Calibrate confidence honestly: conflicting drivers or a choppy regime means confidence below 55 and usually a neutral bias. Above 75 only when calendar, feed and price action all point the same way. A wrong high-confidence call costs the trader real money — hedge with neutral when unsure.`;

/** Ask + parse with one retry — AI JSON output occasionally arrives malformed. */
async function askMateJson<T>(
  env: Env,
  prompt: string,
  opts: { maxTokens?: number; temperature?: number },
): Promise<T> {
  try {
    return parseAIJson<T>(await askMate(env, prompt, { ...opts, json: true }));
  } catch {
    return parseAIJson<T>(
      await askMate(env, prompt, { ...opts, json: true, temperature: 0.2 }),
    );
  }
}

export async function generateBriefing(
  env: Env,
  opts: { push?: boolean } = {},
): Promise<Record<string, unknown>> {
  const profile = await getProfile(env);
  const tz = String(profile.timezone ?? "Africa/Addis_Ababa");
  const today = localDate(tz);

  const [calendar, headlines, telegram, gold] = await Promise.all([
    fetchFFCalendar().catch(() => [] as CalEvent[]),
    fetchNewsRSS('gold price OR XAUUSD OR "federal reserve" OR DXY OR Iran OR tariffs', 12).catch(
      () => [] as Headline[],
    ),
    fetchTelegramNews(env.TELEGRAM_NEWS_CHANNEL ?? "marketfeed", 30).catch(
      () => [] as Headline[],
    ),
    env.TWELVEDATA_API_KEY
      ? fetchGold(env.TWELVEDATA_API_KEY)
      : Promise.resolve({ price: null, candles: [] }),
  ]);

  const feedLines = telegram.filter((h) => GOLD_USD_RE.test(h.title)).slice(0, 10);

  // Today's USD events (in trader-local terms), high/medium impact
  const events = calendar
    .filter((e) => e.country === "USD" && /^(high|medium)$/i.test(e.impact ?? ""))
    .filter((e) => {
      const d = new Date(e.date);
      return !Number.isNaN(d.getTime()) && localDate(tz, d) === today;
    })
    .map((e) => ({
      title: e.title,
      impact: e.impact.toLowerCase(),
      timeUtc: new Date(e.date).toISOString(),
      forecast: e.forecast || undefined,
      previous: e.previous || undefined,
    }));

  const candleLines = gold.candles
    .map((v) => `${v.datetime}: O ${v.open} H ${v.high} L ${v.low} C ${v.close}`)
    .join("\n");

  const prompt = [
    `Write today's (${today}) XAUUSD pre-session briefing for me.`,
    "",
    gold.price ? `Current gold price: $${gold.price.toFixed(2)}` : "Current price unavailable.",
    candleLines ? `Last daily candles (newest first):\n${candleLines}` : "",
    "",
    events.length
      ? `Today's USD calendar events (Forex Factory):\n${events
          .map(
            (e) =>
              `- ${e.title} [${e.impact}] at ${e.timeUtc}${e.forecast ? ` forecast ${e.forecast}` : ""}${e.previous ? ` prev ${e.previous}` : ""}`,
          )
          .join("\n")}`
      : "No high/medium USD calendar events today.",
    "",
    headlines.length
      ? `Overnight headlines:\n${headlines.map((h) => `- ${h.title}`).join("\n")}`
      : "No headlines fetched.",
    "",
    feedLines.length
      ? `Live trader feed (Telegram, newest first — weigh this over stale headlines):\n${feedLines
          .map((h) => `- ${h.title}`)
          .join("\n")}`
      : "",
    "",
    "Base key_levels ONLY on the candle data above (recent swing highs/lows, round numbers near price). Do not invent prices.",
    "Weigh evidence in this order: today's calendar events > live feed > overnight headlines > candle structure.",
    "Remember the regime is choppy and I trade NY session mainly, London sometimes.",
    BRIEFING_CONTRACT,
  ]
    .filter(Boolean)
    .join("\n");

  const raw = await askMateJson<Record<string, unknown>>(env, prompt, {
    maxTokens: 2200,
    temperature: 0.4,
  });
  const analysis = raw;

  const briefing = {
    date: today,
    generated_at: new Date().toISOString(),
    price: gold.price,
    events,
    headlines: headlines.slice(0, 8).map((h) => h.title),
    analysis,
  };

  await env.DB.prepare(
    "INSERT INTO briefings (key, kind, json) VALUES (?, 'daily', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, created_at = datetime('now')",
  )
    .bind(`daily-${today}`, JSON.stringify(briefing))
    .run();

  if (opts.push) {
    const a = analysis as { bias?: string; one_liner?: string };
    await pushAll(env, {
      title: `Briefing ready · ${(a.bias ?? "neutral").toUpperCase()}`,
      body: a.one_liner ?? "Your XAUUSD game plan is ready.",
      url: "/",
    }).catch(() => 0);
  }

  return briefing;
}

// ---------- live news watch ----------

const HOT_RE =
  /war|missile|strike|attack|bomb|nuclear|iran|israel|hormuz|strait|escalat|invasion|tariff|sanction|trump|powell|fed |federal reserve|rate cut|rate hike|emergency|inflation|cpi|nfp|payroll|jobs report|debt ceiling|shutdown|gold (surge|plunge|soar|crash|record)/i;

export async function scanNews(env: Env): Promise<{ scanned: number; fresh: unknown[] }> {
  const [rss, tg] = await Promise.all([
    fetchNewsRSS(
      'gold OR XAUUSD OR Trump OR Iran OR "federal reserve" OR tariffs OR war',
      20,
    ).catch(() => [] as Headline[]),
    fetchTelegramNews(env.TELEGRAM_NEWS_CHANNEL ?? "marketfeed", 25).catch(
      () => [] as Headline[],
    ),
  ]);
  const seen = new Set<string>();
  const hot: Headline[] = [];
  for (const h of [
    ...tg.filter((h2) => HOT_RE.test(h2.title) || GOLD_USD_RE.test(h2.title)),
    ...rss.filter((h2) => HOT_RE.test(h2.title)),
  ]) {
    const key = h.title.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      hot.push(h);
    }
  }
  const scannedCount = rss.length + tg.length;
  if (hot.length === 0) return { scanned: scannedCount, fresh: [] };

  const fresh: Headline[] = [];
  for (const h of hot) {
    const exists = await env.DB.prepare("SELECT 1 FROM news_events WHERE title = ?")
      .bind(h.title)
      .first();
    if (!exists) fresh.push(h);
  }
  if (fresh.length === 0) return { scanned: scannedCount, fresh: [] };

  let classified: { title: string; severity: string; gold_impact: string; note: string }[] = [];
  try {
    const parsed = await askMateJson<{ items: typeof classified }>(
      env,
      `Classify these headlines for an XAUUSD day trader. Return STRICT JSON: {"items":[{"title":"exact title","severity":"high|medium|low","gold_impact":"bullish|bearish|unclear","note":"one short line why it matters for gold"}]}\n\nHeadlines:\n${fresh.map((h) => `- ${h.title}`).join("\n")}`,
      { maxTokens: 1600, temperature: 0.2 },
    );
    classified = parsed.items ?? [];
  } catch {
    classified = fresh.map((h) => ({
      title: h.title,
      severity: "medium",
      gold_impact: "unclear",
      note: "auto-flagged by keyword",
    }));
  }

  const stored: unknown[] = [];
  for (const h of fresh) {
    const cls = classified.find((x) => x.title === h.title) ?? {
      severity: "medium",
      gold_impact: "unclear",
      note: "keyword match",
    };
    try {
      await env.DB.prepare(
        "INSERT OR IGNORE INTO news_events (title, pub_date, severity, gold_impact, note) VALUES (?,?,?,?,?)",
      )
        .bind(h.title, h.pubDate, cls.severity, cls.gold_impact, cls.note)
        .run();
      stored.push({ title: h.title, ...cls });
    } catch {
      // ignore insert races
    }
  }

  const high = classified.filter((x) => x.severity === "high");
  if (high.length > 0) {
    await pushAll(env, {
      title: `Market alert · gold ${high[0].gold_impact}`,
      body: high[0].title,
      url: "/",
    }).catch(() => 0);
  }

  return { scanned: scannedCount, fresh: stored };
}

// ---------- weekly coach report ----------

const WEEKLY_CONTRACT = `Return STRICT JSON only:
{
  "headline": "one sentence summary of his week",
  "what_worked": ["1-3 specific things"],
  "what_hurt": ["1-3 specific things, name the pattern honestly"],
  "pattern": "the single most important behavioral pattern you see in the data",
  "one_focus": "ONE concrete focus for next week, phrased as a rule he can follow",
  "stat_callout": "one striking stat from his journal, with numbers"
}`;

export function mondayOf(dateStr: string): string {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day);
  return d.toISOString().slice(0, 10);
}

export async function weeklyReport(env: Env, refresh = false): Promise<Record<string, unknown>> {
  const profile = await getProfile(env);
  const tz = String(profile.timezone ?? "Africa/Addis_Ababa");
  const week = mondayOf(localDate(tz));
  const key = `weekly-${week}`;

  if (!refresh) {
    const cached = await env.DB.prepare("SELECT json FROM briefings WHERE key = ?")
      .bind(key)
      .first<{ json: string }>();
    if (cached) return JSON.parse(cached.json) as Record<string, unknown>;
  }

  const trades = await recentTrades(env, 40);
  const weekTrades = trades.filter((t) => t.opened_at.slice(0, 10) >= week);
  let checkins = "";
  try {
    const r = await env.DB.prepare(
      "SELECT date, mood, sleep, plan FROM checkins WHERE date >= ? ORDER BY date",
    )
      .bind(week)
      .all();
    checkins = (r.results as { date: string; mood: number; sleep: number; plan: string }[])
      .map((c) => `- ${c.date}: mood ${c.mood}/5 sleep ${c.sleep}/5${c.plan ? ` plan:"${c.plan}"` : ""}`)
      .join("\n");
  } catch {
    // no checkins table
  }

  const prompt = [
    `Write my weekly coaching review (week starting ${week}).`,
    `This week's trades:\n${tradeLines(weekTrades)}`,
    checkins ? `Check-ins:\n${checkins}` : "No check-ins this week.",
    weekTrades.length === 0
      ? "I logged no trades this week — address that directly (was it discipline or avoidance?)."
      : "",
    WEEKLY_CONTRACT,
  ]
    .filter(Boolean)
    .join("\n\n");

  const analysis = await askMateJson<Record<string, unknown>>(env, prompt, {
    maxTokens: 2200,
    temperature: 0.5,
  });
  const report = { week, generated_at: new Date().toISOString(), analysis };

  await env.DB.prepare(
    "INSERT INTO briefings (key, kind, json) VALUES (?, 'weekly', ?) ON CONFLICT(key) DO UPDATE SET json = excluded.json, created_at = datetime('now')",
  )
    .bind(key, JSON.stringify(report))
    .run();

  return report;
}
