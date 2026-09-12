import { useEffect, useRef, useState } from "react";
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
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const [theme, setTheme] = useState<Theme>(() => currentTheme());

  function toggleTheme() {
    const next = theme === "dark" ? "light" : "dark";
    applyTheme(next);
    setTheme(next);
  }

  return (
    <header className="z-20 shrink-0 border-b border-white/5 bg-ink-950/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-xl lg:px-8">
      <div className="mx-auto flex max-w-lg items-center gap-2.5 py-3 lg:max-w-[1440px]">
        <img src="/icon.svg" alt="" className="h-7 w-7 rounded-lg lg:hidden" />
        <p className="text-base font-bold text-white lg:hidden">
          Trade<span className="text-gold-500">Mate</span>
        </p>
        <div className="ml-auto flex items-center gap-2">
          {(active || profile) && (
            <span className="rounded-full border border-gold-500/30 bg-gold-500/8 px-2.5 py-1 text-[10px] font-semibold text-gold-400">
              {active?.label ?? profile?.account_label}
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
  const mainRef = useRef<HTMLElement>(null);
  useEffect(() => {
    mainRef.current?.scrollTo({ top: 0 });
  }, [tab]);
  const chat = tab === "mate";
  return (
    <div className="lg:pl-56">
      <div className="flex h-dvh flex-col">
        <Header onOpenSettings={() => setSettingsOpen(true)} />
        <SettingsSheet open={settingsOpen} onClose={() => setSettingsOpen(false)} />
        <main
          ref={mainRef}
          className={`flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-4 lg:px-8 ${
            chat ? "pb-[calc(4.5rem+env(safe-area-inset-bottom))] lg:pb-4" : "pb-28 lg:pb-10"
          }`}
        >
          <div key={tab} className={`animate-enter mx-auto w-full max-w-lg lg:max-w-[1440px] ${chat ? "flex min-h-0 flex-1 flex-col" : ""}`}>
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
