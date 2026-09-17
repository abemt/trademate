import { useEffect, useState } from "react";
import { Chip } from "./Chip";

/** Preset risk levels in % of account size; the first is his current eval rule. */
export const RISK_PRESETS = [0.2, 0.25, 0.5, 1, 2];

const fmtUsd = (usd: number) => (usd > 0 ? String(Math.round(usd * 100) / 100) : "");
const fmtPct = (pct: number) => (pct > 0 ? String(Math.round(pct * 1000) / 1000) : "");

export function riskPctOf(riskUsd: number, base: number): number {
  return base > 0 ? Math.round((riskUsd / base) * 10000) / 100 : 0;
}

/**
 * Risk chooser sized off the ACCOUNT SIZE (starting balance), so 1% of a $10k eval is $100 even when
 * the live balance has drifted. Both boxes accept free typing; the value only propagates once it parses.
 */
export function RiskInput({ base, riskUsd, onChange, className = "" }: {
  base: number;
  riskUsd: number;
  onChange: (riskUsd: number) => void;
  className?: string;
}) {
  const [usdText, setUsdText] = useState(() => fmtUsd(riskUsd));
  const [pctText, setPctText] = useState(() => fmtPct(riskPctOf(riskUsd, base)));

  // Re-format a box only when the value no longer matches what is typed in it, so half-typed
  // input ("", "20.", "0.") is never snatched away mid-keystroke.
  useEffect(() => {
    const pct = riskPctOf(riskUsd, base);
    setUsdText((text) => (Math.abs((Number.parseFloat(text) || 0) - riskUsd) < 0.005 ? text : fmtUsd(riskUsd)));
    setPctText((text) => (Math.abs((Number.parseFloat(text) || 0) - pct) < 0.0005 ? text : fmtPct(pct)));
  }, [riskUsd, base]);

  const inputClass = "w-20 rounded-lg border border-white/10 bg-ink-800 px-2 py-1.5 text-sm font-semibold text-white outline-none focus:border-gold-500/60";

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className}`}>
      {RISK_PRESETS.map((pct) => {
        const usd = (base * pct) / 100;
        return (
          <Chip key={pct} active={Math.abs(riskUsd - usd) < 0.005} onClick={() => onChange(usd)}>
            {pct}% <span className="opacity-70">· ${usd % 1 === 0 ? usd : usd.toFixed(2)}</span>
          </Chip>
        );
      })}
      <label className="flex items-center gap-1 text-xs text-ink-400">
        $
        <input
          type="text"
          inputMode="decimal"
          aria-label="Risk in dollars"
          value={usdText}
          onChange={(e) => {
            const text = e.target.value;
            setUsdText(text);
            const usd = Number.parseFloat(text);
            if (Number.isFinite(usd) && usd >= 0) onChange(usd);
          }}
          className={inputClass}
        />
      </label>
      <label className="flex items-center gap-1 text-xs text-ink-400">
        <input
          type="text"
          inputMode="decimal"
          aria-label="Risk in percent of account size"
          value={pctText}
          onChange={(e) => {
            const text = e.target.value;
            setPctText(text);
            const pct = Number.parseFloat(text);
            if (Number.isFinite(pct) && pct >= 0 && base > 0) onChange((base * pct) / 100);
          }}
          className={inputClass}
        />
        %
      </label>
    </div>
  );
}
