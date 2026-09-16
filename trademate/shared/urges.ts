export const URGE_DOMAINS = [
  { id: "trading", label: "Trading" },
  { id: "gaming", label: "Siege" },
  { id: "life", label: "Life" },
] as const;
export type UrgeDomain = typeof URGE_DOMAINS[number]["id"];

export const URGE_OUTCOMES = ["resisted", "acted", "pending"] as const;
export type UrgeOutcome = typeof URGE_OUTCOMES[number];

/** The permission sentences Autopilot uses on him — tapping one is faster than typing. */
export const PERMISSION_SENTENCES = [
  "One loss won't take me anywhere",
  "It's basically there",
  "Just one more",
  "I'll win it back",
  "I can win this fight",
  "I'll do it later",
] as const;

export interface UrgeEntry {
  id: string;
  created_at: string;
  updated_at: string;
  domain: UrgeDomain;
  intensity: number;
  sentence: string | null;
  feeling: string | null;
  outcome: UrgeOutcome;
  instead: string | null;
}

export function validateUrge(input: unknown): Omit<UrgeEntry, "created_at" | "updated_at"> {
  if (!input || typeof input !== "object") throw new Error("Nothing to log.");
  const value = input as Record<string, unknown>;
  const text = (field: unknown, limit: number) => {
    if (field === undefined || field === null) return null;
    if (typeof field !== "string") throw new Error("Text fields must be strings.");
    const trimmed = field.trim().slice(0, limit);
    return trimmed === "" ? null : trimmed;
  };
  if (typeof value.id !== "string" || !/^[A-Za-z0-9-]{8,64}$/.test(value.id)) throw new Error("Bad entry id.");
  if (!URGE_DOMAINS.some((domain) => domain.id === value.domain)) throw new Error("Pick where it happened: trading, Siege or life.");
  if (typeof value.intensity !== "number" || !Number.isInteger(value.intensity) || value.intensity < 1 || value.intensity > 5) throw new Error("Rate the urge 1-5.");
  if (!URGE_OUTCOMES.includes(value.outcome as UrgeOutcome)) throw new Error("Say what happened: walked away, acted, or still deciding.");
  return {
    id: value.id,
    domain: value.domain as UrgeDomain,
    intensity: value.intensity,
    sentence: text(value.sentence, 300),
    feeling: text(value.feeling, 2000),
    outcome: value.outcome as UrgeOutcome,
    instead: text(value.instead, 500),
  };
}

export function summarizeUrges(entries: UrgeEntry[]) {
  const resisted = entries.filter((entry) => entry.outcome === "resisted").length;
  const acted = entries.filter((entry) => entry.outcome === "acted").length;
  const pending = entries.filter((entry) => entry.outcome === "pending").length;
  const decided = resisted + acted;
  const sentences = new Map<string, number>();
  const domains = new Map<string, number>();
  for (const entry of entries) {
    if (entry.sentence) sentences.set(entry.sentence, (sentences.get(entry.sentence) ?? 0) + 1);
    domains.set(entry.domain, (domains.get(entry.domain) ?? 0) + 1);
  }
  const top = [...sentences.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  return {
    total: entries.length, resisted, acted, pending,
    catchRate: decided ? Math.round((resisted / decided) * 100) : null,
    topSentence: top ? { text: top[0], count: top[1] } : null,
    byDomain: Object.fromEntries(domains),
  };
}
