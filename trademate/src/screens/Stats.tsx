import { useMemo, useState } from "react";
import { Card } from "../components/Card";
import {
  IconClock,
  IconGauge,
  IconSpark,
  IconStats,
  IconTrendDown,
  IconTrendUp,
} from "../components/Icons";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { screenshotUrl } from "../lib/images";
import { useApp } from "../lib/store";
import {
  EMOTIONS,
  SETUPS,
  computeStats,
  fmtR,
  fmtUsd,
  localDateKey,
  optionLabel,
  type Breakdown,
  type Trade,
} from "../lib/trades";

function StatCard({ label, value, tone }: { label: string; value: string; tone?: "up" | "down" }) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-white";
  return (
    <div className="rounded-2xl border border-white/5 bg-ink-900/90 p-3.5 text-center">
      <p className="text-[10px] uppercase tracking-wider text-ink-400">{label}</p>
      <p className={`mt-1 text-xl font-bold ${color}`}>{value}</p>
    </div>
  );
}

function EquityCurve({ points }: { points: number[] }) {
  const w = 300;
  const h = 88;
  const pad = 6;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const xy = points.map(
    (v, i) =>
      [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)] as const,
  );
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const zeroY = h - pad - ((0 - min) / span) * (h - pad * 2);
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {min < 0 && max > 0 && (
        <line x1={pad} x2={w - pad} y1={zeroY} y2={zeroY} stroke="#232b3a" strokeDasharray="3 3" />
      )}
      <path
        d={path}
        fill="none"
        stroke="var(--color-gold-400)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="3" fill="var(--color-gold-400)" />
    </svg>
  );
}

function BreakdownRows({ rows }: { rows: Breakdown[] }) {
  return (
    <ul className="space-y-2.5">
      {rows.map((b) => {
        const wr = Math.round((100 * b.wins) / b.n);
        return (
          <li key={b.id}>
            <div className="mb-1 flex items-baseline justify-between text-sm">
              <span className="text-ink-200">
                {b.label} <span className="text-[10px] text-ink-400">· {b.n}</span>
              </span>
              <span
                className={`text-xs font-bold ${
                  b.netUsd > 0 ? "text-up" : b.netUsd < 0 ? "text-down" : "text-ink-300"
                }`}
              >
                {fmtR(b.netR)} · {fmtUsd(b.netUsd)}
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
              <div className="h-full rounded-full bg-gold-500/80" style={{ width: `${wr}%` }} />
            </div>
            <p className="mt-0.5 text-[10px] text-ink-400">{wr}% win rate</p>
          </li>
        );
      })}
    </ul>
  );
}

const WEEKDAYS = ["M", "T", "W", "T", "F", "S", "S"];

interface DayAgg {
  trades: Trade[];
  pnl: number;
  closedCount: number;
}

function MonthCalendar({ trades, maxPerDay }: { trades: Trade[]; maxPerDay: number }) {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);

  const byDay = useMemo(() => {
    const map = new Map<string, DayAgg>();
    for (const t of trades) {
      const k = localDateKey(t.opened_at);
      const agg = map.get(k) ?? { trades: [], pnl: 0, closedCount: 0 };
      agg.trades.push(t);
      if (t.status === "closed" && t.pnl_usd !== null) {
        agg.pnl += t.pnl_usd;
        agg.closedCount++;
      }
      map.set(k, agg);
    }
    return map;
  }, [trades]);

  const year = month.getFullYear();
  const mon = month.getMonth();
  const daysInMonth = new Date(year, mon + 1, 0).getDate();
  const leadingBlanks = (new Date(year, mon, 1).getDay() + 6) % 7; // Monday-first
  const todayKey = localDateKey(new Date().toISOString());

  const keys: (string | null)[] = [
    ...Array.from({ length: leadingBlanks }, () => null),
    ...Array.from({ length: daysInMonth }, (_, i) => {
      const d = String(i + 1).padStart(2, "0");
      return `${year}-${String(mon + 1).padStart(2, "0")}-${d}`;
    }),
  ];

  const monthAggs = keys.filter((k): k is string => k !== null).map((k) => byDay.get(k));
  const maxAbs = Math.max(1, ...monthAggs.map((a) => Math.abs(a?.pnl ?? 0)));
  const monthNet = monthAggs.reduce((s, a) => s + (a?.pnl ?? 0), 0);
  const monthHasClosed = monthAggs.some((a) => (a?.closedCount ?? 0) > 0);

  const monthClosed = monthAggs.flatMap(
    (a) => a?.trades.filter((t) => t.status === "closed" && t.pnl_usd !== null) ?? [],
  );
  const monthSummary = {
    trades: monthClosed.length,
    wins: monthClosed.filter((t) => t.pnl_usd! > 0).length,
    netR: monthClosed.reduce((s, t) => s + (t.r_multiple ?? 0), 0),
    greenDays: monthAggs.filter((a) => a && a.closedCount > 0 && a.pnl > 0).length,
    redDays: monthAggs.filter((a) => a && a.closedCount > 0 && a.pnl < 0).length,
  };

  const sel = selected ? byDay.get(selected) : undefined;
  const selR = sel
    ? sel.trades.reduce((s, t) => s + (t.r_multiple ?? 0), 0)
    : 0;

  return (
    <Card title="Calendar" icon={<IconClock />} badge="tap a day">
      <div className="mb-3 flex items-center justify-between">
        <button
          type="button"
          onClick={() => setMonth(new Date(year, mon - 1, 1))}
          aria-label="Previous month"
          className="h-9 w-9 rounded-xl border border-white/10 bg-ink-800 text-lg leading-none text-ink-300 transition hover:text-white"
        >
          ‹
        </button>
        <div className="text-center">
          <p className="text-sm font-bold text-white">
            {month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
          </p>
          {monthHasClosed && (
            <p
              className={`text-xs font-bold ${
                monthNet > 0 ? "text-up" : monthNet < 0 ? "text-down" : "text-ink-300"
              }`}
            >
              {fmtUsd(monthNet)}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => setMonth(new Date(year, mon + 1, 1))}
          aria-label="Next month"
          className="h-9 w-9 rounded-xl border border-white/10 bg-ink-800 text-lg leading-none text-ink-300 transition hover:text-white"
        >
          ›
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1.5 text-center">
        {WEEKDAYS.map((d, i) => (
          <span key={i} className="py-0.5 text-[10px] font-bold uppercase tracking-wider text-ink-400">
            {d}
          </span>
        ))}
        {keys.map((k, i) => {
          if (!k) return <span key={`b${i}`} />;
          const agg = byDay.get(k);
          const dayNum = Number(k.slice(8));
          const over = (agg?.trades.length ?? 0) > maxPerDay;
          let bg: string | undefined;
          if (agg && agg.closedCount > 0 && agg.pnl !== 0) {
            const alpha = 0.2 + 0.55 * (Math.abs(agg.pnl) / maxAbs);
            bg = agg.pnl > 0 ? `rgba(52,211,153,${alpha})` : `rgba(248,113,113,${alpha})`;
          }
          return (
            <button
              key={k}
              type="button"
              disabled={!agg}
              onClick={() => setSelected(k)}
              style={bg ? { backgroundColor: bg } : undefined}
              className={`relative flex aspect-square flex-col items-center justify-center rounded-xl text-xs font-semibold transition ${
                agg ? "text-white hover:scale-105" : "text-ink-600"
              } ${!bg && agg ? "bg-ink-800" : ""} ${!agg ? "bg-ink-900/40" : ""} ${
                over ? "ring-1 ring-down" : ""
              } ${k === todayKey ? "outline outline-1 outline-gold-400/60" : ""}`}
            >
              {dayNum}
              {agg && agg.closedCount > 0 && (
                <span className="text-[8px] font-bold leading-none opacity-90">
                  {agg.pnl > 0 ? "+" : ""}
                  {Math.round(agg.pnl)}
                </span>
              )}
              {agg && agg.trades.some((t) => t.status === "open") && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-gold-400" />
              )}
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-center gap-4 text-[10px] text-ink-400">
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-up/60" /> green day
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm bg-down/60" /> red day
        </span>
        <span className="flex items-center gap-1">
          <span className="h-2 w-2 rounded-sm ring-1 ring-down" /> over rule
        </span>
      </div>

      {monthHasClosed && (
        <div className="mt-3 grid grid-cols-3 gap-2 border-t border-white/5 pt-3 text-center">
          <div className="rounded-xl bg-ink-800/70 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-ink-400">Month P&L</p>
            <p
              className={`text-sm font-bold ${
                monthNet > 0 ? "text-up" : monthNet < 0 ? "text-down" : "text-white"
              }`}
            >
              {fmtUsd(monthNet)}
            </p>
          </div>
          <div className="rounded-xl bg-ink-800/70 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-ink-400">Net R</p>
            <p
              className={`text-sm font-bold ${
                monthSummary.netR > 0
                  ? "text-up"
                  : monthSummary.netR < 0
                    ? "text-down"
                    : "text-white"
              }`}
            >
              {fmtR(monthSummary.netR)}
            </p>
          </div>
          <div className="rounded-xl bg-ink-800/70 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-ink-400">Win rate</p>
            <p className="text-sm font-bold text-white">
              {monthSummary.trades
                ? `${Math.round((100 * monthSummary.wins) / monthSummary.trades)}%`
                : "—"}
            </p>
          </div>
          <div className="rounded-xl bg-ink-800/70 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-ink-400">Trades</p>
            <p className="text-sm font-bold text-white">{monthSummary.trades}</p>
          </div>
          <div className="rounded-xl bg-ink-800/70 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-ink-400">Green days</p>
            <p className="text-sm font-bold text-up">{monthSummary.greenDays}</p>
          </div>
          <div className="rounded-xl bg-ink-800/70 p-2.5">
            <p className="text-[9px] uppercase tracking-wider text-ink-400">Red days</p>
            <p className="text-sm font-bold text-down">{monthSummary.redDays}</p>
          </div>
        </div>
      )}

      <Sheet
        open={selected !== null && !!sel}
        onClose={() => setSelected(null)}
        title={
          selected
            ? new Date(`${selected}T12:00:00`).toLocaleDateString(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              })
            : ""
        }
      >
        {sel && (
          <div>
            <div className="mb-4 grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-ink-800/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-ink-400">P&L</p>
                <p
                  className={`text-lg font-bold ${
                    sel.pnl > 0 ? "text-up" : sel.pnl < 0 ? "text-down" : "text-white"
                  }`}
                >
                  {sel.closedCount > 0 ? fmtUsd(sel.pnl) : "—"}
                </p>
              </div>
              <div className="rounded-xl bg-ink-800/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-ink-400">Net R</p>
                <p
                  className={`text-lg font-bold ${
                    selR > 0 ? "text-up" : selR < 0 ? "text-down" : "text-white"
                  }`}
                >
                  {sel.closedCount > 0 ? fmtR(selR) : "—"}
                </p>
              </div>
              <div className="rounded-xl bg-ink-800/70 p-3">
                <p className="text-[10px] uppercase tracking-wider text-ink-400">Trades</p>
                <p className="text-lg font-bold text-white">
                  {sel.trades.length}
                  {sel.trades.length > maxPerDay && (
                    <span className="ml-1 text-xs font-bold text-down">over rule</span>
                  )}
                </p>
              </div>
            </div>

            <ul className="space-y-3">
              {sel.trades.map((t) => (
                <li key={t.id} className="rounded-2xl border border-white/5 bg-ink-800/70 p-3.5">
                  <div className="flex items-center gap-2.5">
                    <span
                      className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ${
                        t.direction === "long" ? "bg-up/10 text-up" : "bg-down/10 text-down"
                      }`}
                    >
                      {t.direction === "long" ? (
                        <IconTrendUp className="h-4.5 w-4.5" />
                      ) : (
                        <IconTrendDown className="h-4.5 w-4.5" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold text-white">
                        {optionLabel(SETUPS, t.setup_type) ?? t.setup_type ?? "Trade"}
                      </p>
                      <p className="text-xs text-ink-400">
                        {[
                          t.timeframe,
                          new Date(t.opened_at).toLocaleTimeString([], {
                            hour: "2-digit",
                            minute: "2-digit",
                          }),
                          t.lots !== null ? `${t.lots.toFixed(2)} lots` : null,
                          t.risk_usd !== null ? `$${t.risk_usd.toFixed(0)} risk` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </p>
                    </div>
                    <div className="text-right">
                      {t.status === "open" ? (
                        <span className="text-xs font-bold uppercase text-gold-300">open</span>
                      ) : (
                        <>
                          <p
                            className={`text-sm font-bold ${
                              (t.pnl_usd ?? 0) > 0
                                ? "text-up"
                                : (t.pnl_usd ?? 0) < 0
                                  ? "text-down"
                                  : "text-ink-300"
                            }`}
                          >
                            {t.r_multiple !== null ? fmtR(t.r_multiple) : fmtUsd(t.pnl_usd ?? 0)}
                          </p>
                          {t.r_multiple !== null && (
                            <p className="text-[11px] text-ink-400">{fmtUsd(t.pnl_usd ?? 0)}</p>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                  {(t.emotions.length > 0 || t.followed_plan !== null) && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.followed_plan !== null && (
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            t.followed_plan
                              ? "border-up/40 bg-up/10 text-up"
                              : "border-down/40 bg-down/10 text-down"
                          }`}
                        >
                          {t.followed_plan ? "followed plan" : "broke plan"}
                        </span>
                      )}
                      {t.emotions.map((e) => (
                        <span
                          key={e}
                          className="rounded-full border border-white/10 bg-ink-900 px-2 py-0.5 text-[10px] text-ink-300"
                        >
                          {optionLabel(EMOTIONS, e) ?? e}
                        </span>
                      ))}
                    </div>
                  )}
                  {t.notes && (
                    <p className="mt-2 text-xs leading-relaxed text-ink-200">{t.notes}</p>
                  )}
                  {t.screenshots.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {t.screenshots.map((id) => (
                        <button key={id} type="button" onClick={() => setViewer(id)}>
                          <img
                            src={screenshotUrl(id)}
                            alt="chart screenshot"
                            className="h-16 w-24 rounded-lg border border-white/10 object-cover transition hover:border-gold-500/50"
                          />
                        </button>
                      ))}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </Sheet>

      {viewer && (
        <button
          type="button"
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-[60] flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
        >
          <img
            src={screenshotUrl(viewer)}
            alt="chart screenshot"
            className="max-h-[90dvh] max-w-full rounded-xl object-contain"
          />
        </button>
      )}
    </Card>
  );
}

interface WeeklyReport {
  week: string;
  analysis: {
    headline?: string;
    what_worked?: string[];
    what_hurt?: string[];
    pattern?: string;
    one_focus?: string;
    stat_callout?: string;
  };
}

function MonthlyProgress({ trades }: { trades: Trade[] }) {
  const months = useMemo(() => {
    const map = new Map<string, { pnl: number; r: number; n: number; wins: number }>();
    for (const t of trades) {
      if (t.status !== "closed" || t.pnl_usd === null) continue;
      const k = localDateKey(t.closed_at ?? t.opened_at).slice(0, 7);
      const m = map.get(k) ?? { pnl: 0, r: 0, n: 0, wins: 0 };
      m.pnl += t.pnl_usd;
      m.r += t.r_multiple ?? 0;
      m.n++;
      if (t.pnl_usd > 0) m.wins++;
      map.set(k, m);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6);
  }, [trades]);

  if (months.length === 0) return null;
  const maxAbs = Math.max(1, ...months.map(([, m]) => Math.abs(m.pnl)));

  return (
    <Card title="Monthly progress" icon={<IconStats />} badge="last 6 months">
      <ul className="space-y-3">
        {months.map(([key, m]) => {
          const label = new Date(`${key}-15T12:00:00`).toLocaleDateString(undefined, {
            month: "long",
            year: "numeric",
          });
          const pct = Math.max(4, (Math.abs(m.pnl) / maxAbs) * 100);
          return (
            <li key={key}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="font-medium text-white">{label}</span>
                <span
                  className={`text-xs font-bold ${
                    m.pnl > 0 ? "text-up" : m.pnl < 0 ? "text-down" : "text-ink-300"
                  }`}
                >
                  {fmtUsd(m.pnl)} · {fmtR(m.r)}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-ink-700">
                <div
                  className={`h-full rounded-full ${m.pnl >= 0 ? "bg-up" : "bg-down"}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <p className="mt-0.5 text-[10px] text-ink-400">
                {m.n} trade{m.n === 1 ? "" : "s"} · {Math.round((100 * m.wins) / m.n)}% win rate
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function WeeklyReviewCard() {
  const [report, setReport] = useState<WeeklyReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function generate(refresh: boolean) {
    setBusy(true);
    setError("");
    try {
      const r = await api<{ report: WeeklyReport }>("/coach/weekly", {
        method: "POST",
        body: JSON.stringify({ refresh }),
      });
      setReport(r.report);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  const a = report?.analysis;
  return (
    <Card title="Mate's weekly review" icon={<IconSpark />} badge={report ? `week of ${report.week}` : "coach"}>
      {!report ? (
        <div>
          <p className="text-sm leading-relaxed text-ink-300">
            Mate reads your week — every trade, emotion tag and check-in — and tells you the
            one pattern that matters and one focus for next week.
          </p>
          {error && <p className="mt-2 text-sm text-down">{error}</p>}
          <button
            type="button"
            onClick={() => void generate(false)}
            disabled={busy}
            className="mt-3 w-full rounded-xl bg-gold-500 py-2.5 font-semibold text-ink-950 transition hover:bg-gold-400 disabled:opacity-50"
          >
            {busy ? "Reading your week…" : "Get my weekly review"}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {a?.headline && (
            <p className="text-sm font-semibold leading-relaxed text-white">{a.headline}</p>
          )}
          {a?.stat_callout && (
            <p className="rounded-xl border border-gold-500/20 bg-gold-500/5 p-3 text-sm font-semibold text-gold-200">
              {a.stat_callout}
            </p>
          )}
          {a?.what_worked && a.what_worked.length > 0 && (
            <ul className="space-y-1 text-sm text-ink-200">
              {a.what_worked.map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-up" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          {a?.what_hurt && a.what_hurt.length > 0 && (
            <ul className="space-y-1 text-sm text-ink-200">
              {a.what_hurt.map((w) => (
                <li key={w} className="flex gap-2">
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-down" />
                  {w}
                </li>
              ))}
            </ul>
          )}
          {a?.pattern && (
            <p className="text-sm leading-relaxed text-ink-200">
              <span className="font-semibold text-white">The pattern: </span>
              {a.pattern}
            </p>
          )}
          {a?.one_focus && (
            <p className="border-l-2 border-gold-500/50 pl-3 text-sm font-semibold italic text-gold-100">
              Next week: {a.one_focus}
            </p>
          )}
          <button
            type="button"
            onClick={() => void generate(true)}
            disabled={busy}
            className="w-full rounded-lg border border-white/10 bg-ink-800 py-2 text-xs font-semibold text-ink-300 transition hover:text-white disabled:opacity-50"
          >
            {busy ? "…" : "Regenerate"}
          </button>
        </div>
      )}
    </Card>
  );
}

export function Stats() {
  const trades = useApp((s) => s.trades);
  const maxPerDay = useApp((s) => s.profile?.max_trades_per_day) ?? 2;
  const s = useMemo(() => computeStats(trades, maxPerDay), [trades, maxPerDay]);

  if (s.closedCount === 0 && trades.length === 0) {
    return (
      <div className="space-y-4">
        <div className="px-1">
          <h1 className="text-2xl font-bold text-white">Stats</h1>
          <p className="mt-1 text-sm text-ink-300">Process over P&L.</p>
        </div>
        <div className="rounded-2xl border border-dashed border-white/10 bg-ink-900/60 p-8 text-center">
          <p className="text-sm leading-relaxed text-ink-300">
            Close your first journaled trade and this page starts working for you: calendar,
            equity curve, win rates by setup and session, and what your emotions actually cost.
          </p>
        </div>
      </div>
    );
  }

  const worstEmotions = [...s.byEmotion].sort((a, b) => a.netR - b.netR);

  return (
    <div className="space-y-4">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-white">Stats</h1>
        <p className="mt-1 text-sm text-ink-300">
          {s.closedCount} closed trade{s.closedCount === 1 ? "" : "s"} across {s.tradeDays} day
          {s.tradeDays === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="space-y-4 lg:columns-2 lg:gap-4 lg:space-y-0 lg:[&>*]:mb-4 lg:[&>*]:break-inside-avoid">
      <div className="grid grid-cols-3 gap-2">
        <StatCard
          label="Net P&L"
          value={fmtUsd(s.netUsd)}
          tone={s.netUsd > 0 ? "up" : s.netUsd < 0 ? "down" : undefined}
        />
        <StatCard
          label="Net R"
          value={fmtR(s.netR)}
          tone={s.netR > 0 ? "up" : s.netR < 0 ? "down" : undefined}
        />
        <StatCard label="Win rate" value={s.winRate !== null ? `${s.winRate}%` : "—"} />
        <StatCard label="Avg R" value={s.avgR !== null ? fmtR(s.avgR) : "—"} />
        <StatCard
          label="Profit factor"
          value={s.profitFactor !== null ? s.profitFactor.toFixed(2) : "—"}
        />
        <StatCard label="Open now" value={String(s.openCount)} />
      </div>

      <MonthCalendar trades={trades} maxPerDay={maxPerDay} />

      <MonthlyProgress trades={trades} />

      <WeeklyReviewCard />

      <Card title="Equity curve" icon={<IconTrendUp />} badge="cumulative $">
        {s.equity.length > 2 ? (
          <EquityCurve points={s.equity} />
        ) : (
          <p className="text-sm text-ink-300">A couple more closed trades and the curve appears.</p>
        )}
      </Card>

      <Card title="Discipline" icon={<IconGauge />}>
        <ul className="space-y-2 text-sm">
          <li className="flex justify-between">
            <span className="text-ink-300">Days over your {maxPerDay}-trade rule</span>
            <span className={`font-bold ${s.overRuleDays > 0 ? "text-down" : "text-up"}`}>
              {s.overRuleDays}
            </span>
          </li>
          <li className="flex justify-between">
            <span className="text-ink-300">Plan followed</span>
            <span className="font-bold text-white">
              {s.planFollowedPct !== null ? `${s.planFollowedPct}%` : "—"}
            </span>
          </li>
          <li className="flex justify-between">
            <span className="text-ink-300">Trades per day</span>
            <span className="font-bold text-white">
              {(trades.length / Math.max(1, s.tradeDays)).toFixed(1)}
            </span>
          </li>
        </ul>
      </Card>

      {s.bySetup.length > 0 && (
        <Card title="By setup" icon={<IconStats />}>
          <BreakdownRows rows={s.bySetup} />
        </Card>
      )}

      {s.bySession.length > 0 && (
        <Card title="By session" icon={<IconStats />}>
          <BreakdownRows rows={s.bySession} />
        </Card>
      )}

      {worstEmotions.length > 0 && (
        <Card title="Emotions vs results" icon={<IconStats />} badge="net R when tagged">
          <div className="flex flex-wrap gap-2">
            {worstEmotions.map((e) => (
              <span
                key={e.id}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold ${
                  e.netR < 0
                    ? "border-down/40 bg-down/10 text-down"
                    : "border-up/40 bg-up/10 text-up"
                }`}
              >
                {e.label} {fmtR(e.netR)} · {e.n}
              </span>
            ))}
          </div>
        </Card>
      )}
      </div>
    </div>
  );
}
