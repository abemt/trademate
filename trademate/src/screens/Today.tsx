import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "../components/Card";
import {
  IconClock,
  IconCoin,
  IconGauge,
  IconPlus,
  IconShield,
  IconTrendDown,
  IconTrendUp,
} from "../components/Icons";
import {
  BriefingCard,
  CheckinCard,
  CircuitBreakerCard,
  DayPlanCard,
  DisciplineCard,
  NewsWatchCard,
  RoutineCard,
} from "../components/TodayCards";
import { useApp } from "../lib/store";
import {
  SETUPS,
  accountTrades,
  computeStats,
  currentBalance,
  fmtR,
  fmtUsd,
  localDateKey,
  optionLabel,
} from "../lib/trades";
import { EquityCurve } from "../components/EquityCurve";
import {
  SESSIONS,
  formatCountdown,
  localTimeOfUtcHour,
  sessionStatus,
} from "../lib/sessions";

function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function Greeting({ now }: { now: Date }) {
  const name = useApp((s) => s.profile?.trader_name);
  const regime = useApp((s) => s.profile?.market_regime);
  const h = now.getHours();
  const word = h < 12 ? "morning" : h < 18 ? "afternoon" : "evening";
  const ny = sessionStatus(SESSIONS[2], now);
  const line = ny.open
    ? "New York is live — your prime time. Stick to the plan."
    : `New York opens in ${formatCountdown(ny.until, now)}. No forcing trades before your time.`;
  return (
    <div className="px-1">
      <h1 className="text-2xl font-bold text-white">
        Good {word}, {name && name !== "Trader" ? name : "trader"}
      </h1>
      <p className="mt-1 text-sm text-ink-300">{line}</p>
      {regime && (
        <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-ink-800 px-2.5 py-1 text-[11px] text-ink-300">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400" />
          regime: <span className="font-semibold capitalize text-white">{regime}</span>
          <span className="text-ink-400">— expect zone retests</span>
        </span>
      )}
    </div>
  );
}

function SessionClock({ now }: { now: Date }) {
  return (
    <Card title="Sessions" icon={<IconClock />}>
      <ul className="space-y-2.5">
        {SESSIONS.map((s) => {
          const st = sessionStatus(s, now);
          return (
            <li
              key={s.name}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-ink-800/70 px-3 py-2.5"
            >
              <span className="relative flex h-2.5 w-2.5">
                {st.open && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
                )}
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                    st.open ? "bg-up" : "bg-ink-600"
                  }`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  {s.name}
                  {s.prime && (
                    <span className="rounded-full bg-gold-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-gold-300">
                      prime time
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-400">
                  {localTimeOfUtcHour(s.startUtc)} – {localTimeOfUtcHour(s.endUtc)} your time
                </p>
              </div>
              <p className={`text-xs font-medium ${st.open ? "text-up" : "text-ink-300"}`}>
                {st.open ? `closes in ${formatCountdown(st.until, now)}` : `in ${formatCountdown(st.until, now)}`}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

function TradeTokens() {
  const profile = useApp((s) => s.profile);
  const trades = useApp((s) => s.trades);
  const setTab = useApp((s) => s.setTab);
  const setLogFormOpen = useApp((s) => s.setLogFormOpen);
  const max = profile?.max_trades_per_day ?? 2;
  const today = localDateKey(new Date().toISOString());
  const used = trades.filter((t) => localDateKey(t.opened_at) === today).length;
  const over = used > max;
  const left = Math.max(0, max - used);

  return (
    <Card title="Trade tokens" icon={<IconCoin />} badge={`your rule: max ${max}/day`}>
      <div className="flex items-center gap-4">
        <div className="flex gap-3">
          {Array.from({ length: max }, (_, i) => {
            const isUsed = i < used;
            return (
              <div
                key={i}
                className={`flex h-14 w-14 items-center justify-center rounded-full border-2 text-lg font-bold transition ${
                  isUsed
                    ? over
                      ? "border-down/60 bg-down/10 text-down line-through"
                      : "border-ink-600 bg-ink-800 text-ink-500 line-through"
                    : "border-gold-500/70 bg-gold-500/10 text-gold-300 shadow-[0_0_18px_rgb(232_191_91/0.15)]"
                }`}
              >
                {i + 1}
              </div>
            );
          })}
          {over && (
            <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 border-down bg-down/15 text-lg font-bold text-down">
              +{used - max}
            </div>
          )}
        </div>
        <p className="flex-1 text-sm leading-snug text-ink-300">
          {over
            ? `${used} of ${max}. Past your rule — log honestly, close the charts. Patterns beat shame.`
            : left === 0
              ? "Both used. You're done for today — win or lose, that was YOUR rule."
              : `${left} trade${left === 1 ? "" : "s"} left today. Tokens fill from your journal.`}
        </p>
      </div>
      <motion.button
        whileTap={{ scale: 0.98 }}
        onClick={() => {
          setTab("journal");
          setLogFormOpen(true);
        }}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400"
      >
        <IconPlus className="h-4.5 w-4.5" /> Log a trade
      </motion.button>
    </Card>
  );
}

const RISK_CHOICES = [0.5, 1.0];

const RANGES = [
  { id: "1d", label: "Today", days: 1 },
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "all", label: "ALL", days: null as number | null },
] as const;

function PFRing({ pf }: { pf: number | null }) {
  const frac = pf === null ? 0 : Math.min(1, pf / 3);
  const C = 2 * Math.PI * 14;
  return (
    <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
      <circle cx="18" cy="18" r="14" fill="none" stroke="var(--color-ink-700)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke={pf !== null && pf >= 1 ? "var(--color-up)" : "var(--color-down)"}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(C * frac).toFixed(1)} ${C.toFixed(1)}`}
      />
    </svg>
  );
}

function KpiTile({
  label,
  value,
  tone,
  extra,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  extra?: React.ReactNode;
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-white";
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/5 bg-ink-900/90 px-3.5 py-3 shadow-[var(--card-shadow)]">
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-wider text-ink-400">{label}</p>
        <p className={`truncate text-lg font-bold ${color}`}>{value}</p>
      </div>
      {extra}
    </div>
  );
}

function DashboardStats() {
  const profile = useApp((s) => s.profile);
  const allTrades = useApp((s) => s.trades);
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const acctTrades = useMemo(
    () => accountTrades(allTrades, active?.id ?? null),
    [allTrades, active?.id],
  );
  const [range, setRange] = useState<string>("30d");
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  const ranged = useMemo(() => {
    if (days === null) return acctTrades;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return acctTrades.filter((t) => (t.closed_at ?? t.opened_at) >= cutoff);
  }, [acctTrades, days]);
  const maxPerDay = profile?.max_trades_per_day ?? 2;
  const s = useMemo(() => computeStats(ranged, maxPerDay), [ranged, maxPerDay]);
  const balance = currentBalance(
    active?.starting_balance ?? profile?.account_size ?? 0,
    acctTrades,
  );

  // Dated cumulative curve for the selected range.
  const { curvePts, curveLabels } = useMemo(() => {
    const closed = ranged
      .filter((t) => !t.deleted && t.status === "closed" && t.pnl_usd !== null)
      .sort((a, b) => (a.closed_at ?? a.opened_at).localeCompare(b.closed_at ?? b.opened_at));
    let run = 0;
    const pts: number[] = [];
    const lbls: string[] = [];
    for (const t of closed) {
      run += t.pnl_usd ?? 0;
      pts.push(Math.round(run * 100) / 100);
      lbls.push(
        new Date(t.closed_at ?? t.opened_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      );
    }
    return { curvePts: pts, curveLabels: lbls };
  }, [ranged]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="mr-auto text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          {active?.label ?? "Account"}
        </span>
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
              range === r.id
                ? "bg-gold-500 text-ink-950"
                : "border border-white/10 bg-ink-800 text-ink-400 hover:text-ink-200"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile label="Account balance" value={`$${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <KpiTile
          label="Closed net P&L"
          value={fmtUsd(s.netUsd)}
          tone={s.netUsd > 0 ? "up" : s.netUsd < 0 ? "down" : undefined}
        />
        <KpiTile label="Win rate" value={s.winRate !== null ? `${s.winRate}%` : "—"} />
        <KpiTile
          label="Avg R / trade"
          value={s.avgR !== null ? fmtR(s.avgR) : "—"}
          tone={s.avgR !== null ? (s.avgR > 0 ? "up" : "down") : undefined}
        />
        <KpiTile
          label="Profit factor"
          value={s.profitFactor !== null ? s.profitFactor.toFixed(2) : "—"}
          extra={<PFRing pf={s.profitFactor} />}
        />
      </div>
      <Card title="Equity" icon={<IconGauge />} badge={`cumulative $ · ${RANGES.find((r) => r.id === range)?.label}`}>
        {curvePts.length > 2 ? (
          <EquityCurve points={curvePts} labels={curveLabels} />
        ) : (
          <p className="py-4 text-center text-sm text-ink-400">
            Close a few trades in this range and the curve draws itself.
          </p>
        )}
      </Card>
    </div>
  );
}

function RiskCalc() {
  const profile = useApp((s) => s.profile);
  const trades = useApp((s) => s.trades);
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const accountSize = currentBalance(
    active?.starting_balance ?? profile?.account_size ?? 10_000,
    accountTrades(trades, active?.id ?? null),
  );
  const [riskPct, setRiskPct] = useState(0.5);
  const [slPips, setSlPips] = useState(75);

  const riskUsd = (accountSize * riskPct) / 100;
  const idealLots = Math.floor((riskUsd / (slPips * 10)) * 100) / 100; // XAUUSD: $10/pip per lot
  const belowMin = idealLots < 0.01;
  // Broker minimum is 0.01 lots — on tiny accounts that IS the position, so show its real risk.
  const minLotRiskUsd = 0.01 * slPips * 10;
  const minLotRiskPct = accountSize > 0 ? (minLotRiskUsd / accountSize) * 100 : 0;

  return (
    <Card title="Risk Guard" icon={<IconShield />} badge={active?.label ?? profile?.account_label ?? "account"}>
      <div className="mb-3 flex gap-2">
        {RISK_CHOICES.map((r) => (
          <button
            key={r}
            onClick={() => setRiskPct(r)}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition ${
              riskPct === r
                ? "bg-gold-500 text-ink-950"
                : "border border-white/10 bg-ink-800 text-ink-300 hover:text-white"
            }`}
          >
            {r}%
          </button>
        ))}
        <span className="ml-auto self-center text-xs text-ink-400">
          ${accountSize.toLocaleString(undefined, { maximumFractionDigits: 0 })} balance
        </span>
      </div>

      <label className="block text-xs text-ink-300">
        Stop loss: <span className="font-semibold text-white">{slPips} pips</span>
        <input
          type="range"
          min={20}
          max={150}
          step={5}
          value={slPips}
          onChange={(e) => setSlPips(Number(e.target.value))}
          className="mt-1.5 w-full accent-(--color-gold-400)"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-ink-800/70 p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Position size</p>
          <p className={`text-xl font-bold ${belowMin ? "text-down" : "text-gold-300"}`}>
            {belowMin ? "0.01*" : idealLots.toFixed(2)} lots
          </p>
        </div>
        <div className="rounded-xl bg-ink-800/70 p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            {belowMin ? "Real risk at 0.01" : "Risk"}
          </p>
          <p className={`text-xl font-bold ${belowMin ? "text-down" : "text-white"}`}>
            ${belowMin ? minLotRiskUsd.toFixed(0) : riskUsd.toFixed(2)}
          </p>
        </div>
      </div>
      {belowMin && (
        <p className="mt-2 rounded-xl border border-down/30 bg-down/5 p-2.5 text-xs leading-relaxed text-down">
          *This account is below minimum operating size: {riskPct}% risk would need{" "}
          {idealLots.toFixed(3)} lots, but the broker minimum 0.01 risks ${minLotRiskUsd.toFixed(0)} ={" "}
          {minLotRiskPct.toFixed(0)}% of the account at this stop. There is no compliant size — that's
          math, not opinion. Per your contract: this account buys reps, not growth.
        </p>
      )}
    </Card>
  );
}

function PropGuard() {
  const profile = useApp((s) => s.profile);
  const trades = useApp((s) => s.trades);
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const acctTrades = useMemo(
    () => accountTrades(trades, active?.id ?? null),
    [trades, active?.id],
  );
  const maxPerDay = profile?.max_trades_per_day ?? 2;
  const stats = useMemo(() => computeStats(acctTrades, maxPerDay), [acctTrades, maxPerDay]);
  const phase = profile?.eval_phase ?? 1;
  const target =
    (phase === 2 ? profile?.prop_profit_target_p2_usd : profile?.prop_profit_target_usd) ??
    1000;

  const rows = [
    {
      label: "Daily loss limit",
      used: Math.max(0, -stats.todayPnl),
      limit: profile?.prop_daily_loss_usd ?? 500,
      bar: "bg-down",
      note: "resets daily",
    },
    {
      label: "Max drawdown",
      used: stats.drawdownFromPeak,
      limit: profile?.prop_max_drawdown_usd ?? 1000,
      bar: "bg-down",
      note: "from peak",
    },
    {
      label: "Profit target",
      used: Math.max(0, stats.netUsd),
      limit: target,
      bar: "bg-up",
      note: phase === 1 ? "then phase 2" : "last phase",
    },
  ];

  return (
    <Card
      title="Prop Guard"
      icon={<IconGauge />}
      badge={`${active?.label ?? "prop account"} · phase ${phase}`}
    >
      <ul className="space-y-3">
        {rows.map((r) => {
          const pct = Math.min(100, Math.max(0, (r.used / r.limit) * 100));
          return (
            <li key={r.label}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-ink-300">
                  {r.label} <span className="text-[10px] text-ink-400">· {r.note}</span>
                </span>
                <span className="font-semibold text-white">
                  ${Math.round(r.used).toLocaleString()}
                  <span className="text-ink-400"> / ${r.limit.toLocaleString()} · {Math.round(pct)}%</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className={`h-full rounded-full ${r.bar} transition-all`}
                  style={{ width: `${Math.max(2, pct)}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-400">
        Based on this account's journal. News rule: flat ±{profile?.news_buffer_min ?? 5} min
        around red news — relaxed on your eval, but Mate warns you anyway.
      </p>
    </Card>
  );
}

function RecentTrades() {
  const allTrades = useApp((s) => s.trades);
  const accounts = useApp((s) => s.accounts);
  const setTab = useApp((s) => s.setTab);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const recent = useMemo(
    () =>
      accountTrades(allTrades, active?.id ?? null)
        .filter((t) => !t.deleted)
        .slice(0, 5),
    [allTrades, active?.id],
  );

  return (
    <Card title="Recent trades" icon={<IconCoin />} badge="last 5">
      {recent.length === 0 ? (
        <p className="py-2 text-center text-sm text-ink-400">
          Nothing logged yet — the journal is hungry.
        </p>
      ) : (
        <ul className="space-y-2">
          {recent.map((t) => {
            const long = t.direction === "long";
            const pnl = t.pnl_usd ?? 0;
            return (
              <li
                key={t.id}
                className="flex items-center gap-2.5 rounded-xl border border-white/5 bg-ink-800/60 px-3 py-2"
              >
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
                    long ? "bg-up/10 text-up" : "bg-down/10 text-down"
                  }`}
                >
                  {long ? <IconTrendUp className="h-3.5 w-3.5" /> : <IconTrendDown className="h-3.5 w-3.5" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-white">
                    {optionLabel(SETUPS, t.setup_type) ?? t.setup_type ?? "Trade"}
                  </p>
                  <p className="text-[10px] text-ink-400">
                    {new Date(t.opened_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                    {t.timeframe ? ` · ${t.timeframe}` : ""}
                  </p>
                </div>
                {t.status === "open" ? (
                  <span className="text-[10px] font-bold uppercase text-gold-400">open</span>
                ) : (
                  <span className={`text-xs font-bold ${pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-ink-300"}`}>
                    {t.r_multiple !== null ? fmtR(t.r_multiple) : fmtUsd(pnl)}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setTab("journal")}
        className="mt-2.5 w-full rounded-lg border border-white/10 bg-ink-800 py-1.5 text-[11px] font-semibold text-ink-300 transition hover:text-gold-400"
      >
        All trades ›
      </button>
    </Card>
  );
}

export function Today() {
  const now = useNow();
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const isProp = active ? active.type === "prop_eval" || active.type === "prop_funded" : false;
  return (
    <div className="space-y-4">
      <Greeting now={now} />
      <DashboardStats />
      <div className="space-y-4 lg:grid lg:grid-cols-[minmax(0,1fr)_340px] lg:items-start lg:gap-4 lg:space-y-0">
        <div className="space-y-4">
          <RecentTrades />
          <BriefingCard />
          <NewsWatchCard />
          <RiskCalc />
          {isProp && <PropGuard />}
        </div>
        <div className="space-y-4">
          <CircuitBreakerCard />
          <DayPlanCard />
          <RoutineCard />
          <CheckinCard />
          <TradeTokens />
          <SessionClock now={now} />
          <DisciplineCard />
        </div>
      </div>
    </div>
  );
}
