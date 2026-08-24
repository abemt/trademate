import { useEffect, useMemo, useRef, useState } from "react";
import { Card } from "./Card";
import { Chip, ChipRow, FieldLabel } from "./Chip";
import { IconGauge, IconNews, IconSpark } from "./Icons";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { localDateKey, type Trade } from "../lib/trades";

function useNowTick(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ---------- Daily briefing ----------

interface BriefingEvent {
  title: string;
  impact: string;
  timeUtc: string;
  forecast?: string;
}

interface Briefing {
  date: string;
  generated_at: string;
  price: number | null;
  events: BriefingEvent[];
  headlines: string[];
  analysis: {
    bias?: string;
    confidence?: number;
    one_liner?: string;
    narrative?: string;
    sentiment?: string;
    key_levels?: { support?: number[]; resistance?: number[] };
    invalidation?: string;
  };
}

const BIAS_STYLE: Record<string, string> = {
  bullish: "border-up/50 bg-up/10 text-up",
  bearish: "border-down/50 bg-down/10 text-down",
  neutral: "border-gold-500/40 bg-gold-500/10 text-gold-300",
};

function eventCountdown(timeUtc: string, now: Date): { label: string; urgent: boolean; past: boolean } {
  const t = new Date(timeUtc).getTime();
  const mins = Math.round((t - now.getTime()) / 60_000);
  if (mins < -180) return { label: "passed", urgent: false, past: true };
  if (mins < 0) return { label: "in play", urgent: true, past: false };
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return {
    label: `in ${h > 0 ? `${h}h ` : ""}${m}m`,
    urgent: mins <= 45,
    past: false,
  };
}

/** Live XAUUSD price — polls /api/price every 2 min + when the tab regains focus. */
function useLivePrice(): { price: number | null; tick: "up" | "down" | null } {
  const [price, setPrice] = useState<number | null>(null);
  const [tick, setTick] = useState<"up" | "down" | null>(null);
  const prevRef = useRef<number | null>(null);

  useEffect(() => {
    let stop = false;
    async function poll() {
      try {
        const r = await api<{ price: number | null }>("/price");
        if (stop || r.price === null) return;
        const prev = prevRef.current;
        if (prev !== null && r.price !== prev) setTick(r.price > prev ? "up" : "down");
        prevRef.current = r.price;
        setPrice(r.price);
      } catch {
        // offline — keep last value
      }
    }
    void poll();
    const id = setInterval(() => void poll(), 45_000);
    const onVis = () => {
      if (document.visibilityState === "visible") void poll();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      stop = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return { price, tick };
}

function LivePrice() {
  const { price, tick } = useLivePrice();
  if (price === null) return null;
  return (
    <span
      className={`flex items-center gap-1.5 text-xs font-bold ${
        tick === "up" ? "text-up" : tick === "down" ? "text-down" : "text-white"
      }`}
    >
      <span className="relative flex h-1.5 w-1.5">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gold-400 opacity-60" />
        <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-gold-400" />
      </span>
      ${price.toFixed(2)}
    </span>
  );
}

export function BriefingCard() {
  const now = useNowTick();
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    api<{ briefing: Briefing | null }>("/briefing")
      .then((r) => setBriefing(r.briefing))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  async function generate() {
    setGenerating(true);
    setError("");
    try {
      const r = await api<{ briefing: Briefing }>("/briefing", { method: "POST" });
      setBriefing(r.briefing);
      setExpanded(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed — try again.");
    } finally {
      setGenerating(false);
    }
  }

  const a = briefing?.analysis;
  const bias = (a?.bias ?? "neutral").toLowerCase();

  return (
    <Card title="Daily briefing" icon={<IconNews />} badge={briefing ? briefing.date : "XAUUSD"}>
      {loading ? (
        <p className="text-sm text-ink-400">Checking…</p>
      ) : !briefing ? (
        <div>
          <div className="mb-2">
            <LivePrice />
          </div>
          <p className="text-sm leading-relaxed text-ink-300">
            No briefing for today yet. Mate reads the Forex Factory calendar, overnight
            gold/USD headlines and the daily candles, then writes your game plan.
          </p>
          {error && <p className="mt-2 text-sm text-down">{error}</p>}
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="mt-3 w-full rounded-xl bg-gold-500 py-2.5 font-semibold text-ink-950 transition hover:bg-gold-400 disabled:opacity-50"
          >
            {generating ? "Mate is reading the markets…" : "Generate today's briefing"}
          </button>
        </div>
      ) : (
        <div>
          <div className="flex items-center gap-2.5">
            <span
              className={`rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider ${BIAS_STYLE[bias] ?? BIAS_STYLE.neutral}`}
            >
              {bias}
            </span>
            {typeof a?.confidence === "number" && (
              <div className="flex flex-1 items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink-700">
                  <div
                    className="h-full rounded-full bg-gold-500"
                    style={{ width: `${Math.min(100, a.confidence)}%` }}
                  />
                </div>
                <span className="text-xs font-semibold text-ink-300">{a.confidence}%</span>
              </div>
            )}
            <LivePrice />
          </div>

          {a?.one_liner && (
            <p className="mt-3 text-sm font-semibold leading-relaxed text-white">{a.one_liner}</p>
          )}

          {briefing.events.length > 0 && (
            <ul className="mt-3 space-y-1.5">
              {briefing.events.map((e) => {
                const cd = eventCountdown(e.timeUtc, now);
                return (
                  <li
                    key={`${e.title}${e.timeUtc}`}
                    className={`flex items-center gap-2 text-xs ${cd.past ? "opacity-40" : ""}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                        e.impact === "high" ? "bg-down" : "bg-gold-400"
                      } ${cd.urgent ? "animate-pulse" : ""}`}
                    />
                    <span className="truncate text-ink-200">{e.title}</span>
                    <span className="ml-auto shrink-0 text-ink-400">
                      {new Date(e.timeUtc).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span
                      className={`shrink-0 font-semibold ${cd.urgent ? "text-down" : "text-ink-300"}`}
                    >
                      {cd.label}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {expanded && (
            <div className="mt-3 space-y-3 border-t border-white/5 pt-3">
              {a?.narrative && (
                <p className="text-sm leading-relaxed text-ink-200">{a.narrative}</p>
              )}
              {a?.sentiment && (
                <p className="text-xs leading-relaxed text-ink-300">
                  <span className="font-semibold text-ink-200">Sentiment: </span>
                  {a.sentiment}
                </p>
              )}
              {(a?.key_levels?.support?.length || a?.key_levels?.resistance?.length) && (
                <div className="flex flex-wrap gap-1.5">
                  {a.key_levels?.resistance?.map((v) => (
                    <span
                      key={`r${v}`}
                      className="rounded-full border border-down/30 bg-down/10 px-2 py-0.5 text-[10px] font-semibold text-down"
                    >
                      R {v}
                    </span>
                  ))}
                  {a.key_levels?.support?.map((v) => (
                    <span
                      key={`s${v}`}
                      className="rounded-full border border-up/30 bg-up/10 px-2 py-0.5 text-[10px] font-semibold text-up"
                    >
                      S {v}
                    </span>
                  ))}
                </div>
              )}
              {a?.invalidation && (
                <p className="text-xs leading-relaxed text-ink-300">
                  <span className="font-semibold text-ink-200">Invalidation: </span>
                  {a.invalidation}
                </p>
              )}
            </div>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex-1 rounded-lg border border-white/10 bg-ink-800 py-2 text-xs font-semibold text-ink-200 transition hover:text-white"
            >
              {expanded ? "Less" : "Full briefing"}
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={generating}
              className="rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-xs font-semibold text-ink-300 transition hover:text-white disabled:opacity-50"
            >
              {generating ? "…" : "Refresh"}
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

// ---------- Check-in ----------

interface Checkin {
  date: string;
  mood: number | null;
  sleep: number | null;
  plan: string | null;
}

const MOOD_LABELS = ["rough", "meh", "ok", "good", "sharp"];
const SLEEP_LABELS = ["awful", "poor", "ok", "good", "great"];

export function CheckinCard() {
  const [existing, setExisting] = useState<Checkin | null | undefined>(undefined);
  const [mood, setMood] = useState<number | null>(null);
  const [sleep, setSleep] = useState<number | null>(null);
  const [plan, setPlan] = useState("");
  const [saving, setSaving] = useState(false);

  const today = localDateKey(new Date().toISOString());

  useEffect(() => {
    api<{ checkins: Checkin[] }>("/checkins")
      .then((r) => setExisting(r.checkins.find((c) => c.date === today) ?? null))
      .catch(() => setExisting(null));
  }, [today]);

  async function save() {
    if (saving) return;
    setSaving(true);
    try {
      await api("/checkins", {
        method: "POST",
        body: JSON.stringify({ mood, sleep, plan: plan.trim() || undefined }),
      });
      setExisting({ date: today, mood, sleep, plan: plan.trim() || null });
    } catch {
      // stay on form
    } finally {
      setSaving(false);
    }
  }

  if (existing === undefined) return null;

  if (existing) {
    return (
      <Card title="Check-in" icon={<IconSpark />} badge="done">
        <p className="text-sm text-ink-300">
          Mood{" "}
          <span className="font-semibold text-white">
            {existing.mood ? MOOD_LABELS[existing.mood - 1] : "—"}
          </span>{" "}
          · Sleep{" "}
          <span className="font-semibold text-white">
            {existing.sleep ? SLEEP_LABELS[existing.sleep - 1] : "—"}
          </span>
          {existing.plan && (
            <>
              {" · "}
              <span className="italic text-ink-200">"{existing.plan}"</span>
            </>
          )}
        </p>
        <p className="mt-1.5 text-xs text-ink-400">Mate factors this into everything today.</p>
      </Card>
    );
  }

  return (
    <Card title="30-second check-in" icon={<IconSpark />}>
      <FieldLabel>Mood</FieldLabel>
      <ChipRow>
        {MOOD_LABELS.map((l, i) => (
          <Chip key={l} active={mood === i + 1} onClick={() => setMood(i + 1)}>
            {l}
          </Chip>
        ))}
      </ChipRow>
      <div className="mt-3">
        <FieldLabel>Sleep</FieldLabel>
        <ChipRow>
          {SLEEP_LABELS.map((l, i) => (
            <Chip key={l} active={sleep === i + 1} onClick={() => setSleep(i + 1)}>
              {l}
            </Chip>
          ))}
        </ChipRow>
      </div>
      <input
        type="text"
        value={plan}
        onChange={(e) => setPlan(e.target.value)}
        placeholder="Today's plan in one line (optional)"
        className="mt-3 w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
      />
      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || (mood === null && sleep === null && !plan.trim())}
        className="mt-3 w-full rounded-xl bg-gold-500 py-2.5 font-semibold text-ink-950 transition hover:bg-gold-400 disabled:opacity-40"
      >
        {saving ? "Saving…" : "Check in"}
      </button>
    </Card>
  );
}

// ---------- Circuit breaker ----------

export function CircuitBreakerCard() {
  const trades = useApp((s) => s.trades);
  const profile = useApp((s) => s.profile);
  const setTab = useApp((s) => s.setTab);
  const dailyLimit = profile?.prop_daily_loss_usd ?? 500;
  const maxPerDay = profile?.max_trades_per_day ?? 2;

  const { consecLosses, todayPnl, usedToday } = useMemo(() => {
    const today = localDateKey(new Date().toISOString());
    const todayTrades = trades.filter((t) => localDateKey(t.opened_at) === today);
    const closedToday = trades
      .filter(
        (t) =>
          t.status === "closed" &&
          t.pnl_usd !== null &&
          localDateKey(t.closed_at ?? t.opened_at) === today,
      )
      .sort((a, b) => (a.closed_at ?? a.opened_at).localeCompare(b.closed_at ?? b.opened_at));
    let consec = 0;
    for (let i = closedToday.length - 1; i >= 0; i--) {
      if (closedToday[i].pnl_usd! < 0) consec++;
      else break;
    }
    return {
      consecLosses: consec,
      todayPnl: closedToday.reduce((s, t) => s + t.pnl_usd!, 0),
      usedToday: todayTrades.length,
    };
  }, [trades]);

  const lossUsedPct = Math.min(100, Math.max(0, (-todayPnl / dailyLimit) * 100));
  const overCap = usedToday > maxPerDay;
  const lossTripped = consecLosses >= 2;
  const ddWarning = todayPnl <= -dailyLimit * 0.6;
  const clean = !lossTripped && !ddWarning && !overCap;

  // Positive state — the guardrails are holding, say so out loud.
  if (clean) {
    return (
      <section className="rounded-2xl border border-up/30 bg-up/5 p-4 shadow-[var(--card-shadow)]">
        <div className="flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-up/15 text-xs font-bold text-up">✓</span>
          <h2 className="text-sm font-bold text-up">No rule violations today</h2>
          <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-ink-400">
            trades {usedToday}/{maxPerDay}
          </span>
        </div>
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-[11px]">
            <span className="text-ink-400">Daily loss guard</span>
            <span className="font-semibold text-ink-300">
              ${Math.round(Math.max(0, -todayPnl))} / ${dailyLimit}
            </span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
            <div
              className={`h-full rounded-full transition-all ${lossUsedPct > 60 ? "bg-down" : "bg-up/70"}`}
              style={{ width: `${Math.max(2, lossUsedPct)}%` }}
            />
          </div>
          <p className="mt-2 flex items-baseline justify-between text-[11px]">
            <span className="text-ink-400">Today's closed P&L</span>
            <span className={`font-bold ${todayPnl > 0 ? "text-up" : todayPnl < 0 ? "text-down" : "text-ink-300"}`}>
              {todayPnl === 0 ? "$0" : `${todayPnl > 0 ? "+" : "-"}$${Math.abs(Math.round(todayPnl))}`}
            </span>
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-down/40 bg-down/10 p-4">
      <div className="flex items-center gap-2">
        <IconGauge className="h-5 w-5 text-down" />
        <h2 className="text-sm font-bold uppercase tracking-wider text-down">Circuit breaker</h2>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-ink-100">
        {overCap
          ? `${usedToday} trades against your rule of ${maxPerDay}. The cap exists because trade #${maxPerDay + 1} is historically your worst. Log honestly, close the platform.`
          : lossTripped
            ? `${consecLosses} losses in a row today. Your edge isn't showing up right now — and the next trade is the one revenge takes. You're done for today.`
            : `You're $${Math.round(-todayPnl)} down — that's ${Math.round((-todayPnl / dailyLimit) * 100)}% of your $${dailyLimit} daily limit. One bad trade from a blown day. Step back.`}
      </p>
      <div className="mt-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
          <div className="h-full rounded-full bg-down transition-all" style={{ width: `${Math.max(2, lossUsedPct)}%` }} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => setTab("mate")}
        className="mt-3 w-full rounded-xl bg-down/80 py-2.5 font-semibold text-white transition hover:bg-down"
      >
        Talk it out with Mate
      </button>
    </section>
  );
}

// ---------- Pre-session routine ----------

const ROUTINE_STEPS = [
  { id: "briefing", label: "Read today's briefing" },
  { id: "landmines", label: "Check calendar landmines" },
  { id: "zones", label: "Confirm key zones" },
  { id: "decide", label: "Decide: one graded trade — or SIT" },
] as const;

export function RoutineCard() {
  const today = localDateKey(new Date().toISOString());
  const [done, setDone] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    api<{ routine: { done: string } | null }>(`/routine?date=${today}`)
      .then((r) => {
        if (cancelled) return;
        try {
          const parsed = JSON.parse(r.routine?.done ?? "[]");
          setDone(Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : []);
        } catch {
          setDone([]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [today]);

  function toggle(id: string) {
    const next = done.includes(id) ? done.filter((d) => d !== id) : [...done, id];
    setDone(next);
    void api("/routine", {
      method: "POST",
      body: JSON.stringify({ date: today, done: next }),
    }).catch(() => {});
  }

  const doneCount = ROUTINE_STEPS.filter((s) => done.includes(s.id)).length;
  const complete = doneCount === ROUTINE_STEPS.length;

  return (
    <Card
      title="Pre-session routine"
      icon={<IconSpark />}
      badge={complete ? "complete — cleared to engage" : `${doneCount}/${ROUTINE_STEPS.length}`}
    >
      <div className="mb-3 h-1.5 overflow-hidden rounded-full bg-ink-700">
        <div
          className={`h-full rounded-full transition-all ${complete ? "bg-up" : "bg-gold-500"}`}
          style={{ width: `${Math.max(3, (doneCount / ROUTINE_STEPS.length) * 100)}%` }}
        />
      </div>
      <ul className="space-y-2">
        {ROUTINE_STEPS.map((s) => {
          const checked = done.includes(s.id);
          return (
            <li key={s.id}>
              <button
                type="button"
                onClick={() => toggle(s.id)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition ${
                  checked
                    ? "border-up/30 bg-up/5 text-ink-300 line-through"
                    : "border-white/10 bg-ink-800 text-white hover:border-gold-500/40"
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${
                    checked ? "border-up bg-up/20 text-up" : "border-ink-500 text-transparent"
                  }`}
                >
                  ✓
                </span>
                {s.label}
              </button>
            </li>
          );
        })}
      </ul>
      {!complete && (
        <p className="mt-2.5 text-[11px] leading-snug text-ink-400">
          No orders before the routine is done — preparation is the first rule that gets broken on
          tilt days.
        </p>
      )}
    </Card>
  );
}

// ---------- News watch ----------

interface NewsEvent {
  title: string;
  severity: string;
  gold_impact: string;
  note: string;
  created_at: string;
}

const SEV_DOT: Record<string, string> = {
  high: "bg-down",
  medium: "bg-gold-400",
  low: "bg-ink-500",
};

export function NewsWatchCard() {
  const [events, setEvents] = useState<NewsEvent[]>([]);
  const [scanning, setScanning] = useState(false);
  const [notifOk, setNotifOk] = useState(
    typeof Notification !== "undefined" && Notification.permission === "granted",
  );
  const cycleRef = useRef<(scan: boolean) => Promise<void>>(async () => {});

  useEffect(() => {
    let cancelled = false;
    async function cycle(scan: boolean) {
      try {
        if (scan) {
          setScanning(true);
          const r = await api<{ fresh: { title: string; severity: string; note: string }[] }>(
            "/newswatch/scan",
            { method: "POST" },
          );
          const high = r.fresh.filter((f) => f.severity === "high");
          if (high.length && typeof Notification !== "undefined" && Notification.permission === "granted") {
            for (const h of high.slice(0, 2)) {
              try {
                const reg = await navigator.serviceWorker?.getRegistration();
                if (reg) void reg.showNotification("TradeMate news alert", { body: h.title });
                else new Notification("TradeMate news alert", { body: h.title });
              } catch {
                // notifications unavailable
              }
            }
          }
        }
        const list = await api<{ events: NewsEvent[] }>("/newswatch");
        if (!cancelled) setEvents(list.events);
      } catch {
        // offline or scan failure — keep old list
      } finally {
        if (!cancelled) setScanning(false);
      }
    }
    cycleRef.current = cycle;
    void cycle(true);
    const id = setInterval(() => void cycle(true), 5 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <Card title="News watch" icon={<IconNews />} badge={scanning ? "scanning…" : "every 5 min"}>
      <button
        type="button"
        onClick={() => void cycleRef.current(true)}
        disabled={scanning}
        className="mb-3 w-full rounded-lg border border-white/10 bg-ink-800 py-2 text-xs font-semibold text-ink-300 transition hover:text-gold-400 disabled:opacity-50"
      >
        {scanning ? "Scanning feeds…" : "↻ Refresh now — @marketfeed · @Forex_LiveStream · Bloomberg"}
      </button>
      {typeof Notification !== "undefined" && Notification.permission === "default" && (
        <button
          type="button"
          onClick={() => {
            void Notification.requestPermission().then((p) => setNotifOk(p === "granted"));
          }}
          className="mb-3 w-full rounded-lg border border-gold-500/40 bg-gold-500/10 py-2 text-xs font-semibold text-gold-300 transition hover:bg-gold-500/20"
        >
          Enable alerts for market-moving headlines
        </button>
      )}
      {notifOk && (
        <p className="mb-2 text-[10px] uppercase tracking-wider text-ink-400">alerts on</p>
      )}
      {events.length === 0 ? (
        <p className="text-sm text-ink-400">
          Quiet so far. Mate watches the @marketfeed Telegram firehose plus gold, Fed and
          geopolitics headlines — anything that moves XAUUSD lands here within minutes.
        </p>
      ) : (
        <ul className="space-y-2.5">
          {events.slice(0, 5).map((e) => (
            <li key={e.title} className="flex gap-2.5">
              <span
                className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${SEV_DOT[e.severity] ?? SEV_DOT.low}`}
              />
              <div className="min-w-0">
                <p className="text-xs font-medium leading-snug text-ink-100">{e.title}</p>
                <p className="mt-0.5 text-[10px] text-ink-400">
                  {e.gold_impact !== "unclear" && (
                    <span
                      className={`font-bold uppercase ${
                        e.gold_impact === "bullish" ? "text-up" : "text-down"
                      }`}
                    >
                      gold {e.gold_impact}
                    </span>
                  )}
                  {e.gold_impact !== "unclear" && " · "}
                  {e.note}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------- Discipline score ----------

interface SetupRow {
  decision: string | null;
  created_at: string;
}

export function DisciplineCard() {
  const trades = useApp((s) => s.trades);
  const maxPerDay = useApp((s) => s.profile?.max_trades_per_day) ?? 2;
  const [setups, setSetups] = useState<SetupRow[]>([]);
  const [checkins, setCheckins] = useState<Checkin[]>([]);

  useEffect(() => {
    api<{ setups: SetupRow[] }>("/setups")
      .then((r) => setSetups(r.setups))
      .catch(() => {});
    api<{ checkins: Checkin[] }>("/checkins")
      .then((r) => setCheckins(r.checkins))
      .catch(() => {});
  }, [trades.length]);

  const { xp, streak, todayXp } = useMemo(() => {
    const today = localDateKey(new Date().toISOString());
    const dayXp = new Map<string, number>();
    const add = (day: string, v: number) => dayXp.set(day, (dayXp.get(day) ?? 0) + v);

    const byDay = new Map<string, Trade[]>();
    for (const t of trades) {
      const k = localDateKey(t.opened_at);
      add(k, 10); // honest journaling
      if (t.followed_plan === 1) add(k, 20);
      if (t.followed_plan === 0) add(k, -10);
      const list = byDay.get(k) ?? [];
      list.push(t);
      byDay.set(k, list);
    }
    for (const [k, list] of byDay) if (list.length > maxPerDay) add(k, -20);
    for (const s of setups) {
      if (s.decision === "skipped") add(localDateKey(s.created_at.replace(" ", "T") + "Z"), 15);
    }
    for (const c of checkins) add(c.date, 10);

    let total = 0;
    for (const v of dayXp.values()) total += Math.max(0, v);

    // streak: consecutive active days (trade or check-in) without breaking the trade cap
    let streakCount = 0;
    const d = new Date();
    for (let i = 0; i < 60; i++) {
      const key = localDateKey(d.toISOString());
      const dow = d.getDay();
      const active = byDay.has(key) || checkins.some((c) => c.date === key);
      const violated = (byDay.get(key)?.length ?? 0) > maxPerDay;
      if (active && !violated) streakCount++;
      else if (dow !== 0 && dow !== 6 && !(i === 0)) break;
      else if (violated) break;
      d.setDate(d.getDate() - 1);
    }

    return { xp: total, streak: streakCount, todayXp: Math.max(0, dayXp.get(today) ?? 0) };
  }, [trades, setups, checkins, maxPerDay]);

  const level = Math.floor(xp / 100) + 1;

  return (
    <Card title="Discipline" icon={<IconSpark />} badge={`level ${level}`}>
      <div className="grid grid-cols-3 gap-2 text-center">
        <div className="rounded-xl bg-ink-800/70 p-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">XP</p>
          <p className="text-xl font-bold text-gold-300">{xp}</p>
        </div>
        <div className="rounded-xl bg-ink-800/70 p-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Streak</p>
          <p className="text-xl font-bold text-white">
            {streak}
            <span className="text-xs font-normal text-ink-400"> d</span>
          </p>
        </div>
        <div className="rounded-xl bg-ink-800/70 p-3">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Today</p>
          <p className="text-xl font-bold text-up">+{todayXp}</p>
        </div>
      </div>
      <p className="mt-2.5 text-xs leading-relaxed text-ink-400">
        XP comes from process only: journaling (+10), following your plan (+20), skipping weak
        setups (+15), checking in (+10). Never from profits.
      </p>
    </Card>
  );
}
