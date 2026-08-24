/** Cumulative P&L sparkline shared by the dashboard and Stats. */
export function EquityCurve({ points }: { points: number[] }) {
  const w = 300;
  const h = 88;
  const pad = 6;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const xy = points.map(
    (v, i) =>
      [pad + i * step, h - pad - ((v - min) / span) * (h - pad * 2)] as const,
  );
  const path = xy.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const zeroY = h - pad - ((0 - min) / span) * (h - pad * 2);
  const last = xy[xy.length - 1];
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      {min < 0 && max > 0 && (
        <line x1={pad} x2={w - pad} y1={zeroY} y2={zeroY} stroke="var(--color-ink-600)" strokeDasharray="3 3" />
      )}
      <path
        d={path}
        fill="none"
        stroke="var(--color-up)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="3" fill="var(--color-up)" />
    </svg>
  );
}
