import { useEffect, useState } from "react";
import { Chip, ChipRow, FieldLabel } from "./Chip";
import { IconTrendDown, IconTrendUp } from "./Icons";
import { PlansSheet, type Plan } from "./PlansSheet";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { Sheet } from "./Sheet";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { EntryGate, PlanSummary } from "./EntryGate";
import { RiskInput, riskPctOf } from "./RiskInput";
import { useEntryGate } from "../lib/useEntryGate";
import { ENTRY_SETUPS, planBlock, type EntryPlan } from "../../shared/entryGate";
import { lineCrossed, type DayPlan } from "../../shared/biasCall";
import { GATE_LINES, GATE_MAX_STOP_PIPS, autoGateLines, gateLabel, type GateLineId } from "../../shared/gate";
import {
  BODY_SCALE,
  CONFLUENCES,
  EMOTIONS,
  EXEC_QUALITY,
  EXIT_FEELINGS,
  MISTAKES,
  SETUPS,
  SETUP_GRADES,
  TIMEFRAMES,
  TRADE_SESSIONS,
  TRIGGERS,
  currentSessionId,
  type Trade,
} from "../lib/trades";

interface Props {
  open: boolean;
  onClose: () => void;
  existing?: Trade | null;
  prefill?: Partial<Trade> | null;
  closeMode?: boolean;
}

const R_CHIPS = [-1, -0.5, 0, 1, 1.5, 2, 3];

/** Accepts "4,278.2" as well as "4278.2"; empty or junk → null. */
function parsePrice(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number.parseFloat(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** 1–5 emoji scale for body/urge checkpoints. */
function ScaleRow({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (v: number) => void;
}) {
  return (
    <div className="grid grid-cols-5 gap-1.5">
      {BODY_SCALE.map((s) => (
        <button
          key={s.v}
          type="button"
          onClick={() => onChange(s.v)}
          className={`flex flex-col items-center gap-0.5 rounded-xl border py-2 transition ${
            value === s.v
              ? "border-gold-500 bg-gold-500/15 shadow-[0_0_14px_rgb(139_92_246/0.2)]"
              : "border-white/10 bg-ink-800 hover:border-gold-500/40"
          }`}
        >
          <span className="text-lg leading-none">{s.emoji}</span>
          <span
            className={`text-[9px] font-semibold ${
              value === s.v ? "text-gold-300" : "text-ink-400"
            }`}
          >
            {s.label}
          </span>
        </button>
      ))}
    </div>
  );
}

function FormInner({ onClose, existing, prefill, closeMode, lockedPlan, unplanned = false, onBack }: Omit<Props, "open"> & {
  lockedPlan?: EntryPlan;
  unplanned?: boolean;
  onBack?: () => void;
}) {
  const profile = useApp((s) => s.profile);
  const saveTrade = useApp((s) => s.saveTrade);
  const accounts = useApp((s) => s.accounts);
  const activeAccount = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const gate = useEntryGate();
  const protectedPlan = Boolean(lockedPlan || existing?.entry_mode === "planned");
  const violation = unplanned || existing?.entry_mode === "unplanned";
  const [tradeId] = useState(() => existing?.id ?? crypto.randomUUID());
  const [saving, setSaving] = useState(false);
  const [unplannedReason, setUnplannedReason] = useState(existing?.unplanned_reason ?? "");
  const [actualEntry, setActualEntry] = useState(() => {
    const date = new Date(existing?.opened_at ?? Date.now());
    return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
  });
  // Risk is a share of the ACCOUNT SIZE (starting balance), so 0.2% of a $10k eval is exactly $20.
  const accountSize = activeAccount?.starting_balance ?? profile?.account_size ?? 10_000;

  const base = existing ?? prefill ?? null;
  const initialSetup = lockedPlan ? ENTRY_SETUPS.find((candidate) => candidate.id === lockedPlan.details.setup)!.label : base?.setup_type ?? null;
  const isKnownSetup = initialSetup === null || SETUPS.some((s) => s.id === initialSetup);

  const [direction, setDirection] = useState<"long" | "short" | null>(lockedPlan?.details.direction ?? base?.direction ?? null);
  const [setup, setSetup] = useState<string | null>(isKnownSetup ? initialSetup : "other");
  const [customSetup, setCustomSetup] = useState<string>(
    isKnownSetup ? "" : (initialSetup as string),
  );
  const [screenshots, setScreenshots] = useState<string[]>(base?.screenshots ?? []);
  const [trigger, setTrigger] = useState<string | null>(base?.entry_trigger ?? null);
  const [timeframe, setTimeframe] = useState<string | null>(base?.timeframe ?? "M15");
  const [session, setSession] = useState<string>(base?.session ?? currentSessionId());
  const [riskUsd, setRiskUsd] = useState<number>(() =>
    existing?.risk_usd ?? Math.round(((accountSize * (profile?.risk_pct_min ?? 0.5)) / 100) * 100) / 100,
  );
  const [slPips, setSlPips] = useState<number>(existing?.sl_pips ?? 75);
  const [entryPrice, setEntryPrice] = useState<string>(
    existing?.entry_price != null ? String(existing.entry_price) : "",
  );
  // The plan's invalidation price is where the idea is wrong — the default stop.
  const [slPriceText, setSlPriceText] = useState<string>(
    existing?.sl_price != null ? String(existing.sl_price) : lockedPlan ? String(lockedPlan.details.invalidation_price) : "",
  );
  const [tpPriceText, setTpPriceText] = useState<string>(
    existing?.tp_price != null ? String(existing.tp_price) : "",
  );
  const [exitPriceText, setExitPriceText] = useState<string>(
    existing?.exit_price != null ? String(existing.exit_price) : "",
  );
  const [isClosed, setIsClosed] = useState<boolean>(
    Boolean(closeMode) || existing?.status === "closed",
  );
  const [pnlText, setPnlText] = useState<string>(
    existing?.pnl_usd != null ? String(existing.pnl_usd) : "",
  );
  const [emotions, setEmotions] = useState<string[]>(base?.emotions ?? []);
  const [followedPlan, setFollowedPlan] = useState<number | null>(
    existing?.followed_plan ?? null,
  );
  const [notes, setNotes] = useState<string>(base?.notes ?? "");
  const [bodyBefore, setBodyBefore] = useState<number | null>(base?.body_before ?? null);
  const [urgeBefore, setUrgeBefore] = useState<number | null>(base?.urge_before ?? null);
  const [bodyDuring, setBodyDuring] = useState<number | null>(base?.body_during ?? null);
  const [exitFeeling, setExitFeeling] = useState<string | null>(base?.exit_feeling ?? null);
  const [feelingNote, setFeelingNote] = useState<string>(base?.feeling_note ?? "");
  const [setupGrade, setSetupGrade] = useState<string | null>(base?.setup_grade ?? null);
  const [execQuality, setExecQuality] = useState<string | null>(base?.execution_quality ?? null);
  const [confluences, setConfluences] = useState<string[]>(base?.confluences ?? []);
  const [mistakes, setMistakes] = useState<string[]>(base?.mistakes ?? []);
  const [planId, setPlanId] = useState<string | null>(base?.plan_id ?? null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [plansOpen, setPlansOpen] = useState(false);
  const [planSetup, setPlanSetup] = useState<string>(lockedPlan ? `${lockedPlan.details.bias.toUpperCase()}: ${lockedPlan.details.thesis}` : base?.plan_setup ?? "");
  const [planEntry, setPlanEntry] = useState<string>(lockedPlan ? `${lockedPlan.details.conditions.join("\n")}\nInvalidation: ${lockedPlan.details.invalidation_price} - ${lockedPlan.details.invalidation_rule}\nWalk away: ${lockedPlan.details.no_trade_if}` : base?.plan_entry ?? "");
  const [lesson, setLesson] = useState<string>(base?.lesson ?? "");
  const [dayPlan, setDayPlan] = useState<Pick<DayPlan, "bias" | "must_see" | "invalidation_price" | "called_at"> | null>(null);
  const [spot, setSpot] = useState<number | null>(null);
  const [autopilot, setAutopilot] = useState<number | null>(
    existing?.autopilot ?? prefill?.autopilot ?? null,
  );
  // Lines 1-4 of the A+ gate are his word; the rest the ticket works out.
  const [gateWord, setGateWord] = useState<GateLineId[]>([]);
  const [error, setError] = useState<string>("");

  const riskPct = riskPctOf(riskUsd, accountSize);
  const entryNum = parsePrice(entryPrice);
  const slNum = parsePrice(slPriceText);
  const tpNum = parsePrice(tpPriceText);
  const exitNum = parsePrice(exitPriceText);
  // Prices win over the slider. Gold: $1 = 10 pips.
  const derivedSlPips = entryNum !== null && slNum !== null && slNum !== entryNum ? Math.round(Math.abs(entryNum - slNum) * 10) : null;
  const stopPips = derivedSlPips ?? slPips;
  const lots = Math.max(0.01, Math.floor((riskUsd / (stopPips * 10)) * 100) / 100);
  const tpPips = entryNum !== null && tpNum !== null ? Math.round(Math.abs(tpNum - entryNum) * 10) : null;
  const plannedR = tpPips !== null && stopPips > 0 ? Math.round((tpPips / stopPips) * 10) / 10 : null;
  const wrongSideStop = Boolean(direction && entryNum !== null && slNum !== null && (direction === "long" ? slNum >= entryNum : slNum <= entryNum));
  const wrongSideTarget = Boolean(direction && entryNum !== null && tpNum !== null && (direction === "long" ? tpNum <= entryNum : tpNum >= entryNum));
  const exitPips = direction && entryNum !== null && exitNum !== null ? Math.round((direction === "long" ? exitNum - entryNum : entryNum - exitNum) * 10) : null;
  const autoGate = autoGateLines({ plannedR, stopPips, urgeBefore, tradesToday: gate.state ? gate.state.trade_count : null });
  const gatePassed: GateLineId[] = existing
    ? (existing.gate as GateLineId[])
    : GATE_LINES.map((line) => line.id).filter((id) => {
        if (id === "target") return autoGate.target;
        if (id === "state") return autoGate.state;
        if (id === "first") return autoGate.first;
        if (id === "stop") return gateWord.includes(id) && !autoGate.stopTooWide;
        return gateWord.includes(id);
      });
  const gateScoreNow = existing ? existing.gate_score : gatePassed.length;

  function loadPlans() {
    api<{ plans: Plan[] }>("/plans")
      .then((r) => setPlans(r.plans))
      .catch(() => {});
  }
  useEffect(() => {
    loadPlans();
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    api<{ plan: Pick<DayPlan, "bias" | "must_see" | "invalidation_price" | "called_at"> | null }>(`/dayplan?date=${key}`)
      .then((r) => setDayPlan(r.plan))
      .catch(() => {});
    api<{ price: number | null }>("/price").then((r) => setSpot(r.price)).catch(() => {});
  }, []);

  const readCrossed = dayPlan ? lineCrossed(dayPlan.bias, dayPlan.invalidation_price, spot) : false;
  const readConflict = !existing && dayPlan?.called_at && direction && !readCrossed && (
    (dayPlan.bias === "bullish" && direction === "short") || (dayPlan.bias === "bearish" && direction === "long") || dayPlan.bias === "no_trade"
  );

  function toggleEmotion(id: string) {
    setEmotions((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id],
    );
  }

  function toggleIn(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((e) => e !== id) : [...list, id]);
  }

  async function save() {
    if (saving) return;
    if (!existing && !violation) {
      const blocked = gate.state ? planBlock(gate.state, gate.now) : "Can't reach the server — the entry needs the saved plan.";
      if (gate.loading || blocked || !lockedPlan || gate.state?.plan?.id !== lockedPlan.id) {
        setError(blocked ?? "The plan changed. Go back and check it.");
        return;
      }
    }
    if (!existing && violation && (unplannedReason.trim().length < 3 || !Number.isFinite(Date.parse(actualEntry)) || Date.parse(actualEntry) > Date.now())) {
      setError("Enter the real entry time and a few words on what happened.");
      return;
    }
    if (!direction) {
      setError("Long or short?");
      return;
    }
    if (wrongSideStop || wrongSideTarget) {
      setError(`${wrongSideStop ? "Stop" : "Target"} price is on the wrong side of the entry for a ${direction}.`);
      return;
    }
    if (bodyBefore === null || urgeBefore === null) {
      setError("Nervous-system check first — body state and urge level are required. That's the whole point.");
      return;
    }
    if (!existing && feelingNote.trim().length < 5) {
      setError("Write what you're actually feeling — one honest sentence is enough. That's the journal that cuts the mistakes.");
      return;
    }
    const pnl = isClosed ? Number.parseFloat(pnlText) : null;
    if (isClosed && (pnlText.trim() === "" || Number.isNaN(pnl))) {
      setError("Enter the P&L — the R buttons fill it for you.");
      return;
    }
    if (isClosed && (exitFeeling === null || autopilot === null)) {
      setError("Close-out check: how you felt at exit + the Autopilot question are required.");
      return;
    }
    if (isClosed && pnl !== null && pnl < 0 && mistakes.length === 0) {
      setError('Tag the mistake — or "None — clean loss" if the setup was right and it just lost. This is how mistakes get price tags.');
      return;
    }
    if (isClosed && pnl !== null && pnl < 0 && lesson.trim().length < 5) {
      setError("One-sentence lesson before you close a loss — that's the tuition receipt.");
      return;
    }
    const now = new Date().toISOString();
    const trade: Trade = {
      id: tradeId,
      instrument: "XAUUSD",
      direction,
      setup_type: setup === "other" && customSetup.trim() !== "" ? customSetup.trim() : setup,
      entry_trigger: trigger,
      session,
      timeframe,
      entry_price: entryNum,
      sl_price: slNum,
      tp_price: tpNum,
      exit_price: isClosed ? exitNum : null,
      sl_pips: stopPips,
      lots,
      risk_usd: riskUsd,
      risk_pct: riskPct,
      pnl_usd: pnl,
      r_multiple:
        isClosed && pnl !== null && riskUsd > 0
          ? Math.round((pnl / riskUsd) * 100) / 100
          : null,
      outcome: !isClosed || pnl === null ? null : pnl > 0 ? "win" : pnl < 0 ? "loss" : "breakeven",
      status: isClosed ? "closed" : "open",
      emotions,
      screenshots,
      followed_plan: violation ? 0 : isClosed ? followedPlan : null,
      notes: notes.trim() === "" ? null : notes.trim(),
      opened_at: existing?.opened_at ?? (violation ? new Date(actualEntry).toISOString() : now),
      closed_at: isClosed ? (existing?.closed_at ?? now) : null,
      updated_at: now,
      deleted: 0,
      body_before: bodyBefore,
      urge_before: urgeBefore,
      body_during: bodyDuring,
      exit_feeling: isClosed ? exitFeeling : null,
      autopilot: isClosed ? autopilot : null,
      account_id: existing?.account_id ?? activeAccount?.id ?? null,
      feeling_note: feelingNote.trim() === "" ? null : feelingNote.trim(),
      setup_grade: isClosed ? setupGrade : null,
      execution_quality: isClosed ? execQuality : null,
      confluences,
      mistakes: isClosed ? mistakes : [],
      plan_id: planId,
      plan_setup: violation ? null : planSetup.trim() === "" ? null : planSetup.trim(),
      plan_entry: violation ? null : planEntry.trim() === "" ? null : planEntry.trim(),
      lesson: isClosed && lesson.trim() !== "" ? lesson.trim() : (existing?.lesson ?? null),
      entry_plan_id: existing?.entry_plan_id ?? lockedPlan?.id ?? null,
      entry_mode: existing ? existing.entry_mode : violation ? "unplanned" : "planned",
      unplanned_reason: violation ? unplannedReason.trim() : null,
      gate: gatePassed,
      gate_score: gateScoreNow,
    };
    setSaving(true);
    setError("");
    try {
      await saveTrade(trade);
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Trade not saved. Keep this ticket open and retry.");
    } finally { setSaving(false); }
  }

  return (
    <div className="space-y-5">
      {onBack && <button type="button" onClick={onBack} disabled={saving} className="text-sm font-semibold text-gold-400">‹ Back to the plan</button>}
      {lockedPlan && <PlanSummary plan={lockedPlan} timezone={gate.state?.timezone ?? "Africa/Addis_Ababa"} />}
      {lockedPlan && gate.state && (gate.state.plan?.id !== lockedPlan.id || planBlock(gate.state, gate.now)) && (
        <p role="status" className="text-sm text-down">{planBlock(gate.state, gate.now) ?? "This plan was replaced. Go back and check it."}</p>
      )}
      {violation && <div className="space-y-3 border-y border-down/30 py-3">
        <p className="text-sm font-semibold text-down">Unplanned entry — rule break</p>
        <label className="block text-xs text-ink-200">What happened?
          <textarea required readOnly={Boolean(existing)} minLength={3} maxLength={2000} rows={2} placeholder='e.g. "saw the move and jumped in — no plan"' value={unplannedReason} onChange={(event) => setUnplannedReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-400" />
        </label>
        {!existing && <label className="block text-xs text-ink-200">Actual entry time (device timezone)
          <input type="datetime-local" required value={actualEntry} onChange={(event) => setActualEntry(event.target.value)} className="mt-1 block w-full min-w-0 rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white" />
        </label>}
      </div>}
      <fieldset disabled={protectedPlan}>
        <FieldLabel>Direction</FieldLabel>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setDirection("long")}
            className={`flex items-center justify-center gap-2 rounded-xl border py-3 font-bold transition ${
              direction === "long"
                ? "border-up/60 bg-up/15 text-up"
                : "border-white/10 bg-ink-800 text-ink-300"
            }`}
          >
            <IconTrendUp className="h-4.5 w-4.5" /> LONG
          </button>
          <button
            type="button"
            onClick={() => setDirection("short")}
            className={`flex items-center justify-center gap-2 rounded-xl border py-3 font-bold transition ${
              direction === "short"
                ? "border-down/60 bg-down/15 text-down"
                : "border-white/10 bg-ink-800 text-ink-300"
            }`}
          >
            <IconTrendDown className="h-4.5 w-4.5" /> SHORT
          </button>
        </div>
      </fieldset>

      {readConflict && (
        <p role="alert" className="rounded-xl border border-down/40 bg-down/10 p-3 text-xs font-semibold text-down">
          {dayPlan?.bias === "no_trade"
            ? "Your morning read said NO TRADE today. Sitting out was the trade. If you enter anyway, the day is a rule break by your own call."
            : `Your morning read is ${dayPlan?.bias?.toUpperCase()} and your line (${dayPlan?.invalidation_price ?? "—"}) has not been crossed. A ${direction} here is the narrative talking, not the chart.`}
        </p>
      )}
      {!existing && dayPlan?.called_at && readCrossed && (
        <p role="status" className="rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 text-xs text-gold-300">
          Your {dayPlan.bias} read is over — the line ({dayPlan.invalidation_price}) was crossed. Trade only what the chart shows now, with a fresh plan.
        </p>
      )}
      {!violation && !lockedPlan && <div className="rounded-2xl border border-gold-500/25 bg-gold-500/5 p-3.5">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-gold-400">
          {protectedPlan ? "Plan (locked before entry)" : "Recorded plan"}
        </p>
        <p className="mb-3 text-[11px] leading-snug text-ink-400">
          The contract with yourself. If price does something else — there is no trade.
        </p>
        {dayPlan && (dayPlan.bias || dayPlan.must_see) && (
          <p className="mb-3 rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-[11px] text-ink-300">
            Today's plan:{" "}
            {dayPlan.bias && <span className="font-bold uppercase text-gold-300">{dayPlan.bias}</span>}
            {dayPlan.must_see && <span> — must see: <span className="text-ink-100">{dayPlan.must_see}</span></span>}
          </p>
        )}
        <FieldLabel>Setup — bias + why</FieldLabel>
        <textarea
          readOnly={protectedPlan}
          value={planSetup}
          onChange={(e) => setPlanSetup(e.target.value)}
          rows={2}
          placeholder='e.g. "Bearish bias + rejection at H1 resistance zone"'
          className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
        />
        <div className="mt-3">
          <FieldLabel>Planned entry — what exactly are you waiting for?</FieldLabel>
          <textarea
            readOnly={protectedPlan}
            value={planEntry}
            onChange={(e) => setPlanEntry(e.target.value)}
            rows={protectedPlan ? 7 : 2}
            placeholder='e.g. "Wait for clean double top on M15 — no double top, no entry"'
            className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
        </div>
      </div>}

      <div className="rounded-2xl border border-gold-500/25 bg-gold-500/5 p-3.5">
        <p className="mb-1 text-[11px] font-bold uppercase tracking-wider text-gold-400">
          Nervous-system check · required
        </p>
        <p className="mb-3 text-[11px] leading-snug text-ink-400">
          The chart records why you entered. This records who entered.
        </p>
        <FieldLabel>Body right now</FieldLabel>
        <ScaleRow value={bodyBefore} onChange={setBodyBefore} />
        <div className="mt-3">
          <FieldLabel>Urge to be in a trade</FieldLabel>
          <ScaleRow value={urgeBefore} onChange={setUrgeBefore} />
        </div>
        <div className="mt-3">
          <FieldLabel>In your own words — what's happening in your head right now?</FieldLabel>
          <textarea
            value={feelingNote}
            onChange={(e) => setFeelingNote(e.target.value)}
            rows={2}
            placeholder='e.g. "heart still racing from the last loss, I want it back" — the honest version'
            className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
        </div>
      </div>

      <fieldset disabled={protectedPlan}>
        <FieldLabel>Setup</FieldLabel>
        <ChipRow>
          {SETUPS.map((s) => (
            <Chip key={s.id} active={setup === s.id} onClick={() => setSetup(s.id)}>
              {s.label}
            </Chip>
          ))}
        </ChipRow>
        {setup === "other" && (
          <input
            type="text"
            value={customSetup}
            onChange={(e) => setCustomSetup(e.target.value)}
            placeholder="Name your setup (e.g. Liquidity sweep)"
            autoFocus
            className="mt-2 w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
        )}
      </fieldset>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <FieldLabel>Playbook plan</FieldLabel>
          <button
            type="button"
            onClick={() => setPlansOpen(true)}
            className="text-[11px] font-bold text-gold-500 hover:text-gold-400"
          >
            Manage ›
          </button>
        </div>
        <ChipRow>
          <Chip active={planId === null} onClick={() => setPlanId(null)}>
            No plan
          </Chip>
          {plans.map((p) => (
            <Chip key={p.id} active={planId === p.id} onClick={() => setPlanId(p.id)}>
              {p.name}
            </Chip>
          ))}
        </ChipRow>
        <PlansSheet open={plansOpen} onClose={() => setPlansOpen(false)} plans={plans} onChanged={loadPlans} />
      </div>

      <div>
        <FieldLabel>Entry trigger</FieldLabel>
        <ChipRow>
          {TRIGGERS.map((t) => (
            <Chip key={t.id} active={trigger === t.id} onClick={() => setTrigger(t.id)}>
              {t.label}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <FieldLabel>Timeframe</FieldLabel>
          <ChipRow>
            {TIMEFRAMES.map((tf) => (
              <Chip key={tf} active={timeframe === tf} onClick={() => setTimeframe(tf)}>
                {tf}
              </Chip>
            ))}
          </ChipRow>
        </div>
        <div>
          <FieldLabel>Session</FieldLabel>
          <ChipRow>
            {TRADE_SESSIONS.map((s) => (
              <Chip key={s.id} active={session === s.id} onClick={() => setSession(s.id)}>
                {s.label}
              </Chip>
            ))}
          </ChipRow>
        </div>
      </div>

      <div>
        <FieldLabel>Risk — of the ${accountSize.toLocaleString(undefined, { maximumFractionDigits: 0 })} account size</FieldLabel>
        <RiskInput base={accountSize} riskUsd={riskUsd} onChange={setRiskUsd} />
        <p className="mt-2 text-xs text-ink-400">
          <span className="font-semibold text-gold-300">{lots.toFixed(2)} lots</span> · {riskPct}% · ${Math.round(riskUsd * 100) / 100} at risk at {stopPips} pips
          {derivedSlPips !== null && <span className="text-ink-300"> · from your prices</span>}
        </p>
        {derivedSlPips === null && (
          <label className="mt-2 block text-xs text-ink-300">
            Stop loss: <span className="font-semibold text-white">{slPips} pips</span>
            <input
              type="range"
              min={20}
              max={150}
              step={5}
              value={slPips}
              onChange={(e) => setSlPips(Number(e.target.value))}
              className="mt-1 w-full accent-(--color-gold-400)"
            />
          </label>
        )}
        <div className="mt-2 grid grid-cols-3 gap-2">
          {([
            ["Entry", entryPrice, setEntryPrice],
            ["Stop price", slPriceText, setSlPriceText],
            ["Target price", tpPriceText, setTpPriceText],
          ] as const).map(([label, value, set]) => (
            <label key={label} className="block text-[10px] font-semibold uppercase tracking-wider text-ink-400">
              {label}
              <input
                type="text"
                inputMode="decimal"
                value={value}
                onChange={(e) => set(e.target.value)}
                placeholder="—"
                className="mt-1 w-full min-w-0 rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5 text-sm normal-case tracking-normal text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
              />
            </label>
          ))}
        </div>
        {(wrongSideStop || wrongSideTarget) && (
          <p className="mt-1.5 text-xs text-down">
            {wrongSideStop ? "Stop" : "Target"} is on the wrong side of the entry for a {direction}.
          </p>
        )}
        {plannedR !== null && !wrongSideStop && !wrongSideTarget && (
          <p className={`mt-1.5 text-xs ${plannedR < 2 ? "text-down" : "text-ink-300"}`}>
            Target {tpPips} pips · <span className="font-semibold">{plannedR}R</span>
            {plannedR < 2 && " — under 2R. The rule says skip."}
          </p>
        )}
      </div>

      {existing ? (
        existing.gate_score !== null && (
          <p className={`text-xs font-semibold ${existing.gate_score >= GATE_LINES.length ? "text-up" : "text-down"}`}>
            Gate at entry: {gateLabel(existing.gate, existing.gate_score)}
          </p>
        )
      ) : (
        <div className={`rounded-2xl border p-3.5 ${gateScoreNow === GATE_LINES.length ? "border-up/40 bg-up/5" : "border-down/30 bg-down/5"}`}>
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <p className="text-[11px] font-bold uppercase tracking-wider text-gold-400">A+ gate · all seven or no trade</p>
            <p className={`text-xs font-bold ${gateScoreNow === GATE_LINES.length ? "text-up" : "text-down"}`}>{gateLabel(gatePassed, gateScoreNow)}</p>
          </div>
          <p className="mb-3 text-[11px] leading-snug text-ink-400">
            Tap the lines that are true. The last three the ticket checks for you. A half-setup still saves — the record keeps the missing numbers.
          </p>
          <ul className="space-y-1.5">
            {GATE_LINES.map((line) => {
              const passed = gatePassed.includes(line.id);
              const stopBlocked = line.id === "stop" && autoGate.stopTooWide;
              const detail =
                line.id === "target" ? (tpNum === null ? "type the target price" : plannedR !== null ? `${plannedR}R` : null)
                : line.id === "state" ? (urgeBefore === null ? "answer the urge check" : `urge ${urgeBefore}`)
                : line.id === "first" ? (gate.state ? `${gate.state.trade_count} taken today` : "can't reach the server")
                : stopBlocked ? `${stopPips} pips — over ${GATE_MAX_STOP_PIPS}, the rule says skip`
                : null;
              const row = (
                <>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${passed ? "border-up bg-up/20 text-up" : "border-ink-500 text-ink-500"}`}>
                    {passed ? "✓" : line.n}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-sm ${passed ? "text-ink-200" : "text-white"}`}>{line.label}</span>
                    <span className="block text-[10px] text-ink-400">{detail ?? line.hint}</span>
                  </span>
                  {line.auto && <span className="text-[9px] font-bold uppercase tracking-wider text-ink-500">auto</span>}
                </>
              );
              return (
                <li key={line.id}>
                  {line.auto || stopBlocked ? (
                    <div className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left ${passed ? "border-up/30 bg-up/5" : "border-white/10 bg-ink-800"}`}>{row}</div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleIn(gateWord, (next) => setGateWord(next as GateLineId[]), line.id)}
                      className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2 text-left transition ${passed ? "border-up/30 bg-up/5" : "border-white/10 bg-ink-800 hover:border-gold-500/40"}`}
                    >
                      {row}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {!closeMode && existing?.status !== "closed" && (
        <div>
          <FieldLabel>Status</FieldLabel>
          <div className="grid grid-cols-2 gap-2">
            <Chip active={!isClosed} onClick={() => setIsClosed(false)}>
              Still running
            </Chip>
            <Chip active={isClosed} onClick={() => setIsClosed(true)}>
              Already closed
            </Chip>
          </div>
        </div>
      )}

      {isClosed && (
        <div>
          <FieldLabel>Result</FieldLabel>
          <ChipRow>
            {R_CHIPS.map((r) => (
              <Chip
                key={r}
                active={pnlText !== "" && Number.parseFloat(pnlText) === Math.round(r * riskUsd)}
                onClick={() => setPnlText(String(Math.round(r * riskUsd)))}
              >
                {r === 0 ? "BE" : `${r > 0 ? "+" : ""}${r}R`}
              </Chip>
            ))}
          </ChipRow>
          <input
            type="text"
            inputMode="decimal"
            value={pnlText}
            onChange={(e) => setPnlText(e.target.value)}
            placeholder="P&L in $ (e.g. -50 or 120)"
            className="mt-2 w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          <input
            type="text"
            inputMode="decimal"
            value={exitPriceText}
            onChange={(e) => setExitPriceText(e.target.value)}
            placeholder="Exit price (optional)"
            className="mt-2 w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          {exitPips !== null && (
            <p className="mt-1.5 text-xs text-ink-400">
              {exitPips >= 0 ? "+" : ""}{exitPips} pips · ≈ ${Math.round(exitPips * lots * 10)} gross at {lots.toFixed(2)} lots
              {stopPips > 0 && ` · ${Math.round((exitPips / stopPips) * 10) / 10}R by price`}
            </p>
          )}
          <div className="mt-3">
            <FieldLabel>Did you follow your plan?</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              {violation ? <p className="col-span-2 text-sm text-down">No pre-entry plan was recorded.</p> : <>
                <Chip active={followedPlan === 1} onClick={() => setFollowedPlan(1)}>Followed my plan</Chip>
                <Chip active={followedPlan === 0} onClick={() => setFollowedPlan(0)}>Broke my plan</Chip>
              </>}
            </div>
          </div>
          <div className="mt-3 rounded-2xl border border-gold-500/25 bg-gold-500/5 p-3.5">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-gold-400">
              Close-out check · required
            </p>
            <FieldLabel>Feeling at exit</FieldLabel>
            <ChipRow>
              {EXIT_FEELINGS.map((f) => (
                <Chip key={f.id} active={exitFeeling === f.id} onClick={() => setExitFeeling(f.id)}>
                  {f.label}
                </Chip>
              ))}
            </ChipRow>
            <div className="mt-3">
              <FieldLabel>Did Autopilot take over mid-trade?</FieldLabel>
              <div className="grid grid-cols-2 gap-2">
                <Chip active={autopilot === 0} onClick={() => setAutopilot(0)}>
                  I stayed the pilot
                </Chip>
                <Chip active={autopilot === 1} onClick={() => setAutopilot(1)}>
                  Autopilot took over
                </Chip>
              </div>
            </div>
            <div className="mt-3">
              <FieldLabel>Body while in the trade (if you watched)</FieldLabel>
              <ScaleRow value={bodyDuring} onChange={setBodyDuring} />
            </div>
          </div>
          <div className="mt-3 rounded-2xl border border-white/10 bg-ink-800/50 p-3.5">
            <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-ink-300">
              Review — grade the trade, not the outcome
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <FieldLabel>Setup quality</FieldLabel>
                <ChipRow>
                  {SETUP_GRADES.map((g) => (
                    <Chip key={g} active={setupGrade === g} onClick={() => setSetupGrade(g)}>
                      {g}
                    </Chip>
                  ))}
                </ChipRow>
              </div>
              <div>
                <FieldLabel>Execution</FieldLabel>
                <ChipRow>
                  {EXEC_QUALITY.map((q) => (
                    <Chip key={q.id} active={execQuality === q.id} onClick={() => setExecQuality(q.id)}>
                      {q.label}
                    </Chip>
                  ))}
                </ChipRow>
              </div>
            </div>
            <div className="mt-3">
              <FieldLabel>Confluences that were present</FieldLabel>
              <ChipRow>
                {CONFLUENCES.map((cf) => (
                  <Chip
                    key={cf.id}
                    active={confluences.includes(cf.id)}
                    onClick={() => toggleIn(confluences, setConfluences, cf.id)}
                  >
                    {cf.label}
                  </Chip>
                ))}
              </ChipRow>
            </div>
            <div className="mt-3">
              <FieldLabel>Mistakes (required on losses — honesty gets price tags)</FieldLabel>
              <ChipRow>
                {MISTAKES.map((m) => (
                  <Chip
                    key={m.id}
                    active={mistakes.includes(m.id)}
                    onClick={() => toggleIn(mistakes, setMistakes, m.id)}
                  >
                    {m.label}
                  </Chip>
                ))}
              </ChipRow>
            </div>
            <div className="mt-3">
              <FieldLabel>Lesson + action tomorrow (required on losses)</FieldLabel>
              <textarea
                value={lesson}
                onChange={(e) => setLesson(e.target.value)}
                rows={2}
                placeholder='e.g. "Missing a setup is acceptable. Breaking entry criteria because of FOMO is not. Tomorrow: same criteria, no revenge trade."'
                className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
              />
            </div>
          </div>
        </div>
      )}

      <div>
        <FieldLabel>How did you feel?</FieldLabel>
        <ChipRow>
          {EMOTIONS.map((e) => (
            <Chip key={e.id} active={emotions.includes(e.id)} onClick={() => toggleEmotion(e.id)}>
              {e.label}
            </Chip>
          ))}
        </ChipRow>
      </div>

      <div>
        <FieldLabel>Chart screenshots</FieldLabel>
        <ScreenshotPicker ids={screenshots} onChange={setScreenshots} />
      </div>

      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        placeholder="What did you see? (optional)"
        className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
      />

      {error && <p role="alert" className="text-sm text-down">{error}</p>}

      <button
        type="button"
        onClick={() => void save()}
        disabled={saving || (!existing && !violation && (gate.loading || !gate.state || Boolean(planBlock(gate.state, gate.now)) || gate.state.plan?.id !== lockedPlan?.id))}
        className="w-full rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-40"
      >
        {saving ? "Saving..." : closeMode ? "Close trade" : existing ? "Save changes" : violation ? "Log rule break" : isClosed ? "Log trade" : "I'm in — log it"}
      </button>
    </div>
  );
}

function NewTradeGate({ onClose, prefill }: Pick<Props, "onClose" | "prefill">) {
  const gate = useEntryGate();
  const [ticket, setTicket] = useState<{ plan?: EntryPlan; unplanned?: boolean } | null>(() => {
    const live = gate.state?.plan;
    return live && gate.state && !planBlock(gate.state, gate.now) ? { plan: live } : null;
  });
  if (ticket) return <FormInner onClose={onClose} prefill={prefill} lockedPlan={ticket.plan} unplanned={ticket.unplanned} onBack={() => setTicket(null)} />;
  return <EntryGate onReady={(state) => setTicket({ plan: state.plan! })} onUnplanned={() => setTicket({ unplanned: true })} />;
}

export function TradeForm({ open, onClose, existing, prefill, closeMode }: Props) {
  const accountId = useApp((state) => state.accounts.find((account) => account.active === 1 && account.archived === 0)?.id);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={closeMode ? "Close trade" : existing ? "Edit trade" : "Log a trade"}
    >
      {existing ? <FormInner
        key={existing?.id ?? (prefill ? "prefill" : "new")}
        onClose={onClose}
        existing={existing}
        prefill={prefill}
        closeMode={closeMode}
      /> : <NewTradeGate key={accountId ?? "no-account"} onClose={onClose} prefill={prefill} />}
    </Sheet>
  );
}
