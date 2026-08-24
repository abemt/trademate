import { motion } from "framer-motion";
import { TABS, useApp, type Tab } from "../lib/store";
import { accountTrades, currentBalance } from "../lib/trades";
import {
  IconCandles,
  IconChat,
  IconCrosshair,
  IconHome,
  IconJournal,
  IconStats,
} from "./Icons";

const META: Record<Tab, { label: string; icon: typeof IconHome }> = {
  today: { label: "Today", icon: IconHome },
  analyze: { label: "Analyze", icon: IconCrosshair },
  chart: { label: "Chart", icon: IconCandles },
  mate: { label: "Mate", icon: IconChat },
  journal: { label: "Journal", icon: IconJournal },
  stats: { label: "Stats", icon: IconStats },
};

export function TabBar() {
  const tab = useApp((s) => s.tab);
  const setTab = useApp((s) => s.setTab);
  const accounts = useApp((s) => s.accounts);
  const trades = useApp((s) => s.trades);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const balance = active
    ? currentBalance(active.starting_balance, accountTrades(trades, active.id))
    : null;

  return (
    <>
      {/* Desktop: left sidebar */}
      <aside className="fixed inset-y-0 left-0 z-20 hidden w-56 flex-col border-r border-white/5 bg-ink-950/85 backdrop-blur-xl lg:flex">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-6">
          <img src="/icon.svg" alt="" className="h-8 w-8 rounded-lg" />
          <p className="text-lg font-bold text-white">
            Trade<span className="text-gold-500">Mate</span>
          </p>
        </div>
        <nav className="flex flex-col gap-1 px-3">
          {TABS.map((t) => {
            const { label, icon: Icon } = META[t];
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                  active ? "text-gold-500" : "text-ink-400 hover:bg-ink-800 hover:text-ink-200"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="side-pill"
                    className="absolute inset-0 rounded-xl bg-gold-500/12"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className="relative z-10 h-5 w-5" />
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </nav>
        <div className="mt-auto px-3 pb-5">
          {active && (
            <div className="mb-3 rounded-xl border border-white/10 bg-ink-900/70 p-3">
              <p className="truncate text-xs font-semibold text-white">{active.label}</p>
              <p className="text-[10px] text-ink-400">
                live balance{" "}
                <span className={`font-bold ${balance !== null && balance >= active.starting_balance ? "text-up" : "text-down"}`}>
                  ${balance?.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </p>
            </div>
          )}
          <p className="px-2 text-[10px] text-ink-500">Process over P&L.</p>
        </div>
      </aside>

      {/* Mobile: bottom tab bar */}
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-ink-950/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-2 py-1">
          {TABS.map((t) => {
            const { label, icon: Icon } = META[t];
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`relative flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[10px] font-semibold transition-colors ${
                  active ? "text-gold-500" : "text-ink-400 hover:text-ink-200"
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="tab-pill"
                    className="absolute inset-x-1 inset-y-0.5 rounded-xl bg-gold-500/12"
                    transition={{ type: "spring", stiffness: 500, damping: 40 }}
                  />
                )}
                <Icon className="relative z-10 h-5.5 w-5.5" />
                <span className="relative z-10">{label}</span>
              </button>
            );
          })}
        </div>
      </nav>
    </>
  );
}
