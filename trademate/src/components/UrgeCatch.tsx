import { useMemo, useState } from "react";
import { PERMISSION_SENTENCES, URGE_DOMAINS, summarizeUrges, type UrgeDomain, type UrgeEntry } from "../../shared/urges";
import { useApp } from "../lib/store";
import { Card } from "./Card";
import { Chip, ChipRow, FieldLabel } from "./Chip";
import { IconHand } from "./Icons";
import { Sheet } from "./Sheet";

const URGE_LEVELS = [
  { v: 1, label: "Flicker" },
  { v: 2, label: "Itch" },
  { v: 3, label: "Pull" },
  { v: 4, label: "Strong" },
  { v: 5, label: "Can't sit" },
];

function timeLabel(iso: string): string {
  const d = new Date(iso);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return sameDay ? time : `${d.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })} ${time}`;
}

/** The one-tap capture: name the urge before it acts. Opens from the header on every screen. */
export function UrgeCatchSheet() {
  const open = useApp((s) => s.urgeSheetOpen);
  const setOpen = useApp((s) => s.setUrgeSheetOpen);
  const logUrge = useApp((s) => s.logUrge);
  const [domain, setDomain] = useState<UrgeDomain | null>(null);
  const [intensity, setIntensity] = useState<number | null>(null);
  const [sentence, setSentence] = useState("");
  const [feeling, setFeeling] = useState("");
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<"resisted" | "pending" | "acted" | null>(null);

  function reset() {
    setDomain(null); setIntensity(null); setSentence(""); setFeeling(""); setError(""); setSaved(null);
  }
  function close() { setOpen(false); reset(); }

  async function save(outcome: "resisted" | "pending" | "acted") {
    if (!domain || intensity === null) {
      setError("Two taps first: where, and how strong.");
      return;
    }
    const now = new Date().toISOString();
    await logUrge({
      id: crypto.randomUUID(), created_at: now, updated_at: now, domain, intensity,
      sentence: sentence.trim() || null, feeling: feeling.trim() || null, outcome, instead: null,
    });
    setSaved(outcome);
  }

  return (
    <Sheet open={open} onClose={close} title="Caught it">
      {saved ? (
        <div className="space-y-4">
          <p className="text-lg font-bold text-white">
            {saved === "resisted" ? "Logged. That's a rep won." : saved === "acted" ? "Logged. Honest counts." : "Logged. Now step away."}
          </p>
          <p className="text-sm leading-relaxed text-ink-300">
            {saved === "acted"
              ? "No drama. The habit gets weaker every time you write it down instead of hiding it. Next one, log it before the click."
              : "Stand up. Five minutes away from the screen. The urge peaks and passes — you only have to outlast the peak. Come back and mark how it went from the Today card."}
          </p>
          <button type="button" onClick={close} className="w-full rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400">
            Done
          </button>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="-mt-2 text-sm text-ink-300">Autopilot just knocked. Name it before it acts.</p>
          <div>
            <FieldLabel>Where</FieldLabel>
            <div className="grid grid-cols-3 gap-2">
              {URGE_DOMAINS.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => setDomain(d.id)}
                  className={`rounded-xl border py-3 text-sm font-bold transition ${
                    domain === d.id ? "border-gold-500 bg-gold-500/15 text-gold-300" : "border-white/10 bg-ink-800 text-ink-300 hover:border-gold-500/40"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>How strong</FieldLabel>
            <div className="grid grid-cols-5 gap-1.5">
              {URGE_LEVELS.map((l) => (
                <button
                  key={l.v}
                  type="button"
                  onClick={() => setIntensity(l.v)}
                  className={`flex flex-col items-center gap-0.5 rounded-xl border py-2 transition ${
                    intensity === l.v ? "border-gold-500 bg-gold-500/15" : "border-white/10 bg-ink-800 hover:border-gold-500/40"
                  }`}
                >
                  <span className={`text-lg font-bold ${intensity === l.v ? "text-gold-300" : "text-white"}`}>{l.v}</span>
                  <span className="text-[9px] font-semibold text-ink-400">{l.label}</span>
                </button>
              ))}
            </div>
          </div>
          <div>
            <FieldLabel>What did your brain say?</FieldLabel>
            <ChipRow>
              {PERMISSION_SENTENCES.map((s) => (
                <Chip key={s} active={sentence === s} onClick={() => setSentence(sentence === s ? "" : s)}>
                  {s}
                </Chip>
              ))}
            </ChipRow>
            <input
              type="text"
              value={sentence}
              onChange={(e) => setSentence(e.target.value)}
              placeholder="…or type the exact sentence"
              className="mt-2 w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
            />
          </div>
          <div>
            <FieldLabel>What's going on in you right now</FieldLabel>
            <textarea
              value={feeling}
              onChange={(e) => setFeeling(e.target.value)}
              rows={2}
              placeholder='optional — "bored, want the hit", "down $100 and want it back", "they killed me twice"'
              className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
            />
          </div>
          {error && <p role="alert" className="text-sm text-down">{error}</p>}
          <div className="grid gap-2">
            <button type="button" onClick={() => void save("resisted")} className="rounded-xl bg-up py-3 font-bold text-ink-950 transition hover:brightness-110">
              I walked away
            </button>
            <button type="button" onClick={() => void save("pending")} className="rounded-xl border border-gold-500/50 bg-gold-500/10 py-3 font-bold text-gold-300 transition hover:bg-gold-500/20">
              Still deciding — log it and step away
            </button>
            <button type="button" onClick={() => void save("acted")} className="rounded-xl border border-white/10 bg-ink-800 py-2.5 text-sm font-semibold text-ink-300 transition hover:text-down">
              I already acted — log it honestly
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}

export function UrgeCatchButton({ compact = false }: { compact?: boolean }) {
  const setOpen = useApp((s) => s.setUrgeSheetOpen);
  return (
    <button
      type="button"
      onClick={() => setOpen(true)}
      aria-label="Caught it — log an urge"
      className={`flex items-center gap-1.5 rounded-full bg-gold-500 font-bold text-ink-950 shadow-[0_0_18px_rgb(139_92_246/0.35)] transition hover:bg-gold-400 ${
        compact ? "p-2" : "px-3 py-2 text-xs"
      }`}
    >
      <IconHand className="h-4 w-4" />
      {!compact && <span>Caught it</span>}
    </button>
  );
}

function outcomeTone(outcome: UrgeEntry["outcome"]): string {
  return outcome === "resisted" ? "text-up" : outcome === "acted" ? "text-down" : "text-gold-300";
}

export function UrgeLogCard() {
  const urges = useApp((s) => s.urges);
  const setOutcome = useApp((s) => s.setUrgeOutcome);
  const setOpen = useApp((s) => s.setUrgeSheetOpen);
  const week = useMemo(() => {
    const since = Date.now() - 7 * 86_400_000;
    return urges.filter((u) => Date.parse(u.created_at) >= since);
  }, [urges]);
  const s = useMemo(() => summarizeUrges(week), [week]);
  const recent = urges.slice(0, 4);

  return (
    <Card title="Autopilot catches" icon={<IconHand />} badge="this week">
      {week.length === 0 ? (
        <p className="text-sm leading-relaxed text-ink-300">
          Nothing logged yet this week. The next time your brain says "one loss won't take me anywhere"
          — in gold, in Siege, anywhere — hit <span className="font-semibold text-gold-400">Caught it</span> before you act.
        </p>
      ) : (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-ink-800/70 p-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-400">Walked away</p>
            <p className="text-xl font-bold text-up">{s.resisted}</p>
          </div>
          <div className="rounded-xl bg-ink-800/70 p-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-400">Acted</p>
            <p className="text-xl font-bold text-down">{s.acted}</p>
          </div>
          <div className="rounded-xl bg-ink-800/70 p-3">
            <p className="text-[10px] uppercase tracking-wider text-ink-400">Catch rate</p>
            <p className="text-xl font-bold text-white">{s.catchRate === null ? "—" : `${s.catchRate}%`}</p>
          </div>
        </div>
      )}
      {s.topSentence && (
        <p className="mt-2.5 text-xs text-ink-300">
          Most used line: <span className="font-semibold text-gold-300">"{s.topSentence.text}"</span> · {s.topSentence.count}×
        </p>
      )}
      {recent.length > 0 && (
        <ul className="mt-3 space-y-2">
          {recent.map((u) => (
            <li key={u.id} className="rounded-xl border border-white/5 bg-ink-800/60 px-3 py-2">
              <div className="flex items-center justify-between gap-2 text-xs">
                <span className="text-ink-400">
                  {timeLabel(u.created_at)} · {URGE_DOMAINS.find((d) => d.id === u.domain)?.label} · urge {u.intensity}/5
                </span>
                <span className={`font-bold uppercase ${outcomeTone(u.outcome)}`}>
                  {u.outcome === "resisted" ? "walked away" : u.outcome === "acted" ? "acted" : "open"}
                </span>
              </div>
              {(u.sentence || u.feeling) && (
                <p className="mt-1 text-xs text-ink-200">
                  {u.sentence && <span className="italic">"{u.sentence}"</span>}
                  {u.sentence && u.feeling && " — "}
                  {u.feeling}
                </p>
              )}
              {u.outcome === "pending" && (
                <div className="mt-2 flex gap-2">
                  <button type="button" onClick={() => void setOutcome(u.id, "resisted")} className="rounded-lg bg-up/15 px-2.5 py-1 text-[11px] font-bold text-up">
                    Walked away
                  </button>
                  <button type="button" onClick={() => void setOutcome(u.id, "acted")} className="rounded-lg bg-down/15 px-2.5 py-1 text-[11px] font-bold text-down">
                    Acted
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border border-gold-500/40 bg-gold-500/10 py-2.5 text-sm font-bold text-gold-300 transition hover:bg-gold-500/20"
      >
        <IconHand className="h-4 w-4" /> Caught it
      </button>
    </Card>
  );
}
