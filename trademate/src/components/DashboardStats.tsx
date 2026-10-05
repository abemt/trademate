import { useMemo, useState } from "react";
import { Card } from "./Card";
import { EquityCurve } from "./EquityCurve";
import { IconGauge } from "./Icons";
import { useApp } from "../lib/store";
import { accountTrades, computeStats, currentBalance, fmtR, fmtUsd } from "../lib/trades";

const RANGES = [
  { id: "1d", label: "Today", days: 1 },
  { id: "7d", label: "7D", days: 7 },
  { id: "30d", label: "30D", days: 30 },
  { id: "90d", label: "90D", days: 90 },
  { id: "all", label: "ALL", days: null as number | null },
] as const;

function PFRing({ pf }: { pf: number | null }) {
  const frac = pf === null ? 0 : Math.min(1, pf / 3);
  const C = 2 * Math.PI * 14;
  return (
    <svg viewBox="0 0 36 36" className="h-8 w-8 -rotate-90">
      <circle cx="18" cy="18" r="14" fill="none" stroke="var(--color-ink-700)" strokeWidth="4" />
      <circle
        cx="18"
        cy="18"
        r="14"
        fill="none"
        stroke={pf !== null && pf >= 1 ? "var(--color-up)" : "var(--color-down)"}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={`${(C * frac).toFixed(1)} ${C.toFixed(1)}`}
      />
    </svg>
  );
}

function KpiTile({
  label,
  value,
  tone,
  extra,
}: {
  label: string;
  value: string;
  tone?: "up" | "down";
  extra?: React.ReactNode;
}) {
  const color = tone === "up" ? "text-up" : tone === "down" ? "text-down" : "text-white";
  return (
    <div className="flex items-center justify-between gap-2 rounded-2xl border border-white/5 bg-ink-900/90 px-3.5 py-3 shadow-[var(--card-shadow)]">
      <div className="min-w-0">
        <p className="text-[9px] uppercase tracking-wider text-ink-400">{label}</p>
        <p className={`truncate text-lg font-bold ${color}`}>{value}</p>
      </div>
      {extra}
    </div>
  );
}

/** Account at a glance for a chosen range: balance, net, win rate, avg R, profit factor and the dated equity curve. */
export function DashboardStats() {
  const profile = useApp((s) => s.profile);
  const allTrades = useApp((s) => s.trades);
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const acctTrades = useMemo(
    () => accountTrades(allTrades, active?.id ?? null),
    [allTrades, active?.id],
  );
  const [range, setRange] = useState<string>("30d");
  const days = RANGES.find((r) => r.id === range)?.days ?? null;
  const ranged = useMemo(() => {
    if (days === null) return acctTrades;
    const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
    return acctTrades.filter((t) => (t.closed_at ?? t.opened_at) >= cutoff);
  }, [acctTrades, days]);
  const maxPerDay = profile?.max_trades_per_day ?? 2;
  const s = useMemo(() => computeStats(ranged, maxPerDay), [ranged, maxPerDay]);
  const balance = currentBalance(
    active?.starting_balance ?? profile?.account_size ?? 0,
    acctTrades,
  );

  // Dated cumulative curve for the selected range.
  const { curvePts, curveLabels } = useMemo(() => {
    const closed = ranged
      .filter((t) => !t.deleted && t.status === "closed" && t.pnl_usd !== null)
      .sort((a, b) => (a.closed_at ?? a.opened_at).localeCompare(b.closed_at ?? b.opened_at));
    let run = 0;
    const pts: number[] = [];
    const lbls: string[] = [];
    for (const t of closed) {
      run += t.pnl_usd ?? 0;
      pts.push(Math.round(run * 100) / 100);
      lbls.push(
        new Date(t.closed_at ?? t.opened_at).toLocaleDateString(undefined, {
          month: "short",
          day: "numeric",
        }),
      );
    }
    return { curvePts: pts, curveLabels: lbls };
  }, [ranged]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 overflow-x-auto">
        <span className="mr-auto text-[10px] font-semibold uppercase tracking-wider text-ink-400">
          {active?.label ?? "Account"}
        </span>
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={`rounded-lg px-2.5 py-1 text-[11px] font-bold transition ${
              range === r.id
                ? "bg-gold-500 text-ink-950"
                : "border border-white/10 bg-ink-800 text-ink-400 hover:text-ink-200"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KpiTile label="Account balance" value={`$${balance.toLocaleString(undefined, { maximumFractionDigits: 2 })}`} />
        <KpiTile
          label="Closed net P&L"
          value={fmtUsd(s.netUsd)}
          tone={s.netUsd > 0 ? "up" : s.netUsd < 0 ? "down" : undefined}
        />
        <KpiTile label="Win rate" value={s.winRate !== null ? `${s.winRate}%` : "—"} />
        <KpiTile
          label="Avg R / trade"
          value={s.avgR !== null ? fmtR(s.avgR) : "—"}
          tone={s.avgR !== null ? (s.avgR > 0 ? "up" : "down") : undefined}
        />
        <KpiTile
          label="Profit factor"
          value={s.profitFactor !== null ? s.profitFactor.toFixed(2) : "—"}
          extra={<PFRing pf={s.profitFactor} />}
        />
      </div>
      <Card title="Equity" icon={<IconGauge />} badge={`cumulative $ · ${RANGES.find((r) => r.id === range)?.label}`}>
        {curvePts.length > 2 ? (
          <EquityCurve points={curvePts} labels={curveLabels} />
        ) : (
          <p className="py-4 text-center text-sm text-ink-400">
            Close a few trades in this range and the curve draws itself.
          </p>
        )}
      </Card>
    </div>
  );
}
