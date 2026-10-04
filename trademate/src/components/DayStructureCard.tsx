import { useEffect, useState } from "react";
import { Card } from "./Card";
import { IconPlus, IconSun, IconTrash, IconX } from "./Icons";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { tradingDate } from "../../shared/entryGate";
import { HABIT_KINDS, habitStreak, shiftDate, weekRate, type Habit, type HabitDay, type HabitKind } from "../../shared/habits";

/**
 * Day structure — the habits that give the day a shape, ticked per day.
 * The chart is not the only thing in the room; this card is the rest of the room.
 */
export function DayStructureCard() {
  const timezone = useApp((s) => s.profile?.timezone) ?? "Africa/Addis_Ababa";
  const today = tradingDate(timezone);
  const [habits, setHabits] = useState<Habit[]>([]);
  const [days, setDays] = useState<HabitDay[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{ label: string; kind: HabitKind; time_hint: string }>({ label: "", kind: "do", time_hint: "" });
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api<{ habits: Habit[]; days: HabitDay[] }>("/habits?days=14")
      .then((r) => {
        if (cancelled) return;
        setHabits(r.habits);
        setDays(r.days);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  const active = habits.filter((h) => h.archived === 0).sort((a, b) => a.sort - b.sort);
  const tickedToday = (id: string) => days.some((d) => d.habit_id === id && d.date === today && d.done === 1);
  const doneToday = active.filter((h) => tickedToday(h.id)).length;
  const week = weekRate(days, active, today);
  const last7 = Array.from({ length: 7 }, (_, i) => shiftDate(today, -(6 - i)));

  function toggle(habit: Habit) {
    const done = tickedToday(habit.id) ? 0 : 1;
    setDays((prev) => [...prev.filter((d) => !(d.habit_id === habit.id && d.date === today)), { date: today, habit_id: habit.id, done, updated_at: new Date().toISOString() }]);
    void api("/habits/days", { method: "PUT", body: JSON.stringify({ date: today, habit_id: habit.id, done }) }).catch(() => {});
  }

  async function addHabit() {
    const label = draft.label.trim();
    if (label.length < 2) { setError("Name the habit first."); return; }
    const habit = { id: `hab-${crypto.randomUUID().slice(0, 8)}`, label, kind: draft.kind, time_hint: draft.time_hint.trim() || null, sort: (active.at(-1)?.sort ?? 0) + 10 };
    try {
      const saved = await api<{ habit: Habit }>("/habits", { method: "PUT", body: JSON.stringify(habit) });
      setHabits((prev) => [...prev, saved.habit]);
      setDraft({ label: "", kind: "do", time_hint: "" });
      setError("");
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Could not save.");
    }
  }

  function archive(habit: Habit) {
    setHabits((prev) => prev.map((h) => (h.id === habit.id ? { ...h, archived: 1 } : h)));
    void api(`/habits/${habit.id}`, { method: "PATCH", body: JSON.stringify({ archived: 1 }) }).catch(() => {});
  }

  return (
    <Card
      title="Day structure"
      icon={<IconSun />}
      badge={active.length ? `${doneToday}/${active.length} today${week.pct !== null ? ` · week ${week.pct}%` : ""}` : "your day, your list"}
    >
      {!loaded ? (
        <p className="text-sm text-ink-300">Loading…</p>
      ) : (
        <>
          <p className="mb-3 text-[11px] leading-snug text-ink-400">
            A shaped day is what keeps you off the chart in the empty hours. Tick what you did; for the "avoid" lines the tick means you didn't.
          </p>
          <ul className="space-y-1.5">
            {active.map((h) => {
              const checked = tickedToday(h.id);
              const streak = habitStreak(days, h.id, today);
              return (
                <li key={h.id} className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => toggle(h)}
                    className={`flex min-w-0 flex-1 items-center gap-3 rounded-xl border px-3 py-2 text-left text-sm transition ${
                      checked ? "border-up/30 bg-up/5 text-ink-300" : "border-white/10 bg-ink-800 text-white hover:border-gold-500/40"
                    }`}
                  >
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold ${checked ? "border-up bg-up/20 text-up" : "border-ink-500 text-transparent"}`}>✓</span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${checked ? "line-through" : ""}`}>{h.label}</span>
                      <span className="flex items-center gap-2 text-[10px] text-ink-400">
                        {h.time_hint && <span>{h.time_hint}</span>}
                        <span className={h.kind === "avoid" ? "text-down/80" : "text-up/80"}>{h.kind === "avoid" ? "avoid" : "do"}</span>
                        {streak > 1 && <span className="text-gold-300">{streak}-day streak</span>}
                        <span className="ml-auto flex gap-0.5" aria-label="last seven days">
                          {last7.map((date) => {
                            const hit = days.some((d) => d.habit_id === h.id && d.date === date && d.done === 1);
                            return <span key={date} className={`h-1.5 w-1.5 rounded-full ${hit ? "bg-up" : date === today ? "bg-ink-500" : "bg-ink-700"}`} />;
                          })}
                        </span>
                      </span>
                    </span>
                  </button>
                  {editing && (
                    <button type="button" onClick={() => archive(h)} aria-label={`Remove ${h.label}`} className="rounded-lg border border-white/10 p-2 text-ink-400 hover:text-down">
                      <IconTrash className="h-4 w-4" />
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
          {editing && (
            <div className="mt-3 space-y-2 rounded-xl border border-gold-500/25 bg-gold-500/5 p-3">
              <input
                type="text"
                value={draft.label}
                maxLength={80}
                onChange={(e) => setDraft({ ...draft, label: e.target.value })}
                placeholder="New line — e.g. Read 20 pages"
                className="w-full rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
              />
              <div className="flex gap-2">
                <input
                  type="text"
                  value={draft.time_hint}
                  maxLength={24}
                  onChange={(e) => setDraft({ ...draft, time_hint: e.target.value })}
                  placeholder="when (optional)"
                  className="w-32 rounded-lg border border-white/10 bg-ink-800 px-3 py-2 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
                />
                {HABIT_KINDS.map((kind) => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setDraft({ ...draft, kind })}
                    className={`rounded-lg border px-3 py-2 text-xs font-semibold ${draft.kind === kind ? "border-gold-500 bg-gold-500/15 text-gold-300" : "border-white/10 bg-ink-800 text-ink-300"}`}
                  >
                    {kind === "do" ? "do" : "avoid"}
                  </button>
                ))}
                <button type="button" onClick={() => void addHabit()} className="ml-auto flex items-center gap-1 rounded-lg bg-gold-500 px-3 py-2 text-xs font-bold text-ink-950">
                  <IconPlus className="h-3.5 w-3.5" /> Add
                </button>
              </div>
              {error && <p className="text-xs text-down">{error}</p>}
            </div>
          )}
          <button
            type="button"
            onClick={() => { setEditing((v) => !v); setError(""); }}
            className="mt-2.5 flex w-full items-center justify-center gap-1 rounded-lg border border-white/10 bg-ink-800 py-1.5 text-[11px] font-semibold text-ink-300 transition hover:text-gold-400"
          >
            {editing ? <><IconX className="h-3.5 w-3.5" /> Done editing</> : "Edit the list ›"}
          </button>
        </>
      )}
    </Card>
  );
}
