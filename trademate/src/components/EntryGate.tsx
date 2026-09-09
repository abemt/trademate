import { useState, type FormEvent } from "react";
import { ENTRY_SETUPS, ENTRY_WINDOW_MS, noTradeWin, planBlock, sessionBlock, validateEntryPlan, type EntryGateState } from "../../shared/entryGate";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { useEntryGate } from "../lib/useEntryGate";
import { IconClock, IconLock, IconShield, IconX } from "./Icons";

const inputClass = "mt-1.5 block w-full min-w-0 rounded-lg border border-white/15 bg-ink-800 px-3 py-2.5 text-sm text-white outline-none focus:border-gold-400 disabled:opacity-50";
const actionClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-semibold text-ink-950 hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-40";

function PlanEditor({ submit, busy }: { submit: (details: unknown, notEntered: boolean) => Promise<void>; busy: boolean }) {
  const [draft, setDraft] = useState({ bias: "", direction: "", setup: "", thesis: "", alert_price: "", invalidation_price: "", invalidation_rule: "", condition1: "", condition2: "", condition3: "", no_trade_if: "" });
  const [alertSet, setAlertSet] = useState(false);
  const [notEntered, setNotEntered] = useState(false);
  const update = (key: keyof typeof draft, value: string) => setDraft((previous) => ({ ...previous, [key]: value }));
  const textField = (key: keyof typeof draft, label: string, price = false) => (
    <label className="block min-w-0 text-xs font-medium text-ink-200">
      {label}
      {price ? <input required type="number" min="0.01" step="any" className={inputClass} value={draft[key]} onChange={(event) => update(key, event.target.value)} />
        : <textarea required minLength={12} maxLength={key.startsWith("condition") ? 500 : 1000} rows={2} className={`${inputClass} resize-y`} value={draft[key]} onChange={(event) => update(key, event.target.value)} />}
    </label>
  );
  async function lock(event: FormEvent) {
    event.preventDefault();
    await submit({ ...draft, alert_price: Number(draft.alert_price), invalidation_price: Number(draft.invalidation_price), conditions: [draft.condition1, draft.condition2, draft.condition3], alert_set: alertSet }, notEntered);
  }
  return (
    <form onSubmit={(event) => void lock(event)} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-medium text-ink-200">Daily bias
            <select required className={inputClass} value={draft.bias} onChange={(event) => update("bias", event.target.value)}>
              <option value="">Choose bias</option><option value="bullish">Bullish</option><option value="bearish">Bearish</option><option value="neutral">Neutral / range</option>
            </select>
          </label>
          <label className="text-xs font-medium text-ink-200">Planned direction
            <select required className={inputClass} value={draft.direction} onChange={(event) => update("direction", event.target.value)}>
              <option value="">Choose direction</option><option value="long">Long</option><option value="short">Short</option>
            </select>
          </label>
        </div>
        <label className="block text-xs font-medium text-ink-200">Playbook setup
          <select required className={inputClass} value={draft.setup} onChange={(event) => update("setup", event.target.value)}>
            <option value="">Choose setup</option>{ENTRY_SETUPS.map((setup) => <option key={setup.id} value={setup.id}>{setup.label}</option>)}
          </select>
        </label>
        {textField("thesis", "Daily bias and setup rationale")}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {textField("alert_price", "Price-alert level", true)}
          {textField("invalidation_price", "Invalidation price", true)}
        </div>
        {textField("invalidation_rule", "What invalidates this idea?")}
        {textField("condition1", "Confirmation 1 - location / structure")}
        {textField("condition2", "Confirmation 2 - setup formation")}
        {textField("condition3", "Confirmation 3 - closed-candle entry trigger")}
        {textField("no_trade_if", "I walk away if...")}
        <label className="flex items-start gap-2 text-sm text-ink-200"><input type="checkbox" required checked={alertSet} onChange={(event) => setAlertSet(event.target.checked)} className="mt-1 shrink-0 accent-(--color-gold-500)" />My price alert is set.</label>
        <label className="flex items-start gap-2 text-sm text-ink-200"><input type="checkbox" required checked={notEntered} onChange={(event) => setNotEntered(event.target.checked)} className="mt-1 shrink-0 accent-(--color-gold-500)" />I have not placed this order.</label>
        <button type="submit" className={`${actionClass} w-full`} disabled={busy || !notEntered || !alertSet}><IconLock className="h-4 w-4 shrink-0" />{busy ? "Locking..." : "Lock plan - start 15-minute wait"}</button>
      </fieldset>
    </form>
  );
}

function countdown(milliseconds: number) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60).toString().padStart(2, "0")}:${(seconds % 60).toString().padStart(2, "0")}`;
}

export function EntryGate({ onReady, onUnplanned }: { onReady?: (state: EntryGateState) => void; onUnplanned?: () => void }) {
  const { state, now, error: loadError, loading, refresh, account } = useEntryGate();
  const accept = useApp((store) => store.acceptEntryGate);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [confirmations, setConfirmations] = useState([false, false, false]);
  const [invalidationClear, setInvalidationClear] = useState(false);
  const [notEntered, setNotEntered] = useState(false);
  const [reason, setReason] = useState("");
  const [finishConfirmed, setFinishConfirmed] = useState(false);

  async function action(route: string, body: unknown) {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await api<EntryGateState>(route, { method: "POST", body: JSON.stringify(body) });
      accept(result);
      setConfirmations([false, false, false]); setInvalidationClear(false); setNotEntered(false);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Entry gate unavailable.");
      await refresh();
    } finally { setBusy(false); }
  }

  const plan = state?.plan;
  const blocked = state ? sessionBlock(state, now) : null;
  const planError = state ? planBlock(state, now) : null;
  const ready = state && !loading && !planBlock(state, now, true);
  const waiting = plan ? Math.max(0, Date.parse(plan.ready_at) - now) : 0;
  const expires = plan?.confirmed_at ? Date.parse(plan.confirmed_at) + ENTRY_WINDOW_MS - now : 0;
  const headline = state?.sit_out ? noTradeWin(state) ? "No-trade discipline win" : "Finished for today"
    : blocked ? "Entries locked" : ready ? "Entry window open" : waiting ? "Plan locked - walk away" : plan ? "Confirmations due" : "Plan before entry";

  return (
    <section aria-label="Pre-entry gate" className="min-w-0 border-y border-white/10 py-5 [overflow-wrap:anywhere]">
      <div className="mb-4 flex items-start gap-3">
        <IconShield className={`mt-0.5 h-6 w-6 shrink-0 ${state?.sit_out && noTradeWin(state) ? "text-up" : "text-gold-400"}`} />
        <div className="min-w-0 flex-1"><h2 className="text-lg font-bold text-white">{headline}</h2><p className="mt-1 text-xs text-ink-300">{account?.label ?? "No active account"}{state ? ` | ${state.date} | ${state.trade_count}/${state.max_trades} entries` : ""}</p></div>
      </div>
      {(error || loadError) && <p role="alert" className="mb-3 text-sm text-down">{error || loadError}</p>}
      {!state ? <div className="space-y-3"><p role="status" className="text-sm text-ink-300">{loading ? "Checking entry permission..." : "New entries are locked until the server gate is available."}</p><button type="button" className={actionClass} disabled={loading || !account} onClick={() => void refresh()}>Check connection</button></div> : <>
        {state.sit_out ? <div className="space-y-2 text-sm"><p className={noTradeWin(state) ? "font-semibold text-up" : "text-ink-200"}>{noTradeWin(state) ? "A missed setup beats a forced entry." : "No more planned entries today."}</p><p className="text-ink-200">{state.sit_out.reason}</p><p className="text-xs text-ink-400">Locked through {state.date} ({state.timezone}). Recorded trades determine this status.</p></div>
          : blocked ? <p className="text-sm text-ink-200">{blocked}</p>
          : !plan ? <PlanEditor key={`${state.account_id}:${state.date}`} busy={busy || loading} submit={async (details, beforeEntry) => {
            try { const validated = validateEntryPlan(details); await action("/entry-gate/plans", { account_id: state.account_id, details: validated, not_entered: beforeEntry }); }
            catch (failure) { setError(failure instanceof Error ? failure.message : "Check your plan."); }
          }} /> : <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-ink-300"><span>Locked {new Date(plan.created_at).toLocaleTimeString([], { timeZone: state.timezone, hour: "2-digit", minute: "2-digit" })} | {plan.details.bias} | {plan.details.direction}</span><span className="font-semibold text-gold-400">{ENTRY_SETUPS.find((setup) => setup.id === plan.details.setup)?.label}</span></div>
            <p className="whitespace-pre-wrap text-sm text-ink-100">{plan.details.thesis}</p>
            <dl className="grid grid-cols-2 gap-3 text-sm"><div><dt className="text-xs text-ink-400">Alert</dt><dd className="font-semibold text-white">{plan.details.alert_price}</dd></div><div><dt className="text-xs text-ink-400">Invalidation</dt><dd className="font-semibold text-white">{plan.details.invalidation_price}</dd></div></dl>
            <p className="text-sm text-ink-200">{plan.details.invalidation_rule}</p>
            <p className="text-sm text-ink-300">Walk away: {plan.details.no_trade_if}</p>
            {waiting > 0 && <p role="status" className="flex items-center gap-2 text-gold-300"><IconClock className="h-5 w-5" /><span className="inline-block w-16 font-mono text-xl tabular-nums">{countdown(waiting)}</span><span className="text-xs">before confirmations</span></p>}
            {planError && waiting === 0 && <p role="status" className="text-sm text-down">{planError}</p>}
            <fieldset disabled={busy || loading || Boolean(planError) || Boolean(plan.confirmed_at)} className="space-y-3 border-t border-white/10 pt-4">
              <legend className="text-xs font-semibold text-ink-300">Three market confirmations</legend>
              {plan.details.conditions.map((condition, index) => <label key={`${plan.id}:${index}`} className="flex items-start gap-2 text-sm text-ink-100"><input type="checkbox" className="mt-1 shrink-0 accent-(--color-gold-500)" checked={Boolean(plan.confirmed_at) || confirmations[index]} onChange={(event) => setConfirmations((previous) => previous.map((checked, position) => position === index ? event.target.checked : checked))} />{condition}</label>)}
              {!plan.confirmed_at && <><label className="flex items-start gap-2 text-sm text-ink-200"><input type="checkbox" className="mt-1 shrink-0 accent-(--color-gold-500)" checked={invalidationClear} onChange={(event) => setInvalidationClear(event.target.checked)} />Required candles have closed; invalidation is intact.</label><label className="flex items-start gap-2 text-sm text-ink-200"><input type="checkbox" className="mt-1 shrink-0 accent-(--color-gold-500)" checked={notEntered} onChange={(event) => setNotEntered(event.target.checked)} />I have not placed the order.</label><button type="button" className={`${actionClass} w-full`} disabled={!confirmations.every(Boolean) || !notEntered || !invalidationClear} onClick={() => void action(`/entry-gate/plans/${plan.id}/confirm`, { confirmations, not_entered: notEntered, invalidation_clear: invalidationClear })}>Confirm setup - open 5-minute window</button></>}
            </fieldset>
            {ready && <><p role="status" className="text-sm text-up">Entry window: <span className="font-mono tabular-nums">{countdown(expires)}</span></p>{onReady && <button type="button" disabled={busy || loading} className={`${actionClass} w-full`} onClick={() => onReady(state)}>Open planned trade ticket</button>}</>}
            <button type="button" className="flex min-h-10 items-center gap-2 text-sm text-ink-300 hover:text-down disabled:opacity-40" disabled={busy || loading} onClick={() => void action(`/entry-gate/plans/${plan.id}/cancel`, {})}><IconX className="h-4 w-4" />Cancel plan (replacement restarts wait)</button>
          </div>}
        {!state.sit_out && state.open_count === 0 && <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
          <label className="block text-xs font-medium text-ink-200">Reason to finish today
            <select className={inputClass} value={reason} onChange={(event) => setReason(event.target.value)} disabled={busy || loading}>
              <option value="">Choose a reason</option><option>No complete setup formed today.</option><option>I missed the entry and will not chase it.</option><option>The market does not fit my plan today.</option><option>I am protecting my focus and capital today.</option><option>I have completed my trading for today.</option>
            </select>
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-200"><input type="checkbox" className="mt-1 shrink-0 accent-(--color-gold-500)" checked={finishConfirmed} onChange={(event) => setFinishConfirmed(event.target.checked)} disabled={busy || loading} />No more entries on this account today.</label>
          <button type="button" className="flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-up/40 px-3 py-2 text-sm font-semibold text-up disabled:opacity-40" disabled={busy || loading || !reason || !finishConfirmed} onClick={() => void action("/entry-gate/sit-out", { account_id: state.account_id, reason })}><IconShield className="h-4 w-4 shrink-0" />{state.trade_count === 0 ? "Bank no-trade win - lock today" : "Finish today - lock entries"}</button>
        </div>}
      </>}
      {onUnplanned && <button type="button" className="mt-5 text-left text-xs text-ink-400 underline decoration-ink-600 underline-offset-4 hover:text-down" disabled={busy} onClick={onUnplanned}>Already entered without a plan? Record a rule violation</button>}
    </section>
  );
}