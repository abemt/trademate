import { useState, type FormEvent } from "react";
import { motion } from "framer-motion";
import { useApp } from "../lib/store";
import { IconLock } from "./Icons";

export function PasscodeGate() {
  const login = useApp((s) => s.login);
  const [passcode, setPasscode] = useState("");
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [error, setError] = useState("");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!passcode || busy) return;
    setBusy(true);
    const ok = await login(passcode);
    setBusy(false);
    if (!ok) {
      setError("That's not it. Try again.");
      setAttempt((n) => n + 1);
      setPasscode("");
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center px-6">
      <motion.form
        key={attempt}
        onSubmit={onSubmit}
        initial={attempt > 0 ? { x: 0 } : { opacity: 0, y: 12 }}
        animate={
          attempt > 0
            ? { x: [0, -10, 10, -6, 6, 0], opacity: 1, y: 0 }
            : { opacity: 1, y: 0 }
        }
        transition={{ duration: 0.4 }}
        className="w-full max-w-sm rounded-3xl border border-white/5 bg-ink-900/90 p-8 shadow-[0_20px_60px_rgb(0_0_0/0.5)]"
      >
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <img src="/icon.svg" alt="" className="h-14 w-14 rounded-2xl" />
          <div>
            <h1 className="text-xl font-bold text-white">
              Trade<span className="text-gold-400">Mate</span>
            </h1>
            <p className="mt-1 text-sm text-ink-300">Your buddy's waiting. Passcode?</p>
          </div>
        </div>

        <label className="relative block">
          <IconLock className="pointer-events-none absolute left-3.5 top-1/2 h-4.5 w-4.5 -translate-y-1/2 text-ink-400" />
          <input
            type="password"
            value={passcode}
            onChange={(e) => setPasscode(e.target.value)}
            placeholder="Passcode"
            autoFocus
            className="w-full rounded-xl border border-white/10 bg-ink-800 py-3 pl-11 pr-4 text-white placeholder:text-ink-400 outline-none transition focus:border-gold-500/60 focus:ring-2 focus:ring-gold-500/20"
          />
        </label>

        {error && <p className="mt-3 text-center text-sm text-down">{error}</p>}

        <button
          type="submit"
          disabled={busy || !passcode}
          className="mt-5 w-full rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400 disabled:opacity-40"
        >
          {busy ? "Checking..." : "Let me in"}
        </button>

        {import.meta.env.DEV && (
          <p className="mt-4 text-center text-xs text-ink-400">
            dev passcode: <code className="text-ink-300">trademate-dev</code>
          </p>
        )}
      </motion.form>
    </div>
  );
}
