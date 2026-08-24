import { api } from "./api";
import type { Trade } from "./trades";

/** Wire format: array fields serialized as JSON strings (match D1 columns). */
type TradeRow = Omit<Trade, "emotions" | "screenshots" | "confluences" | "mistakes"> & {
  emotions: string;
  screenshots: string;
  confluences: string;
  mistakes: string;
};

const QUEUE_KEY = "tm_sync_queue_v1";
const CACHE_KEY = "tm_trades_cache_v1";

function toRow(t: Trade): TradeRow {
  return {
    ...t,
    emotions: JSON.stringify(t.emotions),
    screenshots: JSON.stringify(t.screenshots),
    confluences: JSON.stringify(t.confluences ?? []),
    mistakes: JSON.stringify(t.mistakes ?? []),
  };
}

function parseArr(raw: string | null | undefined): string[] {
  try {
    const parsed = JSON.parse(raw || "[]");
    return Array.isArray(parsed) ? parsed.filter((e) => typeof e === "string") : [];
  } catch {
    return [];
  }
}

function fromRow(r: TradeRow): Trade {
  return {
    ...r,
    emotions: parseArr(r.emotions),
    screenshots: parseArr(r.screenshots),
    confluences: parseArr(r.confluences),
    mistakes: parseArr(r.mistakes),
  };
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Queue an upsert for background sync (replaces any pending write for the same id). */
export function queueUpsert(t: Trade): void {
  const q = readJson<TradeRow[]>(QUEUE_KEY, []).filter((r) => r.id !== t.id);
  q.push(toRow(t));
  localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
}

/** Push pending writes to the server. Throws if offline/failed (queue is kept). */
export async function flushQueue(): Promise<void> {
  const q = readJson<TradeRow[]>(QUEUE_KEY, []);
  if (q.length === 0) return;
  if (!navigator.onLine) throw new Error("offline");
  for (let i = 0; i < q.length; i += 50) {
    await api("/trades", {
      method: "PUT",
      body: JSON.stringify({ trades: q.slice(i, i + 50) }),
    });
  }
  localStorage.setItem(QUEUE_KEY, "[]");
}

/** Server trades (cached for offline) merged with pending local writes. */
export async function fetchMergedTrades(): Promise<Trade[]> {
  let server: TradeRow[];
  try {
    const r = await api<{ trades: TradeRow[] }>("/trades");
    server = r.trades;
    localStorage.setItem(CACHE_KEY, JSON.stringify(server));
  } catch {
    server = readJson<TradeRow[]>(CACHE_KEY, []);
  }
  const map = new Map(server.map((r) => [r.id, fromRow(r)]));
  for (const row of readJson<TradeRow[]>(QUEUE_KEY, [])) {
    const pending = fromRow(row);
    const existing = map.get(pending.id);
    if (!existing || pending.updated_at >= existing.updated_at) map.set(pending.id, pending);
  }
  return [...map.values()]
    .filter((t) => !t.deleted)
    .sort((a, b) => b.opened_at.localeCompare(a.opened_at));
}
