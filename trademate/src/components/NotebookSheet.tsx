import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { Sheet } from "./Sheet";
import { MISTAKES, fmtR, fmtUsd, localDateKey, optionLabel, type Trade } from "../lib/trades";

interface Note {
  id: string;
  kind: string;
  title: string;
  body: string;
  updated_at: string;
}

const KIND_BADGE: Record<string, string> = {
  daily: "text-gold-400",
  weekly: "text-up",
  monthly: "text-down",
  free: "text-ink-400",
};

/** Templates pre-fill from the journal — you only write the part the database can't know. */
function buildTemplate(kind: "daily" | "weekly" | "monthly", trades: Trade[]): { title: string; body: string } {
  const now = new Date();
  const todayKey = localDateKey(now.toISOString());
  let cutoff: string;
  let label: string;
  if (kind === "daily") {
    cutoff = todayKey;
    label = `Daily review — ${todayKey}`;
  } else if (kind === "weekly") {
    cutoff = localDateKey(new Date(Date.now() - 6 * 86_400_000).toISOString());
    label = `Weekly review — week ending ${todayKey}`;
  } else {
    cutoff = `${todayKey.slice(0, 7)}-01`;
    label = `Monthly review — ${now.toLocaleDateString(undefined, { month: "long", year: "numeric" })}`;
  }

  const closed = trades.filter(
    (t) =>
      !t.deleted &&
      t.status === "closed" &&
      t.pnl_usd !== null &&
      localDateKey(t.closed_at ?? t.opened_at) >= cutoff,
  );
  const wins = closed.filter((t) => (t.pnl_usd ?? 0) > 0).length;
  const netUsd = closed.reduce((s, t) => s + (t.pnl_usd ?? 0), 0);
  const netR = closed.reduce((s, t) => s + (t.r_multiple ?? 0), 0);
  const winRate = closed.length ? Math.round((100 * wins) / closed.length) : null;

  const mistakeTally = new Map<string, number>();
  for (const t of closed) {
    for (const m of t.mistakes ?? []) {
      if (m !== "clean") mistakeTally.set(m, (mistakeTally.get(m) ?? 0) + 1);
    }
  }
  const topMistakes = [...mistakeTally.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([id, n]) => `${optionLabel(MISTAKES, id) ?? id} (${n}×)`)
    .join(", ");

  const body = [
    `Trades: ${closed.length} · Wins: ${wins} · Win rate: ${winRate ?? "—"}%`,
    `Net: ${fmtUsd(netUsd)} (${fmtR(netR)})`,
    `Top mistakes: ${topMistakes || "none tagged"}`,
    "",
    "What I saw in the market:",
    "",
    "What I did well:",
    "",
    "What I'll change next:",
    "",
  ].join("\n");

  return { title: label, body };
}

export function NotebookSheet({
  open,
  onClose,
  trades,
}: {
  open: boolean;
  onClose: () => void;
  trades: Trade[];
}) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [editing, setEditing] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ notes: Note[] }>("/notes")
      .then((r) => setNotes(r.notes))
      .catch(() => {});
  }, [open]);

  function newNote(kind: "daily" | "weekly" | "monthly" | "free") {
    const t =
      kind === "free"
        ? { title: "", body: "" }
        : buildTemplate(kind, trades);
    setEditing({
      id: `note-${crypto.randomUUID().slice(0, 8)}`,
      kind,
      title: t.title,
      body: t.body,
      updated_at: new Date().toISOString(),
    });
  }

  async function save() {
    if (!editing) return;
    setBusy(true);
    try {
      await api("/notes", {
        method: "POST",
        body: JSON.stringify({
          id: editing.id,
          kind: editing.kind,
          title: editing.title.trim() || "Untitled",
          body: editing.body,
        }),
      });
      const r = await api<{ notes: Note[] }>("/notes");
      setNotes(r.notes);
      setEditing(null);
    } catch {
      // keep editing open on failure
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!editing) return;
    if (!window.confirm("Delete this note?")) return;
    await api("/notes/delete", { method: "POST", body: JSON.stringify({ id: editing.id }) }).catch(
      () => {},
    );
    setNotes((n) => n.filter((x) => x.id !== editing.id));
    setEditing(null);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Notebook">
      {editing === null ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-300">
            Review templates fill their own statistics from your journal — you only write what
            the database can't know.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {(["daily", "weekly", "monthly", "free"] as const).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => newNote(k)}
                className="rounded-xl border border-gold-500/30 bg-gold-500/5 py-2.5 text-sm font-semibold capitalize text-gold-400 transition hover:bg-gold-500/10"
              >
                ＋ {k === "free" ? "Blank note" : `${k} review`}
              </button>
            ))}
          </div>
          <ul className="space-y-2">
            {notes.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => setEditing(n)}
                  className="w-full rounded-xl border border-white/10 bg-ink-800 p-3 text-left transition hover:border-gold-500/40"
                >
                  <p className="truncate text-sm font-semibold text-white">{n.title}</p>
                  <p className="text-[10px] text-ink-400">
                    <span className={`font-bold uppercase ${KIND_BADGE[n.kind] ?? ""}`}>{n.kind}</span>
                    {" · "}
                    {new Date(n.updated_at + (n.updated_at.endsWith("Z") ? "" : "Z")).toLocaleString([], {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </button>
              </li>
            ))}
          </ul>
          {notes.length === 0 && (
            <p className="text-center text-xs text-ink-500">No notes yet — start with a daily review.</p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            value={editing.title}
            onChange={(e) => setEditing({ ...editing, title: e.target.value })}
            placeholder="Title"
            className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm font-semibold text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          <textarea
            value={editing.body}
            onChange={(e) => setEditing({ ...editing, body: e.target.value })}
            rows={14}
            className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm leading-relaxed text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-xl border border-white/10 bg-ink-800 py-2.5 text-sm font-semibold text-ink-300"
            >
              Back
            </button>
            <button
              type="button"
              onClick={() => void save()}
              disabled={busy}
              className="rounded-xl bg-gold-500 py-2.5 text-sm font-semibold text-ink-950 disabled:opacity-50"
            >
              {busy ? "Saving…" : "Save note"}
            </button>
          </div>
          <button
            type="button"
            onClick={() => void remove()}
            className="w-full rounded-xl border border-down/30 bg-down/5 py-2 text-xs font-semibold text-down transition hover:bg-down/10"
          >
            Delete note
          </button>
        </div>
      )}
    </Sheet>
  );
}
