import { useState, type FormEvent } from "react";
import { ENTRY_SETUPS, noTradeWin, planBlock, sessionBlock, validateEntryPlan, type EntryGateState, type EntryPlan } from "../../shared/entryGate";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useEntryGate } from "../lib/useEntryGate";
import { IconLock, IconShield, IconX } from "./Icons";

const inputClass = "mt-1.5 block w-full min-w-0 rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white outline-none placeholder:text-ink-400 focus:border-gold-500/60 disabled:opacity-50";
const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-gold-500 px-4 py-3 text-sm font-semibold text-ink-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-40";

const BIASES = [
  { id: "bullish", label: "Bullish" },
  { id: "bearish", label: "Bearish" },
  { id: "neutral", label: "Neutral / range" },
] as const;

function Choice<T extends string>({ options, value, onChange, tone }: { options: readonly { id: T; label: string }[]; value: T | ""; onChange: (id: T) => void; tone?: (id: T) => string }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => onChange(option.id)}
          className={`rounded-xl border px-3.5 py-2 text-sm font-semibold transition ${
            value === option.id ? tone?.(option.id) ?? "border-gold-500 bg-gold-500/15 text-gold-300" : "border-white/10 bg-ink-800 text-ink-300 hover:border-gold-500/40"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function PlanEditor({ submit, busy }: { submit: (details: unknown) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState({ bias: "" as "" | "bullish" | "bearish" | "neutral", direction: "" as "" | "long" | "short", setup: "" as "" | typeof ENTRY_SETUPS[number]["id"], thesis: "", invalidation_price: "", alert_price: "", invalidation_rule: "", condition1: "", condition2: "", condition3: "", no_trade_if: "" });
  const update = <K extends keyof typeof draft>(key: K, value: (typeof draft)[K]) => setDraft((previous) => ({ ...previous, [key]: value }));
  const label = (text: string, optional = false) => (
    <span className="mb-1 block text-[11px] font-bold uppercase tracking-wider text-ink-300">{text}{optional && <span className="ml-1 font-medium normal-case tracking-normal text-ink-400">optional</span>}</span>
  );
  const conflict = (draft.bias === "bullish" && draft.direction === "short") || (draft.bias === "bearish" && draft.direction === "long");
  async function lock(event: FormEvent) {
    event.preventDefault();
    await submit({
      ...draft,
      invalidation_price: Number(draft.invalidation_price),
      alert_price: draft.alert_price.trim() === "" ? undefined : Number(draft.alert_price),
      invalidation_rule: draft.invalidation_rule.trim() || undefined,
      no_trade_if: draft.no_trade_if.trim() || undefined,
      conditions: [draft.condition1, draft.condition2, draft.condition3],
    });
  }
  return (
    <form onSubmit={(event) => void lock(event)}>
      <fieldset disabled={busy} className="space-y-4">
        <div>
          {label("Daily bias")}
          <Choice options={BIASES} value={draft.bias} onChange={(id) => update("bias", id)} tone={(id) => id === "bullish" ? "border-up/60 bg-up/15 text-up" : id === "bearish" ? "border-down/60 bg-down/15 text-down" : "border-gold-500 bg-gold-500/15 text-gold-300"} />
        </div>
        <div>
          {label("Direction")}
          <Choice options={[{ id: "long", label: "LONG" }, { id: "short", label: "SHORT" }] as const} value={draft.direction} onChange={(id) => update("direction", id)} tone={(id) => id === "long" ? "border-up/60 bg-up/15 text-up" : "border-down/60 bg-down/15 text-down"} />
          {conflict && <p className="mt-1.5 text-xs text-down">This direction contradicts your bias. Change the bias or skip the trade.</p>}
        </div>
        <div>
          {label("Setup")}
          <Choice options={ENTRY_SETUPS} value={draft.setup} onChange={(id) => update("setup", id)} />
        </div>
        <label className="block">
          {label("Why this trade")}
          <textarea required rows={2} placeholder='e.g. "Bearish day, price back at the H1 supply that rejected twice"' className={`${inputClass} mt-0 resize-none`} value={draft.thesis} onChange={(event) => update("thesis", event.target.value)} />
        </label>
        <div>
          {label("Must see before entry — all three")}
          <div className="space-y-2">
            {(["condition1", "condition2", "condition3"] as const).map((key, index) => (
              <input key={key} required type="text" placeholder={["1. Location: price at my level", "2. Setup: the double top / rejection forms", "3. Trigger: M15 candle closes"][index]} className={`${inputClass} mt-0`} value={draft[key]} onChange={(event) => update(key, event.target.value)} />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            {label("Invalidation price")}
            <input required type="number" inputMode="decimal" min="0.01" step="any" placeholder="3510" className={`${inputClass} mt-0`} value={draft.invalidation_price} onChange={(event) => update("invalidation_price", event.target.value)} />
          </label>
          <label className="block">
            {label("Alert level", true)}
            <input type="number" inputMode="decimal" min="0.01" step="any" placeholder="3500" className={`${inputClass} mt-0`} value={draft.alert_price} onChange={(event) => update("alert_price", event.target.value)} />
          </label>
        </div>
        <label className="block">
          {label("What proves me wrong", true)}
          <input type="text" placeholder='e.g. "M15 close above the zone"' className={`${inputClass} mt-0`} value={draft.invalidation_rule} onChange={(event) => update("invalidation_rule", event.target.value)} />
        </label>
        <label className="block">
          {label("I walk away if", true)}
          <input type="text" placeholder='e.g. "price runs without me — no chasing"' className={`${inputClass} mt-0`} value={draft.no_trade_if} onChange={(event) => update("no_trade_if", event.target.value)} />
        </label>
        <button type="submit" className={`${actionClass} w-full`} disabled={busy || conflict || !draft.bias || !draft.direction || !draft.setup}>
          <IconLock className="h-4 w-4 shrink-0" />{busy ? "Saving plan..." : "Lock plan → enter"}
        </button>
      </fieldset>
    </form>
  );
}

export function PlanSummary({ plan, timezone }: { plan: EntryPlan; timezone: string }) {
  const setup = ENTRY_SETUPS.find((candidate) => candidate.id === plan.details.setup)?.label ?? plan.details.setup;
  return (
    <div className="space-y-2 rounded-2xl border border-gold-500/25 bg-gold-500/5 p-3.5 text-sm [overflow-wrap:anywhere]">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300">
        <span>Planned {new Date(plan.created_at).toLocaleTimeString([], { timeZone: timezone, hour: "2-digit", minute: "2-digit" })} · <span className="uppercase">{plan.details.bias}</span> · <span className="uppercase">{plan.details.direction}</span></span>
        <span className="font-semibold text-gold-400">{setup}</span>
      </div>
      <p className="text-ink-100">{plan.details.thesis}</p>
      <ol className="list-decimal space-y-0.5 pl-5 text-ink-200">
        {plan.details.conditions.map((condition, index) => <li key={index}>{condition}</li>)}
      </ol>
      <p className="text-ink-200">
        <span className="text-ink-400">Invalidation</span> <span className="font-semibold text-white">{plan.details.invalidation_price}</span>
        {plan.details.invalidation_rule && <span> — {plan.details.invalidation_rule}</span>}
        {plan.details.alert_price != null && <span className="text-ink-400"> · alert {plan.details.alert_price}</span>}
      </p>
      {plan.details.no_trade_if && <p className="text-xs text-ink-300">Walk away if: {plan.details.no_trade_if}</p>}
    </div>
  );
}

/** Plan-first step of "Log a trade": write the plan, then the ticket opens. */
export function EntryGate({ onReady, onUnplanned }: { onReady: (state: EntryGateState) => void; onUnplanned?: () => void }) {
  const { state, now, error: loadError, loading, refresh, account } = useEntryGate();
  const accept = useApp((store) => store.acceptEntryGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function action(route: string, body: unknown): Promise<EntryGateState | null> {
    if (busy) return null;
    setBusy(true); setError("");
    try {
      const result = await api<EntryGateState>(route, { method: "POST", body: JSON.stringify(body) });
      accept(result);
      return result;
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not reach the server.");
      await refresh();
      return null;
    } finally { setBusy(false); }
  }

  const plan = state?.plan ?? null;
  const blocked = state ? sessionBlock(state, now) : null;
  const usable = state && plan && !planBlock(state, now);

  return (
    <section aria-label="Plan before entry" className="min-w-0 space-y-4 [overflow-wrap:anywhere]">
      <div className="rounded-2xl border border-gold-500/25 bg-gold-500/5 p-3.5">
        <p className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wider text-gold-400"><IconShield className="h-4 w-4" /> Plan first, then enter</p>
        <p className="text-[11px] leading-snug text-ink-400">No plan, no trade. If price does something else — there is no trade.{state ? ` ${account?.label ?? ""} · ${state.trade_count}/${state.max_trades} today.` : ""}</p>
      </div>
      {(error || loadError) && <p role="alert" className="text-sm text-down">{error || loadError}</p>}
      {!state ? (
        <div className="space-y-3">
          <p role="status" className="text-sm text-ink-300">{loading ? "Checking today's status..." : "Can't reach the server — a new entry needs the plan saved online first."}</p>
          <button type="button" className={actionClass} disabled={loading || !account} onClick={() => void refresh()}>Retry</button>
        </div>
      ) : state.sit_out ? (
        <div className="space-y-2 text-sm">
          <p className={noTradeWin(state) ? "font-semibold text-up" : "text-ink-200"}>{noTradeWin(state) ? "No-trade day banked. A missed setup beats a forced entry." : "You finished trading for today."}</p>
          <p className="text-ink-300">{state.sit_out.reason}</p>
        </div>
      ) : blocked ? (
        <p className="text-sm text-ink-200">{blocked}</p>
      ) : usable ? (
        <div className="space-y-3">
          <PlanSummary plan={plan} timezone={state.timezone} />
          <button type="button" className={`${actionClass} w-full`} disabled={busy || loading} onClick={() => onReady(state)}>Continue to the trade ticket</button>
          <button type="button" className="flex min-h-10 items-center gap-2 text-sm text-ink-300 hover:text-down disabled:opacity-40" disabled={busy || loading} onClick={() => void action(`/entry-gate/plans/${plan.id}/cancel`, {})}><IconX className="h-4 w-4" />Scrap this plan and write a new one</button>
        </div>
      ) : (
        <PlanEditor key={`${state.account_id}:${state.date}`} busy={busy || loading} submit={async (details) => {
          try {
            const validated = validateEntryPlan(details);
            const next = await action("/entry-gate/plans", { account_id: state.account_id, details: validated });
            if (next?.plan && !planBlock(next, Date.parse(next.server_now))) onReady(next);
          } catch (failure) { setError(failure instanceof Error ? failure.message : "Check your plan."); }
        }} />
      )}
      {onUnplanned && (
        <button type="button" className="text-left text-xs text-ink-400 underline decoration-ink-600 underline-offset-4 hover:text-down" disabled={busy} onClick={onUnplanned}>
          {state?.sit_out
            ? "Banked the day but traded anyway? Log it honestly as a rule break — the lock stays, the record matters more."
            : "Already in a trade without a plan? Log it as a rule break"}
        </button>
      )}
    </section>
  );
}

/** Compact "done for today" control — a deliberate zero-trade day counts as a win. */
export function SitOutControl() {
  const { state, loading, refresh } = useEntryGate();
  const accept = useApp((store) => store.acceptEntryGate);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  if (!state) return null;
  if (state.sit_out) {
    return (
      <p className={`mt-3 rounded-xl border px-3 py-2 text-xs ${noTradeWin(state) ? "border-up/40 bg-up/10 text-up" : "border-white/10 bg-ink-800 text-ink-300"}`}>
        {noTradeWin(state) ? "No-trade win banked for today. " : "Done for today. "}<span className="text-ink-300">{state.sit_out.reason}</span>
      </p>
    );
  }
  async function finish() {
    if (busy || !reason) return;
    setBusy(true); setError("");
    try {
      accept(await api<EntryGateState>("/entry-gate/sit-out", { method: "POST", body: JSON.stringify({ account_id: state!.account_id, reason }) }));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save.");
      await refresh();
    } finally { setBusy(false); }
  }
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <select aria-label="Why you are done for today" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-xs text-white outline-none focus:border-gold-500/60" value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || loading}>
        <option value="">Done for today because…</option>
        <option>No clean setup formed</option>
        <option>Missed it — not chasing</option>
        <option>Market doesn't fit my plan today</option>
        <option>Protecting focus and capital</option>
        <option>Finished my trading for today</option>
      </select>
      <button type="button" className="rounded-xl border border-up/40 px-3 py-2 text-xs font-semibold text-up transition hover:bg-up/10 disabled:opacity-40" disabled={busy || loading || !reason} onClick={() => void finish()}>
        {state.trade_count === 0 ? "Bank no-trade win" : "Lock the day"}
      </button>
      {error && <p role="alert" className="w-full text-xs text-down">{error}</p>}
    </div>
  );
}
