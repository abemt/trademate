import { useEffect, useState } from "react";
import { useApp } from "./store";

export function useEntryGate() {
  const account = useApp((state) => state.accounts.find((candidate) => candidate.active === 1 && candidate.archived === 0));
  const stored = useApp((state) => state.entryGate);
  const received = useApp((state) => state.entryGateReceivedAt);
  const error = useApp((state) => state.entryGateError);
  const loading = useApp((state) => state.entryGateLoading);
  const refresh = useApp((state) => state.loadEntryGate);
  const [elapsed, setElapsed] = useState(() => performance.now());
  useEffect(() => {
    void refresh();
    const onVisible = () => { if (document.visibilityState === "visible") void refresh(); };
    const onOnline = () => { void refresh(); };
    window.addEventListener("focus", onOnline);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const timer = window.setInterval(() => setElapsed(performance.now()), 1000);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", onOnline);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [account?.id, refresh]);
  const state = stored?.account_id === account?.id ? stored : null;
  const now = state ? Date.parse(state.server_now) + Math.max(0, elapsed - received) : Date.now();
  return { state, now, error, loading, refresh, account };
}