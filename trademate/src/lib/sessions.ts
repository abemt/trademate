export interface SessionDef {
  name: string;
  startUtc: number; // hour, UTC
  endUtc: number;
  prime?: boolean;
}

export const SESSIONS: SessionDef[] = [
  { name: "Asia", startUtc: 0, endUtc: 9 },
  { name: "London", startUtc: 7, endUtc: 16 },
  { name: "New York", startUtc: 12, endUtc: 21, prime: true },
];

export interface SessionStatus {
  open: boolean;
  /** next transition (close time if open, open time if closed) */
  until: Date;
}

/** Finds the current/next weekday window for a session (Sat/Sun skipped). */
export function sessionStatus(s: SessionDef, from: Date): SessionStatus {
  for (let offset = 0; offset <= 8; offset++) {
    const dayStart = Date.UTC(
      from.getUTCFullYear(),
      from.getUTCMonth(),
      from.getUTCDate() + offset,
    );
    const dow = new Date(dayStart).getUTCDay();
    if (dow === 0 || dow === 6) continue;
    const start = new Date(dayStart + s.startUtc * 3_600_000);
    const end = new Date(dayStart + s.endUtc * 3_600_000);
    if (from >= start && from < end) return { open: true, until: end };
    if (from < start) return { open: false, until: start };
  }
  // unreachable — 8 days always contain a weekday
  return { open: false, until: from };
}

export function formatCountdown(to: Date, from: Date): string {
  const mins = Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  return `${m}m`;
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });

/** Local wall-clock time for a UTC hour today, e.g. 12 UTC -> "3:00 PM". */
export function localTimeOfUtcHour(utcHour: number): string {
  const now = new Date();
  const d = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), utcHour),
  );
  return timeFmt.format(d);
}
