import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import { Card } from "../components/Card";
import {
  IconClock,
  IconCoin,
  IconGauge,
  IconPlus,
  IconShield,
} from "../components/Icons";
import {
  BriefingCard,
  CheckinCard,
  CircuitBreakerCard,
  DisciplineCard,
  NewsWatchCard,
} from "../components/TodayCards";
import { useApp } from "../lib/store";
import { computeStats, currentBalance, localDateKey } from "../lib/trades";
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

function RiskCalc() {
  const profile = useApp((s) => s.profile);
  const trades = useApp((s) => s.trades);
  const accountSize = currentBalance(profile?.account_size ?? 10_000, trades);
  const [riskPct, setRiskPct] = useState(0.5);
  const [slPips, setSlPips] = useState(75);

  const riskUsd = (accountSize * riskPct) / 100;
  const lots = Math.floor((riskUsd / (slPips * 10)) * 100) / 100; // XAUUSD: $10/pip per lot

  return (
    <Card title="Risk Guard" icon={<IconShield />} badge={profile?.account_label ?? "10k eval"}>
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
          <p className="text-xl font-bold text-gold-300">{lots.toFixed(2)} lots</p>
        </div>
        <div className="rounded-xl bg-ink-800/70 p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Risk</p>
          <p className="text-xl font-bold text-white">${riskUsd.toFixed(0)}</p>
        </div>
      </div>
    </Card>
  );
}

function PropGuard() {
  const profile = useApp((s) => s.profile);
  const trades = useApp((s) => s.trades);
  const maxPerDay = profile?.max_trades_per_day ?? 2;
  const stats = useMemo(() => computeStats(trades, maxPerDay), [trades, maxPerDay]);
  const phase = profile?.eval_phase ?? 1;
  const acct = profile?.account_size ?? 10_000;
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
      note: phase === 1 ? "then phase 2: 5%" : "last phase",
    },
  ];

  return (
    <Card title="Prop Guard" icon={<IconGauge />} badge={`Alpha Capital · phase ${phase}`}>
      <ul className="space-y-3">
        {rows.map((r) => {
          const pct = Math.min(100, (r.used / r.limit) * 100);
          return (
            <li key={r.label}>
              <div className="mb-1 flex items-baseline justify-between text-sm">
                <span className="text-ink-300">
                  {r.label}{" "}
                  <span className="text-[10px] text-ink-400">
                    · {r.note} · ${r.limit.toLocaleString()}
                  </span>
                </span>
                <span className="font-semibold text-white">
                  {((r.used / acct) * 100).toFixed(1)}%
                  <span className="text-ink-400"> / {Math.round((r.limit / acct) * 100)}%</span>
                </span>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-ink-700">
                <div
                  className={`h-full rounded-full ${r.bar} transition-all`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-xs leading-relaxed text-ink-400">
        Based on your journal. News rule: flat ±{profile?.news_buffer_min ?? 5} min around red
        news — relaxed on your eval, but Mate warns you anyway.
      </p>
    </Card>
  );
}

export function Today() {
  const now = useNow();
  return (
    <div className="space-y-4 lg:columns-2 lg:gap-4 lg:space-y-0 lg:[&>*]:mb-4 lg:[&>*]:break-inside-avoid">
      <Greeting now={now} />
      <CircuitBreakerCard />
      <CheckinCard />
      <BriefingCard />
      <TradeTokens />
      <SessionClock now={now} />
      <RiskCalc />
      <PropGuard />
      <NewsWatchCard />
      <DisciplineCard />
    </div>
  );
}
