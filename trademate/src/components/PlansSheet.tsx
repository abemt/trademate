import { useState } from "react";
import { api } from "../lib/api";
import { FieldLabel } from "./Chip";
import { ScreenshotPicker } from "./ScreenshotPicker";
import { Sheet } from "./Sheet";

export interface Plan {
  id: string;
  name: string;
  plan_type: string | null;
  charting_process: string;
  entry_criteria: string;
  management_rules: string | null;
  exit_criteria: string;
  notes: string | null;
  screenshots: string;
  archived: number;
}

export function planLines(raw: string | null | undefined): string[] {
  try {
    const a = JSON.parse(raw || "[]");
    return Array.isArray(a) ? a.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

const inputCls =
  "w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60";

function LinesField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <FieldLabel>{label} — one per line</FieldLabel>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={hint}
        className={`${inputCls} resize-none`}
      />
    </div>
  );
}

export function PlansSheet({
  open,
  onClose,
  plans,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  plans: Plan[];
  onChanged: () => void;
}) {
  const [editingId, setEditingId] = useState<string | "new" | null>(null);
  const [name, setName] = useState("");
  const [planType, setPlanType] = useState("");
  const [charting, setCharting] = useState("");
  const [entry, setEntry] = useState("");
  const [mgmt, setMgmt] = useState("");
  const [exits, setExits] = useState("");
  const [planNotes, setPlanNotes] = useState("");
  const [shots, setShots] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  function startEdit(p: Plan | null) {
    setEditingId(p?.id ?? "new");
    setName(p?.name ?? "");
    setPlanType(p?.plan_type ?? "");
    setCharting(planLines(p?.charting_process).join("\n"));
    setEntry(planLines(p?.entry_criteria).join("\n"));
    setMgmt(p?.management_rules ?? "");
    setExits(planLines(p?.exit_criteria).join("\n"));
    setPlanNotes(p?.notes ?? "");
    setShots(planLines(p?.screenshots));
    setErr("");
  }

  const toLines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  async function save() {
    if (!name.trim()) {
      setErr("Name the plan — e.g. Break & Retest (NY)");
      return;
    }
    if (toLines(entry).length === 0) {
      setErr("At least one entry criterion — that's what the AI grades against.");
      return;
    }
    setBusy(true);
    setErr("");
    try {
      await api("/plans", {
        method: "POST",
        body: JSON.stringify({
          id: editingId === "new" ? undefined : editingId,
          name: name.trim(),
          plan_type: planType.trim() || undefined,
          charting_process: toLines(charting),
          entry_criteria: toLines(entry),
          management_rules: mgmt.trim() || undefined,
          exit_criteria: toLines(exits),
          notes: planNotes.trim() || undefined,
          screenshots: shots,
        }),
      });
      onChanged();
      setEditingId(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  }

  async function archive(id: string) {
    if (!window.confirm("Archive this plan? Past trades keep their history.")) return;
    await api("/plans/archive", { method: "POST", body: JSON.stringify({ id }) }).catch(() => {});
    onChanged();
    setEditingId(null);
  }

  return (
    <Sheet open={open} onClose={onClose} title="Playbook">
      {editingId === null ? (
        <div className="space-y-3">
          <p className="text-sm leading-relaxed text-ink-300">
            Write the plan once — then every setup you analyze gets graded against its exact
            criteria. A good trade outside the plan is still a broken plan.
          </p>
          <ul className="space-y-2">
            {plans.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => startEdit(p)}
                  className="w-full rounded-xl border border-white/10 bg-ink-800 p-3 text-left transition hover:border-gold-500/40"
                >
                  <p className="text-sm font-semibold text-white">{p.name}</p>
                  <p className="text-xs text-ink-400">
                    {p.plan_type ? `${p.plan_type} · ` : ""}
                    {planLines(p.entry_criteria).length} entry criteria
                  </p>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            onClick={() => startEdit(null)}
            className="w-full rounded-xl border border-dashed border-gold-500/40 bg-gold-500/5 py-2.5 text-sm font-semibold text-gold-400 transition hover:bg-gold-500/10"
          >
            ＋ New plan
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder='Plan name — e.g. "Break & Retest (NY)"'
            className={inputCls}
            autoFocus={editingId === "new"}
          />
          <input
            type="text"
            value={planType}
            onChange={(e) => setPlanType(e.target.value)}
            placeholder="Plan type — e.g. Break & Retest, Double Top"
            className={inputCls}
          />
          <LinesField
            label="Charting process"
            hint={"Mark HTF levels on 4H\nWait for 15m structure\nLook for trigger on 5m"}
            value={charting}
            onChange={setCharting}
          />
          <LinesField
            label="Entry criteria (the AI's checklist)"
            hint={"Zone tested before\nConfirmation candle closed\nSession is London or NY"}
            value={entry}
            onChange={setEntry}
          />
          <div>
            <FieldLabel>Trade management rules</FieldLabel>
            <textarea
              value={mgmt}
              onChange={(e) => setMgmt(e.target.value)}
              rows={2}
              placeholder="e.g. BE only after structure confirms on 15m close — never from fear"
              className={`${inputCls} resize-none`}
            />
          </div>
          <LinesField
            label="Exit criteria"
            hint={"TP at next HTF level\nExit if zone breaks on 15m close"}
            value={exits}
            onChange={setExits}
          />
          <div>
            <FieldLabel>Notes — why this works, reminders under pressure</FieldLabel>
            <textarea
              value={planNotes}
              onChange={(e) => setPlanNotes(e.target.value)}
              rows={2}
              className={`${inputCls} resize-none`}
            />
          </div>
          <div>
            <FieldLabel>Entry-model screenshots (optional)</FieldLabel>
            <ScreenshotPicker ids={shots} onChange={setShots} />
          </div>
          {err && <p className="text-sm text-down">{err}</p>}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setEditingId(null)}
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
              {busy ? "Saving…" : "Save plan"}
            </button>
          </div>
          {editingId !== "new" && (
            <button
              type="button"
              onClick={() => void archive(editingId)}
              className="w-full rounded-xl border border-down/30 bg-down/5 py-2 text-xs font-semibold text-down transition hover:bg-down/10"
            >
              Archive plan
            </button>
          )}
        </div>
      )}
    </Sheet>
  );
}
