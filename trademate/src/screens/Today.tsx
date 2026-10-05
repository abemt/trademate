import { useMemo } from "react";
import { motion } from "framer-motion";
import { Card } from "../components/Card";
import { SitOutControl } from "../components/EntryGate";
import { useNow } from "../components/MarketCards";
import { tradingDate } from "../../shared/entryGate";
import {
  IconCoin,
  IconGauge,
  IconPlus,
  IconTrendDown,
  IconTrendUp,
} from "../components/Icons";
import {
  CircuitBreakerCard,
  DayPlanCard,
  RoutineCard,
} from "../components/TodayCards";
import { useApp } from "../lib/store";
import {
  SETUPS,
  accountTrades,
  computeStats,
  fmtR,
  fmtUsd,
  optionLabel,
} from "../lib/trades";
import {
  SESSIONS,
  formatCountdown,
  sessionStatus,
} from "../lib/sessions";

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

function TradeTokens() {
  const profile = useApp((s) => s.profile);
  const trades = useApp((s) => s.trades);
  const setTab = useApp((s) => s.setTab);
  const setLogFormOpen = useApp((s) => s.setLogFormOpen);
  const accounts = useApp((s) => s.accounts);
  const gate = useApp((s) => s.entryGate);
  const active = accounts.find((account) => account.active === 1 && account.archived === 0);
  const state = gate?.account_id === active?.id ? gate : null;
  const timezone = profile?.timezone ?? "Africa/Addis_Ababa";
  const max = state?.max_trades ?? profile?.max_trades_per_day ?? 2;
  const today = tradingDate(timezone);
  // The cap for a day is fixed when the session starts; a higher setting only applies from the next day.
  const pendingMax = state?.date === today && profile && profile.max_trades_per_day > state.max_trades ? profile.max_trades_per_day : null;
  const used = state?.date === today ? state.trade_count : accountTrades(trades, active?.id ?? null).filter((trade) => tradingDate(timezone, Date.parse(trade.opened_at)) === today).length;
  const over = used > max;
  const left = Math.max(0, max - used);

  return (
    <Card title="Trade tokens" icon={<IconCoin />} badge={pendingMax ? `today: max ${max} · from tomorrow: ${pendingMax}` : `your rule: max ${max}/day`}>
      <div className="flex items-center gap-4">
        <div className="flex max-w-48 flex-wrap gap-3">
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
              : state?.sit_out ? "Done for today. Unused tokens are not a target." : `${left} trade${left === 1 ? "" : "s"} left today. Plan first, then enter.`}
        </p>
      </div>
      {pendingMax && (
        <p className="mt-3 rounded-xl border border-gold-500/30 bg-gold-500/10 p-2.5 text-xs text-gold-300">
          You set {pendingMax}/day. Today stays at {max}: the cap is fixed before the session and can only go down during it, never up. {pendingMax} starts with the next trading day.
        </p>
      )}
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
      <SitOutControl />
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
      {/* The cockpit: only what a trading day needs. Market context lives on Chart, the life side on Life, numbers on Stats. */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-3">
        <DayPlanCard />
        <TradeTokens />
        <div className="order-first flex flex-col lg:order-none [&>section]:flex-1">
          <CircuitBreakerCard />
        </div>
        <RecentTrades />
        <RoutineCard />
        {isProp && <PropGuard />}
      </div>
    </div>
  );
}
