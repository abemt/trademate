/**
 * Day structure: the habits that give the day a shape, ticked per day.
 * "do" habits are done; "avoid" habits are kept (the tick means "I didn't").
 */
export const HABIT_KINDS = ["do", "avoid"] as const;
export type HabitKind = (typeof HABIT_KINDS)[number];

export interface Habit {
  id: string;
  label: string;
  kind: HabitKind;
  time_hint: string | null;
  sort: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export interface HabitDay {
  date: string;
  habit_id: string;
  done: number;
  updated_at: string;
}

export interface HabitInput {
  id: string;
  label: string;
  kind: HabitKind;
  time_hint: string | null;
  sort: number;
}

export function validateHabit(input: unknown): HabitInput {
  if (!input || typeof input !== "object") throw new Error("Nothing to save.");
  const value = input as Record<string, unknown>;
  if (typeof value.id !== "string" || !/^[\w-]{1,64}$/.test(value.id)) throw new Error("Bad habit id.");
  if (typeof value.label !== "string" || value.label.trim().length < 2 || value.label.trim().length > 80) throw new Error("Name the habit in 2–80 characters.");
  if (!HABIT_KINDS.includes(value.kind as HabitKind)) throw new Error("A habit is something you do or something you avoid.");
  const hint = typeof value.time_hint === "string" ? value.time_hint.trim().slice(0, 24) : "";
  const sort = typeof value.sort === "number" && Number.isInteger(value.sort) ? Math.max(0, Math.min(999, value.sort)) : 0;
  return { id: value.id, label: value.label.trim(), kind: value.kind as HabitKind, time_hint: hint || null, sort };
}

export function isDateKey(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/** YYYY-MM-DD shifted by `delta` days (UTC arithmetic on a date-only key is safe). */
export function shiftDate(date: string, delta: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Consecutive ticked days ending today — or ending yesterday when today is still open. */
export function habitStreak(days: readonly HabitDay[], habitId: string, today: string): number {
  const ticked = new Set(days.filter((d) => d.habit_id === habitId && d.done === 1).map((d) => d.date));
  let cursor = ticked.has(today) ? today : shiftDate(today, -1);
  let streak = 0;
  while (ticked.has(cursor)) {
    streak++;
    cursor = shiftDate(cursor, -1);
  }
  return streak;
}

/** Ticks over the last 7 days against everything that could have been ticked. */
export function weekRate(days: readonly HabitDay[], habits: readonly Pick<Habit, "id" | "archived">[], today: string): { done: number; possible: number; pct: number | null } {
  const active = habits.filter((h) => h.archived === 0).map((h) => h.id);
  const window = new Set(Array.from({ length: 7 }, (_, i) => shiftDate(today, -i)));
  const done = days.filter((d) => d.done === 1 && window.has(d.date) && active.includes(d.habit_id)).length;
  const possible = active.length * 7;
  return { done, possible, pct: possible ? Math.round((done / possible) * 100) : null };
}

/** One line per habit for the coach context: today, 7-day count, streak. */
export function habitLines(habits: readonly Habit[], days: readonly HabitDay[], today: string): string {
  const active = habits.filter((h) => h.archived === 0).sort((a, b) => a.sort - b.sort);
  if (!active.length) return "Day structure: no habits set up.";
  const rate = weekRate(days, active, today);
  const window = new Set(Array.from({ length: 7 }, (_, i) => shiftDate(today, -i)));
  const rows = active.map((h) => {
    const todayTick = days.some((d) => d.habit_id === h.id && d.date === today && d.done === 1);
    const week = days.filter((d) => d.habit_id === h.id && d.done === 1 && window.has(d.date)).length;
    const verb = h.kind === "avoid" ? "kept" : "done";
    return `- ${h.label}${h.time_hint ? ` (${h.time_hint})` : ""}: today ${todayTick ? verb.toUpperCase() : "not yet"} · ${week}/7 this week · streak ${habitStreak(days, h.id, today)}`;
  });
  return `Day structure (habits he set for himself; a shaped day is what keeps him away from the chart): ${rate.done}/${rate.possible} ticks in the last 7 days${rate.pct !== null ? ` (${rate.pct}%)` : ""}.\n${rows.join("\n")}`;
}
