import { useMemo, useState } from "react";
import { IconPlus, IconTrash, IconTrendDown, IconTrendUp } from "../components/Icons";
import { NotebookSheet } from "../components/NotebookSheet";
import { TradeForm } from "../components/TradeForm";
import { screenshotUrl } from "../lib/images";
import { useApp } from "../lib/store";
import {
  EMOTIONS,
  SETUPS,
  TRADE_SESSIONS,
  TRIGGERS,
  accountTrades,
  fmtR,
  fmtUsd,
  localDateKey,
  optionLabel,
  type Trade,
} from "../lib/trades";

function dayLabel(key: string): string {
  const today = localDateKey(new Date().toISOString());
  const yesterday = localDateKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function PnlBadge({ t }: { t: Trade }) {
  if (t.status === "open") {
    return (
      <span className="flex items-center gap-1.5 rounded-full border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-gold-300">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-gold-400" />
        open
      </span>
    );
  }
  const pnl = t.pnl_usd ?? 0;
  const color = pnl > 0 ? "text-up" : pnl < 0 ? "text-down" : "text-ink-300";
  return (
    <div className="text-right">
      <p className={`text-sm font-bold ${color}`}>
        {t.r_multiple !== null ? fmtR(t.r_multiple) : fmtUsd(pnl)}
      </p>
      {t.r_multiple !== null && <p className={`text-[11px] ${color}`}>{fmtUsd(pnl)}</p>}
    </div>
  );
}

function TradeRow({
  t,
  expanded,
  onToggle,
  onEdit,
  onCloseTrade,
  onView,
}: {
  t: Trade;
  expanded: boolean;
  onToggle: () => void;
  onEdit: () => void;
  onCloseTrade: () => void;
  onView: (id: string) => void;
}) {
  const deleteTrade = useApp((s) => s.deleteTrade);
  const [armed, setArmed] = useState(false);
  const long = t.direction === "long";
  const time = new Date(t.opened_at).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
  const meta = [
    t.timeframe,
    optionLabel(TRADE_SESSIONS, t.session),
    time,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <li className="overflow-hidden rounded-2xl border border-white/5 bg-ink-900/90">
      <button type="button" onClick={onToggle} className="flex w-full items-center gap-3 p-3.5 text-left">
        <span
          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
            long ? "bg-up/10 text-up" : "bg-down/10 text-down"
          }`}
        >
          {long ? <IconTrendUp className="h-5 w-5" /> : <IconTrendDown className="h-5 w-5" />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-white">
            {optionLabel(SETUPS, t.setup_type) ?? t.setup_type ?? "Trade"}
            {t.entry_trigger && t.entry_trigger !== "none" && (
              <span className="text-ink-300"> · {optionLabel(TRIGGERS, t.entry_trigger)}</span>
            )}
          </span>
          <span className="block text-xs text-ink-400">{meta}</span>
        </span>
        <PnlBadge t={t} />
      </button>

      {expanded && (
        <div className="border-t border-white/5 px-4 py-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-300">
            {t.lots !== null && (
              <span>
                {t.lots.toFixed(2)} lots · ${t.risk_usd?.toFixed(0)} risk ({t.risk_pct}%)
              </span>
            )}
            {t.sl_pips !== null && <span>SL {t.sl_pips} pips</span>}
            {t.entry_price !== null && <span>entry {t.entry_price}</span>}
            {t.followed_plan !== null && (
              <span className={t.followed_plan ? "text-up" : "text-down"}>
                {t.followed_plan ? "followed plan" : "broke plan"}
              </span>
            )}
          </div>
          {t.emotions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.emotions.map((e) => (
                <span
                  key={e}
                  className="rounded-full border border-white/10 bg-ink-800 px-2 py-0.5 text-[10px] font-medium text-ink-300"
                >
                  {optionLabel(EMOTIONS, e) ?? e}
                </span>
              ))}
            </div>
          )}
          {t.screenshots.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {t.screenshots.map((id) => (
                <button key={id} type="button" onClick={() => onView(id)}>
                  <img
                    src={screenshotUrl(id)}
                    alt="chart screenshot"
                    className="h-16 w-24 rounded-lg border border-white/10 object-cover transition hover:border-gold-500/50"
                  />
                </button>
              ))}
            </div>
          )}
          {t.notes && <p className="mt-2 text-sm leading-relaxed text-ink-200">{t.notes}</p>}
          <div className="mt-3 flex gap-2">
            {t.status === "open" && (
              <button
                type="button"
                onClick={onCloseTrade}
                className="rounded-lg bg-gold-500 px-3.5 py-2 text-xs font-bold text-ink-950 transition hover:bg-gold-400"
              >
                Close trade
              </button>
            )}
            <button
              type="button"
              onClick={onEdit}
              className="rounded-lg border border-white/10 bg-ink-800 px-3.5 py-2 text-xs font-semibold text-ink-200 transition hover:text-white"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={() => (armed ? void deleteTrade(t.id) : setArmed(true))}
              className={`ml-auto flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-xs font-semibold transition ${
                armed
                  ? "border-down/60 bg-down/15 text-down"
                  : "border-white/10 bg-ink-800 text-ink-400 hover:text-down"
              }`}
            >
              <IconTrash className="h-3.5 w-3.5" />
              {armed ? "Sure?" : "Delete"}
            </button>
          </div>
        </div>
      )}
    </li>
  );
}

export function Journal() {
  const allTrades = useApp((s) => s.trades);
  const accounts = useApp((s) => s.accounts);
  const active = accounts.find((a) => a.active === 1 && a.archived === 0) ?? null;
  const trades = useMemo(
    () => accountTrades(allTrades, active?.id ?? null),
    [allTrades, active?.id],
  );
  const maxPerDay = useApp((s) => s.profile?.max_trades_per_day) ?? 2;
  const logFormOpen = useApp((s) => s.logFormOpen);
  const setLogFormOpen = useApp((s) => s.setLogFormOpen);
  const prefill = useApp((s) => s.prefill);
  const setPrefill = useApp((s) => s.setPrefill);
  const [editing, setEditing] = useState<Trade | null>(null);
  const [closeMode, setCloseMode] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [viewer, setViewer] = useState<string | null>(null);
  const [notebookOpen, setNotebookOpen] = useState(false);

  const groups = useMemo(() => {
    const map = new Map<string, Trade[]>();
    for (const t of trades) {
      const k = localDateKey(t.opened_at);
      const list = map.get(k);
      if (list) list.push(t);
      else map.set(k, [t]);
    }
    return [...map.entries()];
  }, [trades]);

  function openForm(trade: Trade | null, close = false) {
    setEditing(trade);
    setCloseMode(close);
    setLogFormOpen(true);
  }

  function closeForm() {
    setLogFormOpen(false);
    setEditing(null);
    setCloseMode(false);
    setPrefill(null);
  }

  return (
    <div className="mx-auto space-y-5 lg:max-w-3xl">
      <div className="flex items-center justify-between px-1">
        <div>
          <h1 className="text-2xl font-bold text-white">Journal</h1>
          <p className="mt-1 text-sm text-ink-300">Log it in 20 seconds. Patterns beat shame.</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNotebookOpen(true)}
            className="rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm font-bold text-ink-300 transition hover:text-gold-400"
          >
            Notebook
          </button>
          <button
            type="button"
            onClick={() => openForm(null)}
            className="flex items-center gap-1.5 rounded-xl bg-gold-500 px-3.5 py-2.5 text-sm font-bold text-ink-950 transition hover:bg-gold-400"
          >
            <IconPlus className="h-4 w-4" /> Log trade
          </button>
        </div>
      </div>

      <NotebookSheet open={notebookOpen} onClose={() => setNotebookOpen(false)} trades={trades} />

      {trades.length === 0 && (
        <div className="rounded-2xl border border-dashed border-white/10 bg-ink-900/60 p-8 text-center">
          <p className="text-sm leading-relaxed text-ink-300">
            No trades yet. When you take one — win, lose, or even a setup you skipped and
            regret — log it here. That data becomes Mate's coaching material.
          </p>
        </div>
      )}

      {groups.map(([day, list]) => {
        const closed = list.filter((t) => t.status === "closed" && t.pnl_usd !== null);
        const dayPnl = closed.reduce((s, t) => s + t.pnl_usd!, 0);
        const over = list.length > maxPerDay;
        return (
          <section key={day}>
            <header className="mb-2 flex items-baseline justify-between px-1">
              <p className="flex items-center gap-2 text-sm font-semibold text-white">
                {dayLabel(day)}
                <span className="text-xs font-normal text-ink-400">
                  {list.length} trade{list.length === 1 ? "" : "s"}
                </span>
                {over && (
                  <span className="rounded-full border border-down/40 bg-down/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-down">
                    over your rule
                  </span>
                )}
              </p>
              {closed.length > 0 && (
                <p
                  className={`text-sm font-bold ${
                    dayPnl > 0 ? "text-up" : dayPnl < 0 ? "text-down" : "text-ink-300"
                  }`}
                >
                  {fmtUsd(dayPnl)}
                </p>
              )}
            </header>
            <ul className="space-y-2">
              {list.map((t) => (
                <TradeRow
                  key={t.id}
                  t={t}
                  expanded={expandedId === t.id}
                  onToggle={() => setExpandedId(expandedId === t.id ? null : t.id)}
                  onEdit={() => openForm(t)}
                  onCloseTrade={() => openForm(t, true)}
                  onView={setViewer}
                />
              ))}
            </ul>
          </section>
        );
      })}

      {viewer && (
        <button
          type="button"
          onClick={() => setViewer(null)}
          className="fixed inset-0 z-50 flex cursor-zoom-out items-center justify-center bg-black/90 p-4"
        >
          <img
            src={screenshotUrl(viewer)}
            alt="chart screenshot"
            className="max-h-[90dvh] max-w-full rounded-xl object-contain"
          />
        </button>
      )}

      <TradeForm
        open={logFormOpen}
        onClose={closeForm}
        existing={editing}
        prefill={prefill}
        closeMode={closeMode}
      />
    </div>
  );
}
