import { useEffect, useState } from "react";
import { Chip, ChipRow, FieldLabel } from "./Chip";
import { Sheet } from "./Sheet";
import { api } from "../lib/api";
import { pushState, sendTestPush, subscribePush, type PushState } from "../lib/push";
import { useApp } from "../lib/store";
import { ACCOUNT_TYPES, accountTrades, currentBalance, optionLabel } from "../lib/trades";

function AccountsManager() {
  const accounts = useApp((s) => s.accounts);
  const trades = useApp((s) => s.trades);
  const addAccount = useApp((s) => s.addAccount);
  const activateAccount = useApp((s) => s.activateAccount);
  const archiveAccount = useApp((s) => s.archiveAccount);

  const [adding, setAdding] = useState(false);
  const [label, setLabel] = useState("");
  const [type, setType] = useState("personal");
  const [start, setStart] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const live = accounts.filter((a) => a.archived === 0);

  async function create() {
    if (!label.trim()) {
      setErr("Give it a name — e.g. Personal $10 or FundingPips 10K");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await addAccount({
        label: label.trim(),
        type,
        starting_balance: Number.parseFloat(start) || 0,
      });
      setAdding(false);
      setLabel("");
      setStart("");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to add account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <FieldLabel>Accounts — tap to switch, journal follows the active one</FieldLabel>
      <ul className="space-y-2">
        {live.map((a) => {
          const bal = currentBalance(a.starting_balance, accountTrades(trades, a.id));
          const isActive = a.active === 1;
          return (
            <li
              key={a.id}
              className={`flex items-center gap-2.5 rounded-xl border p-3 transition ${
                isActive
                  ? "border-gold-500/60 bg-gold-500/10"
                  : "border-white/10 bg-ink-800"
              }`}
            >
              <button
                type="button"
                onClick={() => void activateAccount(a.id)}
                className="min-w-0 flex-1 text-left"
              >
                <p className="flex items-center gap-2 truncate text-sm font-semibold text-white">
                  {a.label}
                  {isActive && (
                    <span className="rounded-full bg-gold-500/20 px-1.5 py-px text-[9px] font-bold uppercase tracking-wider text-gold-300">
                      active
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-400">
                  {optionLabel(ACCOUNT_TYPES, a.type) ?? a.type} · started $
                  {a.starting_balance.toLocaleString(undefined, { maximumFractionDigits: 2 })} · live{" "}
                  <span className={`font-semibold ${bal >= a.starting_balance ? "text-up" : "text-down"}`}>
                    ${bal.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                </p>
              </button>
              {live.length > 1 && (
                <button
                  type="button"
                  onClick={() => {
                    if (window.confirm(`Archive "${a.label}"? Its trades stay in your history.`)) {
                      void archiveAccount(a.id);
                    }
                  }}
                  className="rounded-lg border border-white/10 bg-ink-900 px-2 py-1 text-[10px] font-semibold text-ink-400 transition hover:border-down/50 hover:text-down"
                >
                  archive
                </button>
              )}
            </li>
          );
        })}
      </ul>

      {adding ? (
        <div className="mt-3 space-y-3 rounded-xl border border-gold-500/25 bg-gold-500/5 p-3">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder='Name — e.g. "Personal $10" or "FundingPips 10K"'
            autoFocus
            className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          <ChipRow>
            {ACCOUNT_TYPES.map((t) => (
              <Chip key={t.id} active={type === t.id} onClick={() => setType(t.id)}>
                {t.label}
              </Chip>
            ))}
          </ChipRow>
          <input
            type="text"
            inputMode="decimal"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            placeholder="Starting balance ($)"
            className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          {err && <p className="text-xs text-down">{err}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setAdding(false)}
              className="rounded-xl border border-white/10 bg-ink-800 py-2 text-sm font-semibold text-ink-300"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={busy}
              className="rounded-xl bg-gold-500 py-2 text-sm font-semibold text-ink-950 disabled:opacity-50"
            >
              {busy ? "Adding…" : "Add & switch"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="mt-3 w-full rounded-xl border border-dashed border-gold-500/40 bg-gold-500/5 py-2.5 text-sm font-semibold text-gold-400 transition hover:bg-gold-500/10"
        >
          ＋ Add account (new personal, funded, or a reset)
        </button>
      )}
    </div>
  );
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const profile = useApp((s) => s.profile);
  const loadProfile = useApp((s) => s.loadProfile);

  const [name, setName] = useState("");
  const [maxTrades, setMaxTrades] = useState(2);
  const [phase, setPhase] = useState(1);
  const [regime, setRegime] = useState("choppy");
  const [riskMin, setRiskMin] = useState("0.5");
  const [riskMax, setRiskMax] = useState("1");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [push, setPush] = useState<PushState>("unsupported");
  const [pushBusy, setPushBusy] = useState(false);
  const [testSent, setTestSent] = useState(false);

  useEffect(() => {
    if (!open || !profile) return;
    setName(profile.trader_name);
    setMaxTrades(profile.max_trades_per_day);
    setPhase(profile.eval_phase);
    setRegime(profile.market_regime);
    setRiskMin(String(profile.risk_pct_min));
    setRiskMax(String(profile.risk_pct_max));
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
          max_trades_per_day: maxTrades,
          eval_phase: phase,
          market_regime: regime,
          risk_pct_min: Number.parseFloat(riskMin) || undefined,
          risk_pct_max: Number.parseFloat(riskMax) || undefined,
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
        <AccountsManager />

        <div>
          <FieldLabel>Your name</FieldLabel>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
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
          <FieldLabel>Risk per trade — min to max % (Mate enforces this range)</FieldLabel>
          <div className="flex items-center gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={riskMin}
              onChange={(e) => setRiskMin(e.target.value)}
              className="w-24 rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-gold-500/60"
            />
            <span className="text-ink-400">to</span>
            <input
              type="text"
              inputMode="decimal"
              value={riskMax}
              onChange={(e) => setRiskMax(e.target.value)}
              className="w-24 rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white outline-none focus:border-gold-500/60"
            />
            <span className="text-xs text-ink-400">% of account</span>
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
