import { useEffect, useState } from "react";
import { Card } from "../components/Card";
import { Chip, ChipRow, FieldLabel } from "../components/Chip";
import { IconCandles, IconX } from "../components/Icons";
import { api } from "../lib/api";
import { TIMEFRAMES } from "../lib/trades";

interface Zone {
  id: string;
  kind: "support" | "resistance";
  price_low: number;
  price_high: number;
  timeframe: string | null;
  note: string | null;
}

export function Chart() {
  const tvTheme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const [zones, setZones] = useState<Zone[]>([]);
  const [kind, setKind] = useState<"support" | "resistance">("support");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [tf, setTf] = useState<string | null>("H1");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function load() {
    try {
      const r = await api<{ zones: Zone[] }>("/zones");
      setZones(r.zones);
    } catch {
      // offline
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function addZone() {
    const lo = Number.parseFloat(low);
    const hi = high.trim() === "" ? lo : Number.parseFloat(high);
    if (Number.isNaN(lo)) {
      setError("Enter at least one price.");
      return;
    }
    setError("");
    try {
      await api("/zones", {
        method: "POST",
        body: JSON.stringify({
          kind,
          price_low: lo,
          price_high: Number.isNaN(hi) ? lo : hi,
          timeframe: tf ?? undefined,
          note: note.trim() || undefined,
        }),
      });
      setLow("");
      setHigh("");
      setNote("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save.");
    }
  }

  async function removeZone(id: string) {
    setZones((z) => z.filter((x) => x.id !== id));
    try {
      await api(`/zones/${id}`, { method: "DELETE" });
    } catch {
      void load();
    }
  }

  const src =
    `https://s.tradingview.com/widgetembed/?symbol=${encodeURIComponent("OANDA:XAUUSD")}` +
    `&interval=15&theme=${tvTheme}&style=1&locale=en&timezone=${encodeURIComponent("Africa/Addis_Ababa")}` +
    `&hidesidetoolbar=0&allow_symbol_change=1&withdateranges=1&hide_top_toolbar=0`;

  return (
    <div className="space-y-4">
      <div className="px-1">
        <h1 className="text-2xl font-bold text-white">Chart</h1>
        <p className="mt-1 text-sm text-ink-300">
          Live XAUUSD. Save your zones below — Mate uses them in briefings and setup reviews.
        </p>
      </div>

      <iframe
        key={tvTheme}
        title="TradingView XAUUSD chart"
        src={src}
        className="h-[62dvh] w-full rounded-2xl border border-white/5 bg-ink-900"
        allowFullScreen
      />

      <Card title="Your zones" icon={<IconCandles />} badge={`${zones.length} saved`}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <Chip active={kind === "support"} onClick={() => setKind("support")}>
              Support
            </Chip>
            <Chip active={kind === "resistance"} onClick={() => setKind("resistance")}>
              Resistance
            </Chip>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              inputMode="decimal"
              value={low}
              onChange={(e) => setLow(e.target.value)}
              placeholder="Zone low (e.g. 3990)"
              className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
            />
            <input
              type="text"
              inputMode="decimal"
              value={high}
              onChange={(e) => setHigh(e.target.value)}
              placeholder="Zone high (optional)"
              className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
            />
          </div>
          <div>
            <FieldLabel>Timeframe</FieldLabel>
            <ChipRow>
              {TIMEFRAMES.map((t) => (
                <Chip key={t} active={tf === t} onClick={() => setTf(tf === t ? null : t)}>
                  {t}
                </Chip>
              ))}
            </ChipRow>
          </div>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Note (e.g. 3rd touch, strong H4 demand)"
            className="w-full rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          {error && <p className="text-sm text-down">{error}</p>}
          <button
            type="button"
            onClick={() => void addZone()}
            className="w-full rounded-xl bg-gold-500 py-2.5 font-semibold text-ink-950 transition hover:bg-gold-400"
          >
            Save zone
          </button>
        </div>

        {zones.length > 0 && (
          <ul className="mt-4 space-y-2">
            {zones.map((z) => (
              <li
                key={z.id}
                className={`flex items-center gap-3 rounded-xl border px-3.5 py-2.5 ${
                  z.kind === "support"
                    ? "border-up/25 bg-up/5"
                    : "border-down/25 bg-down/5"
                }`}
              >
                <span
                  className={`text-[10px] font-bold uppercase tracking-wider ${
                    z.kind === "support" ? "text-up" : "text-down"
                  }`}
                >
                  {z.kind === "support" ? "SUP" : "RES"}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-white">
                    {z.price_low === z.price_high
                      ? z.price_low
                      : `${z.price_low} – ${z.price_high}`}
                    {z.timeframe && (
                      <span className="ml-1.5 text-xs font-normal text-ink-400">
                        {z.timeframe}
                      </span>
                    )}
                  </p>
                  {z.note && <p className="truncate text-xs text-ink-400">{z.note}</p>}
                </div>
                <button
                  type="button"
                  onClick={() => void removeZone(z.id)}
                  aria-label="Delete zone"
                  className="rounded-full border border-white/10 bg-ink-800 p-1.5 text-ink-400 transition hover:text-down"
                >
                  <IconX className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
