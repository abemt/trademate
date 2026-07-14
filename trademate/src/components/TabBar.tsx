import { motion } from "framer-motion";
import { TABS, useApp, type Tab } from "../lib/store";
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

  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-white/5 bg-ink-950/85 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg items-stretch justify-around px-2">
        {TABS.map((t) => {
          const { label, icon: Icon } = META[t];
          const active = tab === t;
          return (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`relative flex flex-1 flex-col items-center gap-1 py-2.5 text-[10px] font-medium transition-colors ${
                active ? "text-gold-400" : "text-ink-400 hover:text-ink-200"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="tab-pill"
                  className="absolute -top-px h-0.5 w-10 rounded-full bg-gold-400"
                  transition={{ type: "spring", stiffness: 500, damping: 40 }}
                />
              )}
              <Icon className="h-5.5 w-5.5" />
              {label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
