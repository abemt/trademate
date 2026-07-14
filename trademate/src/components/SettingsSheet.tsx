import { useEffect, useState } from "react";
import { Chip, ChipRow, FieldLabel } from "./Chip";
import { Sheet } from "./Sheet";
import { api } from "../lib/api";
import { pushState, sendTestPush, subscribePush, type PushState } from "../lib/push";
import { useApp } from "../lib/store";

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useApp((s) => s.profile);
  const loadProfile = useApp((s) => s.loadProfile);

  const [name, setName] = useState("");
  const [balance, setBalance] = useState("");
  const [maxTrades, setMaxTrades] = useState(2);
  const [phase, setPhase] = useState(1);
  const [regime, setRegime] = useState("choppy");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    if (!open || !profile) return;
    setName(profile.trader_name);
    setBalance(String(profile.account_size));
    setMaxTrades(profile.max_trades_per_day);
    setPhase(profile.eval_phase);
    setRegime(profile.market_regime);
    setSaved(false);
    setError("");
    setTestSent(false);
    void pushState().then(setPush);
  }, [open, profile]);

  async function save() {
    setSaving(true);
    setError("");
    try {
      await api("/profile", {
        method: "PUT",
        body: JSON.stringify({
          trader_name: name,
          account_size: Number.parseFloat(balance),
          max_trades_per_day: maxTrades,
          eval_phase: phase,
          market_regime: regime,
        }),
      });
      await loadProfile();
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed.");
    } finally {
      setSaving(false);
    }
  }

  async function enablePush() {
    setPushBusy(true);
    try {
      const ok = await subscribePush();
      setPush(ok ? "subscribed" : await pushState());
    } finally {
      setPushBusy(false);
    }
  }

  async function logout() {
    await api("/auth/logout", { method: "POST" }).catch(() => {});
    location.reload();
  }

  return (
    <Sheet open={open} onClose={onClose} title="Settings">
      <div className="space-y-5">
        <div>
          <FieldLabel>Your name</FieldLabel>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white outline-none focus:border-gold-500/60"
          />
        </div>

        <div>
          <FieldLabel>Account balance ($) — keep in sync with your broker</FieldLabel>
          <input
            type="text"
            inputMode="decimal"
            value={balance}
            onChange={(e) => setBalance(e.target.value)}
            className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white outline-none focus:border-gold-500/60"
          />
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <FieldLabel>Max trades / day</FieldLabel>
            <ChipRow>
              {[1, 2, 3].map((n) => (
                <Chip key={n} active={maxTrades === n} onClick={() => setMaxTrades(n)}>
                  {n}
                </Chip>
              ))}
            </ChipRow>
          </div>
          <div>
            <FieldLabel>Eval phase</FieldLabel>
            <ChipRow>
              {[1, 2].map((n) => (
                <Chip key={n} active={phase === n} onClick={() => setPhase(n)}>
                  Phase {n}
                </Chip>
              ))}
            </ChipRow>
          </div>
        </div>

        <div>
          <FieldLabel>Market regime (Mate grades setups against this)</FieldLabel>
          <ChipRow>
            {["choppy", "trending", "mixed"].map((r) => (
              <Chip key={r} active={regime === r} onClick={() => setRegime(r)}>
                {r}
              </Chip>
            ))}
          </ChipRow>
        </div>

        {error && <p className="text-sm text-down">{error}</p>}
        <button
          type="button"
          onClick={() => void save()}
          disabled={saving}
          className="w-full rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400 disabled:opacity-50"
        >
          {saving ? "Saving…" : saved ? "Saved" : "Save settings"}
        </button>

        <div className="border-t border-white/5 pt-4">
          <FieldLabel>Push notifications — briefings & market alerts, app closed</FieldLabel>
          {push === "unsupported" && (
            <p className="text-sm text-ink-400">
              Available on the installed app (Add to Home screen) or the live site — not in
              local dev.
            </p>
          )}
          {push === "denied" && (
            <p className="text-sm text-down">
              Notifications are blocked for this site — enable them in your browser settings.
            </p>
          )}
          {push === "ready" && (
            <button
              type="button"
              onClick={() => void enablePush()}
              disabled={pushBusy}
              className="w-full rounded-xl border border-gold-500/40 bg-gold-500/10 py-2.5 text-sm font-semibold text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50"
            >
              {pushBusy ? "Enabling…" : "Enable push on this device"}
            </button>
          )}
          {push === "subscribed" && (
            <div className="space-y-2">
              <p className="text-sm font-semibold text-up">Push is on for this device.</p>
              <button
                type="button"
                onClick={() => {
                  setTestSent(true);
                  void sendTestPush();
                }}
                className="w-full rounded-xl border border-white/10 bg-ink-800 py-2.5 text-sm font-semibold text-ink-200 transition hover:text-white"
              >
                {testSent ? "Sent — check your notifications" : "Send a test notification"}
              </button>
            </div>
          )}
        </div>

        <div className="border-t border-white/5 pt-4">
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full rounded-xl border border-down/30 bg-down/10 py-2.5 text-sm font-semibold text-down transition hover:bg-down/20"
          >
            Lock the app (log out)
          </button>
        </div>
      </div>
    </Sheet>
  );
}
