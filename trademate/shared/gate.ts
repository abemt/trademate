/**
 * The A+ gate: seven yes/no lines answered before the click.
 * 7/7 = A+. Anything less is a half-setup — it goes in the Notebook as a shadow, not in the market.
 * Lines 1–3 are his word (the record shows it); 4–7 are computed from the ticket.
 */
export const GATE_LINES = [
  { id: "level", n: 1, auto: false, label: "Level written before price got there", hint: "In the morning read, or in a plan with the alert set before the touch. Found at the touch = not a level." },
  { id: "touch", n: 2, auto: false, label: "Second touch — the first was already rejected", hint: "\u201cForming\u201d and \u201cbasically there\u201d are no." },
  { id: "close", n: 3, auto: false, label: "15m candle closed in my direction; entering on that close", hint: "Not the 1m. Not five dollars better." },
  { id: "stop", n: 4, auto: false, label: "Stop beyond the extreme +30\u201350 pips, outside the range", hint: "Over 100 pips: skip, never shrink." },
  { id: "target", n: 5, auto: true, label: "Target is the swing from the read, as an order, \u22652R", hint: "Type the target price and the ticket checks this." },
  { id: "state", n: 6, auto: true, label: "Urge 1 \u2014 the chart was opened by an alert or at 17:00, not by boredom", hint: "Urge 2 or more: the record says no." },
  { id: "first", n: 7, auto: true, label: "First trade of the day", hint: "When it closes: log, bank, close the platform, leave the room." },
] as const;

export type GateLineId = (typeof GATE_LINES)[number]["id"];
export const GATE_IDS: readonly GateLineId[] = GATE_LINES.map((line) => line.id);
export const GATE_MAX_STOP_PIPS = 100;
export const GATE_MIN_R = 2;

export function isGateLineId(value: unknown): value is GateLineId {
  return typeof value === "string" && (GATE_IDS as readonly string[]).includes(value);
}

/** Only known line ids, each once, in gate order. */
export function normalizeGate(value: unknown): GateLineId[] {
  if (!Array.isArray(value)) return [];
  const present = new Set(value.filter(isGateLineId));
  return GATE_IDS.filter((id) => present.has(id));
}

export function gateScore(gate: readonly string[] | null | undefined): number {
  return normalizeGate(gate ?? []).length;
}

export function gateMissing(gate: readonly string[] | null | undefined) {
  const passed = new Set(normalizeGate(gate ?? []));
  return GATE_LINES.filter((line) => !passed.has(line.id));
}

/** "A+ 7/7" or "Half-setup 4/7 · missing 2, 3, 6"; null when the trade was never graded. */
export function gateLabel(gate: readonly string[] | null | undefined, score: number | null | undefined): string | null {
  if (score === null || score === undefined) return null;
  if (score >= GATE_LINES.length) return `A+ ${GATE_LINES.length}/${GATE_LINES.length}`;
  const missing = gateMissing(gate).map((line) => line.n).join(", ");
  return `Half-setup ${score}/${GATE_LINES.length}${missing ? ` \u00b7 missing ${missing}` : ""}`;
}

/** The computed lines, from what the ticket already knows. */
export function autoGateLines(input: {
  plannedR: number | null;
  stopPips: number | null;
  urgeBefore: number | null;
  tradesToday: number | null;
}): { target: boolean; state: boolean; first: boolean; stopTooWide: boolean } {
  return {
    target: input.plannedR !== null && input.plannedR >= GATE_MIN_R,
    state: input.urgeBefore === 1,
    first: input.tradesToday === 0,
    stopTooWide: input.stopPips !== null && input.stopPips > GATE_MAX_STOP_PIPS,
  };
}
