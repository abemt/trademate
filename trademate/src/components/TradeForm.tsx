import { useState } from "react";
import { Chip, ChipRow, FieldLabel } from "./Chip";
import { IconTrendDown, IconTrendUp } from "./Icons";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { Sheet } from "./Sheet";
import { useApp } from "../lib/store";
import {
  EMOTIONS,
  SETUPS,
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

function FormInner({ onClose, existing, prefill, closeMode }: Omit<Props, "open">) {
  const profile = useApp((s) => s.profile);
  const saveTrade = useApp((s) => s.saveTrade);
  const accountSize = profile?.account_size ?? 10_000;

  const base = existing ?? prefill ?? null;
  const initialSetup = base?.setup_type ?? null;
  const isKnownSetup = initialSetup === null || SETUPS.some((s) => s.id === initialSetup);

  const [direction, setDirection] = useState<"long" | "short" | null>(base?.direction ?? null);
  const [setup, setSetup] = useState<string | null>(isKnownSetup ? initialSetup : "other");
  const [customSetup, setCustomSetup] = useState<string>(
    isKnownSetup ? "" : (initialSetup as string),
  );
  const [screenshots, setScreenshots] = useState<string[]>(base?.screenshots ?? []);
  const [trigger, setTrigger] = useState<string | null>(base?.entry_trigger ?? null);
  const [timeframe, setTimeframe] = useState<string | null>(base?.timeframe ?? "M15");
  const [session, setSession] = useState<string>(base?.session ?? currentSessionId());
  const [riskPct, setRiskPct] = useState<number>(
    existing?.risk_pct ?? profile?.risk_pct_min ?? 0.5,
  );
  const [slPips, setSlPips] = useState<number>(existing?.sl_pips ?? 75);
  const [entryPrice, setEntryPrice] = useState<string>(
    existing?.entry_price != null ? String(existing.entry_price) : "",
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
  const [error, setError] = useState<string>("");

  const riskUsd = Math.round(((accountSize * riskPct) / 100) * 100) / 100;
  const lots = Math.max(0.01, Math.floor((riskUsd / (slPips * 10)) * 100) / 100);

  function toggleEmotion(id: string) {
    setEmotions((prev) =>
      prev.includes(id) ? prev.filter((e) => e !== id) : [...prev, id],
    );
  }

  function save() {
    if (!direction) {
      setError("Long or short?");
      return;
    }
    const pnl = isClosed ? Number.parseFloat(pnlText) : null;
    if (isClosed && (pnlText.trim() === "" || Number.isNaN(pnl))) {
      setError("Enter the P&L — the R buttons fill it for you.");
      return;
    }
    const now = new Date().toISOString();
    const trade: Trade = {
      id: existing?.id ?? crypto.randomUUID(),
      instrument: "XAUUSD",
      direction,
      setup_type: setup === "other" && customSetup.trim() !== "" ? customSetup.trim() : setup,
      entry_trigger: trigger,
      session,
      timeframe,
      entry_price: entryPrice.trim() === "" ? null : Number.parseFloat(entryPrice) || null,
      sl_price: existing?.sl_price ?? null,
      tp_price: existing?.tp_price ?? null,
      exit_price: existing?.exit_price ?? null,
      sl_pips: slPips,
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
      followed_plan: isClosed ? followedPlan : null,
      notes: notes.trim() === "" ? null : notes.trim(),
      opened_at: existing?.opened_at ?? now,
      closed_at: isClosed ? (existing?.closed_at ?? now) : null,
      updated_at: now,
      deleted: 0,
    };
    void saveTrade(trade);
    onClose();
  }

  return (
    <div className="space-y-5">
      <div>
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
      </div>

      <div>
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
        <FieldLabel>Risk</FieldLabel>
        <div className="flex items-center gap-2">
          {[0.5, 1].map((r) => (
            <Chip key={r} active={riskPct === r} onClick={() => setRiskPct(r)}>
              {r}%
            </Chip>
          ))}
          <span className="ml-auto text-xs text-ink-400">
            <span className="font-semibold text-gold-300">{lots.toFixed(2)} lots</span> · $
            {riskUsd.toFixed(0)} at risk
          </span>
        </div>
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
        <input
          type="text"
          inputMode="decimal"
          value={entryPrice}
          onChange={(e) => setEntryPrice(e.target.value)}
          placeholder="Entry price (optional)"
          className="mt-2 w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
        />
      </div>

      {!closeMode && (
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
          <div className="mt-3">
            <FieldLabel>Did you follow your plan?</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <Chip active={followedPlan === 1} onClick={() => setFollowedPlan(1)}>
                Followed my plan
              </Chip>
              <Chip active={followedPlan === 0} onClick={() => setFollowedPlan(0)}>
                Broke my plan
              </Chip>
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

      {error && <p className="text-sm text-down">{error}</p>}

      <button
        type="button"
        onClick={save}
        className="w-full rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400"
      >
        {closeMode ? "Close trade" : existing ? "Save changes" : isClosed ? "Log trade" : "I'm in — log it"}
      </button>
    </div>
  );
}

export function TradeForm({ open, onClose, existing, prefill, closeMode }: Props) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={closeMode ? "Close trade" : existing ? "Edit trade" : "Log a trade"}
    >
      <FormInner
        key={existing?.id ?? (prefill ? "prefill" : "new")}
        onClose={onClose}
        existing={existing}
        prefill={prefill}
        closeMode={closeMode}
      />
    </Sheet>
  );
}
