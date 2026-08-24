/** Cumulative P&L curve: muted green, gradient area fill, gridlines, optional date axis. */
export function EquityCurve({
  points,
  labels,
}: {
  points: number[];
  labels?: string[];
}) {
  const w = 300;
  const chartH = 96;
  const hasLabels = !!labels && labels.length === points.length && points.length > 1;
  const h = hasLabels ? chartH + 14 : chartH;
  const pad = 6;
  const min = Math.min(...points, 0);
  const max = Math.max(...points, 0);
  const span = max - min || 1;
  const step = (w - pad * 2) / (points.length - 1);
  const y = (v: number) => chartH - pad - ((v - min) / span) * (chartH - pad * 2);
  const xy = points.map((v, i) => [pad + i * step, y(v)] as const);
  const line = xy.map(([x, yy], i) => `${i ? "L" : "M"}${x.toFixed(1)},${yy.toFixed(1)}`).join(" ");
  const area = `${line} L${xy[xy.length - 1][0].toFixed(1)},${(chartH - pad).toFixed(1)} L${pad},${(chartH - pad).toFixed(1)} Z`;
  const zeroY = y(0);
  const last = xy[xy.length - 1];
  const stroke = "#2aa876"; // muted emerald — readable on both themes without glare

  // Up to 4 evenly spaced date labels.
  const labelIdx: number[] = [];
  if (hasLabels) {
    const n = Math.min(4, points.length);
    for (let i = 0; i < n; i++) {
      labelIdx.push(Math.round((i * (points.length - 1)) / (n - 1 || 1)));
    }
  }

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full">
      <defs>
        <linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      {[0.25, 0.5, 0.75].map((f) => {
        const gy = pad + f * (chartH - pad * 2);
        return (
          <line
            key={f}
            x1={pad}
            x2={w - pad}
            y1={gy}
            y2={gy}
            stroke="var(--color-ink-700)"
            strokeWidth="0.6"
            strokeDasharray="2 4"
          />
        );
      })}
      <path d={area} fill="url(#eqfill)" />
      {min < 0 && max > 0 && (
        <line
          x1={pad}
          x2={w - pad}
          y1={zeroY}
          y2={zeroY}
          stroke="var(--color-ink-600)"
          strokeDasharray="3 3"
          strokeWidth="0.8"
        />
      )}
      <path
        d={line}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle cx={last[0]} cy={last[1]} r="3.5" fill={stroke} />
      <circle cx={last[0]} cy={last[1]} r="6.5" fill={stroke} opacity="0.2" />
      <text
        x={w - pad}
        y={y(max) + 3}
        textAnchor="end"
        fontSize="7"
        fontWeight="700"
        className="fill-(--color-ink-300)"
      >
        {max > 0 ? `+$${Math.round(max)}` : `$${Math.round(max)}`}
      </text>
      {min < 0 && (
        <text
          x={w - pad}
          y={y(min) - 2}
          textAnchor="end"
          fontSize="7"
          fontWeight="700"
          className="fill-(--color-ink-300)"
        >
          -${Math.abs(Math.round(min))}
        </text>
      )}
      {hasLabels &&
        labelIdx.map((idx, i) => (
          <text
            key={idx}
            x={xy[idx][0]}
            y={h - 3}
            textAnchor={i === 0 ? "start" : i === labelIdx.length - 1 ? "end" : "middle"}
            fontSize="7"
            className="fill-(--color-ink-400)"
          >
            {labels?.[idx]}
          </text>
        ))}
    </svg>
  );
}
