import { useEffect, useState } from "react";
import { IconGear, IconMoon, IconSun } from "./components/Icons";
import { PasscodeGate } from "./components/PasscodeGate";
import { SettingsSheet } from "./components/SettingsSheet";
import { Splash } from "./components/Splash";
import { TabBar } from "./components/TabBar";
import { useApp } from "./lib/store";
import { applyTheme, currentTheme, type Theme } from "./lib/theme";
import { Analyze } from "./screens/Analyze";
import { Chart } from "./screens/Chart";
import { Journal } from "./screens/Journal";
import { Mate } from "./screens/Mate";
import { Stats } from "./screens/Stats";
import { Today } from "./screens/Today";

function Header({ onOpenSettings }: { onOpenSettings: () => void }) {
  const profile = useApp((s) => s.profile);
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <header className="sticky top-0 z-20 border-b border-white/5 bg-ink-950/85 pt-[env(safe-area-inset-top)] backdrop-blur-xl">
      <div className="mx-auto flex max-w-lg items-center gap-2.5 px-4 py-3 lg:max-w-6xl">
        <img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg" />
        <p className="text-base font-bold text-white">
          Trade<span className="text-gold-400">Mate</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {profile && (
            <span className="hidden rounded-full border border-white/10 bg-ink-800 px-2.5 py-1 text-[10px] font-medium text-ink-300 sm:inline">
              {profile.account_label}
            </span>
          )}
          <button
            type="button"
            onClick={toggleTheme}
            aria-label="Toggle theme"
            className="rounded-full border border-white/10 bg-ink-800 p-2 text-ink-300 transition hover:text-gold-400"
          >
            {theme === "dark" ? <IconSun className="h-4 w-4" /> : <IconMoon className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="rounded-full border border-white/10 bg-ink-800 p-2 text-ink-300 transition hover:text-gold-400"
          >
            <IconGear className="h-4 w-4" />
          </button>
        </div>
      </div>
    </header>
  );
}

function Shell() {
  const tab = useApp((s) => s.tab);
  const [settingsOpen, setSettingsOpen] = useState(false);
  return (
    <div className="lg:pl-56">
      <div className="mx-auto min-h-dvh max-w-lg lg:max-w-6xl">
        <Header onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <main className="px-4 pb-28 pt-4 lg:pb-10">
          <div key={tab} className="animate-enter">
            {tab === "today" ? (
              <Today />
            ) : tab === "journal" ? (
              <Journal />
            ) : tab === "stats" ? (
              <Stats />
            ) : tab === "analyze" ? (
              <Analyze />
            ) : tab === "chart" ? (
              <Chart />
            ) : (
              <Mate />
            )}
          </div>
        </main>
        <TabBar />
      </div>
    </div>
  );
}

export default function App() {
  const auth = useApp((s) => s.auth);
  const checkAuth = useApp((s) => s.checkAuth);

  useEffect(() => {
    void checkAuth();
  }, [checkAuth]);

  useEffect(() => {
    const onOnline = () => void useApp.getState().loadTrades();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, []);

  if (auth === "checking") return <Splash />;
  if (auth === "locked") return <PasscodeGate />;
  return <Shell />;
}
