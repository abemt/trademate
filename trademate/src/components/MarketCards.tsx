import { useEffect, useState } from "react";
import { Card } from "./Card";
import { IconClock, IconShield } from "./Icons";
import { RiskInput, riskPctOf } from "./RiskInput";
import { useApp } from "../lib/store";
import { accountTrades, currentBalance } from "../lib/trades";
import { SESSIONS, formatCountdown, localTimeOfUtcHour, sessionStatus } from "../lib/sessions";

export function useNow(intervalMs = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function SessionClock({ now }: { now: Date }) {
  return (
    <Card title="Sessions" icon={<IconClock />}>
      <ul className="space-y-2.5">
        {SESSIONS.map((s) => {
          const st = sessionStatus(s, now);
          return (
            <li
              key={s.name}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-ink-800/70 px-3 py-2.5"
            >
              <span className="relative flex h-2.5 w-2.5">
                {st.open && (
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-up opacity-60" />
                )}
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                    st.open ? "bg-up" : "bg-ink-600"
                  }`}
                />
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-sm font-medium text-white">
                  {s.name}
                  {s.prime && (
                    <span className="rounded-full bg-gold-500/15 px-1.5 py-px text-[9px] font-semibold uppercase tracking-wider text-gold-300">
                      prime time
                    </span>
                  )}
                </p>
                <p className="text-xs text-ink-400">
                  {localTimeOfUtcHour(s.startUtc)} – {localTimeOfUtcHour(s.endUtc)} your time
                </p>
              </div>
              <p className={`text-xs font-medium ${st.open ? "text-up" : "text-ink-300"}`}>
                {st.open ? `closes in ${formatCountdown(st.until, now)}` : `in ${formatCountdown(st.until, now)}`}
              </p>
            </li>
          );
        })}
      </ul>
    </Card>
  );
}

export function RiskCalc() {
  const profile = useApp((s) => s.profile);
  const trades = useApp((s) => s.trades);
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  // Risk is a share of the ACCOUNT SIZE, not the drifting live balance: 1% of a $10k eval is $100.
  const accountSize = active?.starting_balance ?? profile?.account_size ?? 10_000;
  const liveBalance = currentBalance(accountSize, accountTrades(trades, active?.id ?? null));
  const [riskUsd, setRiskUsd] = useState(() => (accountSize * (profile?.risk_pct_min ?? 0.5)) / 100);
  const [slPips, setSlPips] = useState(75);
  // Accounts arrive after first paint; re-seed the default once the real account size is known.
  useEffect(() => { setRiskUsd((accountSize * (profile?.risk_pct_min ?? 0.5)) / 100); }, [accountSize, profile?.risk_pct_min]);

  const riskPct = riskPctOf(riskUsd, accountSize);
  const idealLots = Math.floor((riskUsd / (slPips * 10)) * 100) / 100; // XAUUSD: $10/pip per lot
  const belowMin = idealLots < 0.01;
  // Broker minimum is 0.01 lots — on tiny accounts that IS the position, so show its real risk.
  const minLotRiskUsd = 0.01 * slPips * 10;
  const minLotRiskPct = accountSize > 0 ? (minLotRiskUsd / accountSize) * 100 : 0;

  return (
    <Card title="Risk Guard" icon={<IconShield />} badge={active?.label ?? profile?.account_label ?? "account"}>
      <RiskInput base={accountSize} riskUsd={riskUsd} onChange={setRiskUsd} className="mb-2" />
      <p className="mb-3 text-xs text-ink-400">
        {riskPct}% of the ${accountSize.toLocaleString(undefined, { maximumFractionDigits: 0 })} account size
        {Math.round(liveBalance) !== Math.round(accountSize) ? ` · live balance $${liveBalance.toLocaleString(undefined, { maximumFractionDigits: 0 })}` : ""}
      </p>

      <label className="block text-xs text-ink-300">
        Stop loss: <span className="font-semibold text-white">{slPips} pips</span>
        <input
          type="range"
          min={20}
          max={150}
          step={5}
          value={slPips}
          onChange={(e) => setSlPips(Number(e.target.value))}
          className="mt-1.5 w-full accent-(--color-gold-400)"
        />
      </label>

      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-xl bg-ink-800/70 p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">Position size</p>
          <p className={`text-xl font-bold ${belowMin ? "text-down" : "text-gold-300"}`}>
            {belowMin ? "0.01*" : idealLots.toFixed(2)} lots
          </p>
        </div>
        <div className="rounded-xl bg-ink-800/70 p-3 text-center">
          <p className="text-[10px] uppercase tracking-wider text-ink-400">
            {belowMin ? "Real risk at 0.01" : "Risk"}
          </p>
          <p className={`text-xl font-bold ${belowMin ? "text-down" : "text-white"}`}>
            ${belowMin ? minLotRiskUsd.toFixed(0) : riskUsd.toFixed(2)}
          </p>
        </div>
      </div>
      {belowMin && (
        <p className="mt-2 rounded-xl border border-down/30 bg-down/5 p-2.5 text-xs leading-relaxed text-down">
          *This account is below minimum operating size: {riskPct}% risk would need{" "}
          {idealLots.toFixed(3)} lots, but the broker minimum 0.01 risks ${minLotRiskUsd.toFixed(0)} ={" "}
          {minLotRiskPct.toFixed(0)}% of the account at this stop. There is no compliant size — that's
          math, not opinion. Per your contract: this account buys reps, not growth.
        </p>
      )}
    </Card>
  );
}
