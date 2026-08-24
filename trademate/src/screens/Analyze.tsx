import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { Chip, ChipRow, FieldLabel } from "../components/Chip";
import { IconCrosshair, IconTrendDown, IconTrendUp } from "../components/Icons";
import { PlansSheet, type Plan } from "../components/PlansSheet";
import { ScreenshotPicker } from "../components/ScreenshotPicker";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { SETUPS, TIMEFRAMES } from "../lib/trades";

interface ChecklistItem {
  item: string;
  pass: boolean;
  note: string;
}

interface Analysis {
  grade: "A" | "B" | "C";
  headline: string;
  checklist: ChecklistItem[];
  likes: string[];
  concerns: string[];
  alternative: string | null;
  verdict: string;
}

const GRADE_STYLE: Record<string, string> = {
  A: "bg-up/15 text-up border-up/50",
  B: "bg-gold-500/15 text-gold-300 border-gold-500/50",
  C: "bg-down/15 text-down border-down/50",
};

export function Analyze() {
  const setTab = useApp((s) => s.setTab);
  const setLogFormOpen = useApp((s) => s.setLogFormOpen);
  const setPrefill = useApp((s) => s.setPrefill);

  const [images, setImages] = useState<string[]>([]);
  const [direction, setDirection] = useState<"long" | "short" | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [customSetup, setCustomSetup] = useState("");
  const [timeframe, setTimeframe] = useState<string | null>(null);
  const [entry, setEntry] = useState("");
  const [sl, setSl] = useState("");
  const [tp, setTp] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ id: string; analysis: Analysis } | null>(null);
  const [decision, setDecision] = useState<"taken" | "skipped" | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planId, setPlanId] = useState<string | null>(null);
  const [plansOpen, setPlansOpen] = useState(false);

  function loadPlans() {
    api<{ plans: Plan[] }>("/plans")
      .then((r) => setPlans(r.plans))
      .catch(() => {});
  }
  useEffect(() => {
    loadPlans();
  }, []);

  const finalSetup = setup === "other" && customSetup.trim() ? customSetup.trim() : setup;

  async function analyze() {
    if (busy) return;
    if (images.length === 0 && !notes.trim()) {
      setError("Add a chart screenshot (or at least describe the idea).");
      return;
    }
    setError("");
    setBusy(true);
    setResult(null);
    setDecision(null);
    try {
      const r = await api<{ id: string; analysis: Analysis }>("/analyze", {
        method: "POST",
        body: JSON.stringify({
          images,
          direction,
          setup_type: finalSetup,
          timeframe,
          entry: entry.trim() || undefined,
          sl: sl.trim() || undefined,
          tp: tp.trim() || undefined,
          notes: notes.trim() || undefined,
          plan_id: planId ?? undefined,
        }),
      });
      setResult(r);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Analysis failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  function takeIt() {
    if (!result) return;
    setDecision("taken");
    void api(`/setups/${result.id}`, {
      method: "PATCH",
      body: JSON.stringify({ decision: "taken" }),
    }).catch(() => {});
    setPrefill({
      direction: direction ?? undefined,
      setup_type: finalSetup ?? undefined,
      timeframe: timeframe ?? undefined,
      screenshots: images,
      notes: notes.trim() || undefined,
      plan_id: planId ?? undefined,
    });
    setTab("journal");
    setLogFormOpen(true);
  }

  function skipIt() {
    if (!result) return;
    setDecision("skipped");
    void api(`/setups/${result.id}`, {
      method: "PATCH",
      body: JSON.stringify({ decision: "skipped" }),
    }).catch(() => {});
  }

  return (
    <div className="space-y-4">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-white">Analyze</h1>
        <p className="mt-1 text-sm text-ink-300">
          Show Mate the chart before you click buy or sell.
        </p>
      </div>

      <div className="rounded-2xl border border-white/5 bg-ink-900/90 p-4 shadow-[var(--card-shadow)]">
        <div className="mb-2 flex items-center justify-between">
          <FieldLabel>Trade plan — grading rubric</FieldLabel>
          <button
            type="button"
            onClick={() => setPlansOpen(true)}
            className="text-[11px] font-bold text-gold-500 hover:text-gold-400"
          >
            Manage playbook ›
          </button>
        </div>
        <ChipRow>
          <Chip active={planId === null} onClick={() => setPlanId(null)}>
            No plan
          </Chip>
          {plans.map((p) => (
            <Chip key={p.id} active={planId === p.id} onClick={() => setPlanId(p.id)}>
              {p.name}
            </Chip>
          ))}
        </ChipRow>
        {planId !== null && (
          <p className="mt-2 text-[11px] text-ink-400">
            Mate will grade this setup against the plan's entry criteria — a good trade outside
            the plan is still a broken plan.
          </p>
        )}
      </div>
      <PlansSheet
        open={plansOpen}
        onClose={() => setPlansOpen(false)}
        plans={plans}
        onChanged={loadPlans}
      />

      <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
      <Card title="Your setup" icon={<IconCrosshair />}>
        <div className="space-y-4">
          <div>
            <FieldLabel>Chart screenshots (HTF + entry TF work best)</FieldLabel>
            <ScreenshotPicker ids={images} onChange={setImages} />
          </div>

          <div>
            <FieldLabel>Direction</FieldLabel>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setDirection(direction === "long" ? null : "long")}
                className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 font-bold transition ${
                  direction === "long"
                    ? "border-up/60 bg-up/15 text-up"
                    : "border-white/10 bg-ink-800 text-ink-300"
                }`}
              >
                <IconTrendUp className="h-4.5 w-4.5" /> LONG
              </button>
              <button
                type="button"
                onClick={() => setDirection(direction === "short" ? null : "short")}
                className={`flex items-center justify-center gap-2 rounded-xl border py-2.5 font-bold transition ${
                  direction === "short"
                    ? "border-down/60 bg-down/15 text-down"
                    : "border-white/10 bg-ink-800 text-ink-300"
                }`}
              >
                <IconTrendDown className="h-4.5 w-4.5" /> SHORT
              </button>
            </div>
          </div>

          <div>
            <FieldLabel>Setup</FieldLabel>
            <ChipRow>
              {SETUPS.map((s) => (
                <Chip key={s.id} active={setup === s.id} onClick={() => setSetup(setup === s.id ? null : s.id)}>
                  {s.label}
                </Chip>
              ))}
            </ChipRow>
            {setup === "other" && (
              <input
                type="text"
                value={customSetup}
                onChange={(e) => setCustomSetup(e.target.value)}
                placeholder="Name your setup"
                className="mt-2 w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
              />
            )}
          </div>

          <div>
            <FieldLabel>Timeframe</FieldLabel>
            <ChipRow>
              {TIMEFRAMES.map((tf) => (
                <Chip key={tf} active={timeframe === tf} onClick={() => setTimeframe(timeframe === tf ? null : tf)}>
                  {tf}
                </Chip>
              ))}
            </ChipRow>
          </div>

          <div className="grid grid-cols-3 gap-2">
            {(
              [
                ["Entry", entry, setEntry],
                ["SL", sl, setSl],
                ["TP", tp, setTp],
              ] as const
            ).map(([label, val, setter]) => (
              <input
                key={label}
                type="text"
                inputMode="decimal"
                value={val}
                onChange={(e) => setter(e.target.value)}
                placeholder={label}
                className="w-full rounded-xl border border-white/10 bg-ink-800 px-3 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
              />
            ))}
          </div>

          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            placeholder="Your idea in your own words (optional)"
            className="w-full resize-none rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />

          {error && <p className="text-sm text-down">{error}</p>}

          <button
            type="button"
            onClick={() => void analyze()}
            disabled={busy}
            className="w-full rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400 disabled:opacity-50"
          >
            {busy ? "Mate is reading your chart…" : "Ask Mate"}
          </button>
        </div>
      </Card>

      {result && (
        <Card title="Mate's verdict" icon={<IconCrosshair />} badge={`grade ${result.analysis.grade}`}>
          <div className="flex items-start gap-3">
            <span
              className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border-2 text-2xl font-black ${
                GRADE_STYLE[result.analysis.grade] ?? GRADE_STYLE.B
              }`}
            >
              {result.analysis.grade}
            </span>
            <p className="text-sm font-semibold leading-relaxed text-white">
              {result.analysis.headline}
            </p>
          </div>

          <ul className="mt-4 space-y-1.5">
            {result.analysis.checklist?.map((c) => (
              <li key={c.item} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 font-bold ${c.pass ? "text-up" : "text-down"}`}>
                  {c.pass ? "✓" : "✗"}
                </span>
                <span className="text-ink-200">
                  {c.item}
                  {c.note && <span className="text-ink-400"> — {c.note}</span>}
                </span>
              </li>
            ))}
          </ul>

          {result.analysis.likes?.length > 0 && (
            <div className="mt-4">
              <FieldLabel>What I like</FieldLabel>
              <ul className="space-y-1 text-sm text-ink-200">
                {result.analysis.likes.map((l) => (
                  <li key={l} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-up" />
                    {l}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.analysis.concerns?.length > 0 && (
            <div className="mt-3">
              <FieldLabel>What worries me</FieldLabel>
              <ul className="space-y-1 text-sm text-ink-200">
                {result.analysis.concerns.map((c) => (
                  <li key={c} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-down" />
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {result.analysis.alternative && (
            <div className="mt-3 rounded-xl border border-gold-500/20 bg-gold-500/5 p-3">
              <FieldLabel>Better idea on this chart</FieldLabel>
              <p className="text-sm leading-relaxed text-ink-200">{result.analysis.alternative}</p>
            </div>
          )}

          <p className="mt-4 border-l-2 border-gold-500/50 pl-3 text-sm italic leading-relaxed text-gold-100">
            {result.analysis.verdict}
          </p>

          {decision === null ? (
            <div className="mt-4 grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={takeIt}
                className="rounded-xl bg-gold-500 py-3 font-semibold text-ink-950 transition hover:bg-gold-400"
              >
                I'm taking it
              </button>
              <button
                type="button"
                onClick={skipIt}
                className="rounded-xl border border-white/10 bg-ink-800 py-3 font-semibold text-ink-200 transition hover:text-white"
              >
                Skipping it
              </button>
            </div>
          ) : decision === "skipped" ? (
            <p className="mt-4 rounded-xl border border-up/30 bg-up/10 p-3 text-center text-sm font-semibold text-up">
              Logged the skip. Saying no to a mediocre setup IS trading well.
            </p>
          ) : (
            <p className="mt-4 rounded-xl border border-gold-500/30 bg-gold-500/10 p-3 text-center text-sm font-semibold text-gold-300">
              Journal entry pre-filled — manage it well.
            </p>
          )}
        </Card>
      )}
      </div>
    </div>
  );
}
