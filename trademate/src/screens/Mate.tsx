import { useEffect, useMemo, useRef, useState } from "react";
import { IconClock } from "../components/Icons";
import { Sheet } from "../components/Sheet";
import { api } from "../lib/api";
import { useApp } from "../lib/store";
import { localDateKey } from "../lib/trades";

interface ChatMsg {
  id: number;
  role: "user" | "assistant";
  content: string;
  created_at?: string;
}

/** D1 stores "YYYY-MM-DD HH:MM:SS" (UTC); optimistic messages use ISO. */
function msgDay(m: ChatMsg): string {
  if (!m.created_at) return localDateKey(new Date().toISOString());
  const iso = m.created_at.includes("T") ? m.created_at : m.created_at.replace(" ", "T") + "Z";
  return localDateKey(iso);
}

function dayLabel(key: string): string {
  const today = localDateKey(new Date().toISOString());
  const yesterday = localDateKey(new Date(Date.now() - 86_400_000).toISOString());
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: { isFinal: boolean; 0: { transcript: string } }[] }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
}

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      className={`h-5 w-5 ${active ? "animate-pulse" : ""}`}
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function SpeakerIcon({ on }: { on: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" className="h-5 w-5">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      {on ? <path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12" /> : <path d="M17 9l5 6M22 9l-5 6" />}
    </svg>
  );
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-5 w-5">
      <path d="M4 12 20 4l-4 16-4.5-6.5L4 12Z" />
    </svg>
  );
}

export function Mate() {
  const name = useApp((s) => s.profile?.trader_name) ?? "trader";
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [speakBack, setSpeakBack] = useState(false);
  const [listening, setListening] = useState(false);
  const today = localDateKey(new Date().toISOString());
  const [viewingDay, setViewingDay] = useState(today);
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const nextId = useRef(-1);

  useEffect(() => {
    api<{ messages: ChatMsg[] }>("/chat")
      .then((r) => setMessages(r.messages))
      .catch(() => {});
  }, []);

  const days = useMemo(() => {
    const map = new Map<string, { count: number; preview: string }>();
    for (const m of messages) {
      const k = msgDay(m);
      const cur = map.get(k) ?? { count: 0, preview: "" };
      cur.count++;
      if (!cur.preview && m.role === "user") cur.preview = m.content.slice(0, 70);
      map.set(k, cur);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [messages]);

  const visible = useMemo(
    () => messages.filter((m) => msgDay(m) === viewingDay),
    [messages, viewingDay],
  );

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [visible, busy]);

  function speak(text: string) {
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.05;
      speechSynthesis.speak(u);
    } catch {
      // no TTS available
    }
  }

  async function send() {
    const message = input.trim();
    if (!message || busy) return;
    setInput("");
    setBusy(true);
    setViewingDay(today);
    const nowIso = new Date().toISOString();
    setMessages((m) => [
      ...m,
      { id: nextId.current--, role: "user", content: message, created_at: nowIso },
    ]);
    try {
      const r = await api<{ reply: string }>("/chat", {
        method: "POST",
        body: JSON.stringify({ message }),
      });
      setMessages((m) => [
        ...m,
        { id: nextId.current--, role: "assistant", content: r.reply, created_at: nowIso },
      ]);
      if (speakBack) speak(r.reply);
    } catch (e) {
      setMessages((m) => [
        ...m,
        {
          id: nextId.current--,
          role: "assistant",
          content: `(connection hiccup — ${e instanceof Error ? e.message : "try again"})`,
          created_at: nowIso,
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  function toggleMic() {
    const SR = getSpeechRecognition();
    if (!SR) return;
    if (listening) {
      recRef.current?.stop();
      return;
    }
    const rec = new SR();
    recRef.current = rec;
    rec.lang = "en-US";
    rec.continuous = false;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let text = "";
      for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
      setInput(text);
    };
    rec.onend = () => setListening(false);
    rec.onerror = () => setListening(false);
    setListening(true);
    rec.start();
  }

  const hasSR = getSpeechRecognition() !== null;

  return (
    <div className="mx-auto flex w-full flex-col lg:max-w-3xl">
      <div className="flex items-start justify-between px-1">
        <div>
          <h1 className="text-2xl font-bold text-white">Mate</h1>
          <p className="mt-1 text-sm text-ink-300">
            Knows your rules, your journal, your patterns. Honest by design.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          aria-label="Chat history"
          className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-ink-800 px-3 py-2 text-xs font-semibold text-ink-300 transition hover:text-white"
        >
          <IconClock className="h-4 w-4" /> History
        </button>
      </div>

      {viewingDay !== today && (
        <div className="mt-3 flex items-center justify-between rounded-xl border border-gold-500/30 bg-gold-500/10 px-3.5 py-2.5">
          <p className="text-xs font-semibold text-gold-300">
            Viewing {dayLabel(viewingDay)} — read only
          </p>
          <button
            type="button"
            onClick={() => setViewingDay(today)}
            className="rounded-lg bg-gold-500 px-2.5 py-1 text-xs font-bold text-ink-950 transition hover:bg-gold-400"
          >
            Back to today
          </button>
        </div>
      )}

      <div className="mt-4 space-y-3 pb-24">
        {visible.length === 0 && !busy && viewingDay === today && (
          <div className="max-w-[85%] rounded-2xl rounded-tl-sm border border-white/5 bg-ink-800 px-4 py-3 text-sm leading-relaxed text-ink-200">
            Hey {name}. I can see your journal, your rules and your Alpha Capital limits — so
            talk to me like a trading buddy. Show me an idea, vent after a stop-out, or ask
            what your last trades say about you. I'll be straight with you.
          </div>
        )}
        {visible.map((m) => (
          <div
            key={m.id}
            className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-3 text-sm leading-relaxed ${
              m.role === "user"
                ? "ml-auto rounded-br-sm bg-gold-500/15 text-gold-100 border border-gold-500/20"
                : "rounded-tl-sm border border-white/5 bg-ink-800 text-ink-200"
            }`}
          >
            {m.content}
          </div>
        ))}
        {busy && (
          <div className="flex w-16 items-center justify-center gap-1 rounded-2xl rounded-tl-sm border border-white/5 bg-ink-800 px-4 py-3.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-gold-400"
                style={{ animationDelay: `${i * 0.15}s` }}
              />
            ))}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      <Sheet open={historyOpen} onClose={() => setHistoryOpen(false)} title="Chat history">
        {days.length === 0 ? (
          <p className="text-sm text-ink-400">No conversations yet.</p>
        ) : (
          <ul className="space-y-2">
            {days.map(([day, info]) => (
              <li key={day}>
                <button
                  type="button"
                  onClick={() => {
                    setViewingDay(day);
                    setHistoryOpen(false);
                  }}
                  className={`w-full rounded-xl border px-3.5 py-3 text-left transition ${
                    viewingDay === day
                      ? "border-gold-500/50 bg-gold-500/10"
                      : "border-white/5 bg-ink-800 hover:border-white/15"
                  }`}
                >
                  <p className="flex items-baseline justify-between text-sm font-semibold text-white">
                    {dayLabel(day)}
                    <span className="text-xs font-normal text-ink-400">
                      {info.count} message{info.count === 1 ? "" : "s"}
                    </span>
                  </p>
                  {info.preview && (
                    <p className="mt-0.5 truncate text-xs text-ink-400">"{info.preview}"</p>
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Sheet>

      <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-10 border-t border-white/5 bg-ink-950/90 backdrop-blur-xl">
        <div className="mx-auto flex max-w-lg items-center gap-2 px-4 py-2.5 lg:max-w-3xl">
          <button
            type="button"
            onClick={() => setSpeakBack((v) => !v)}
            aria-label="Toggle voice replies"
            className={`rounded-xl border p-2.5 transition ${
              speakBack
                ? "border-gold-500/50 bg-gold-500/15 text-gold-300"
                : "border-white/10 bg-ink-800 text-ink-400 hover:text-white"
            }`}
          >
            <SpeakerIcon on={speakBack} />
          </button>
          {hasSR && (
            <button
              type="button"
              onClick={toggleMic}
              aria-label="Dictate message"
              className={`rounded-xl border p-2.5 transition ${
                listening
                  ? "border-down/60 bg-down/15 text-down"
                  : "border-white/10 bg-ink-800 text-ink-400 hover:text-white"
              }`}
            >
              <MicIcon active={listening} />
            </button>
          )}
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void send();
            }}
            placeholder={listening ? "Listening…" : "Talk to Mate…"}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-ink-800 px-3.5 py-2.5 text-sm text-white placeholder:text-ink-400 outline-none focus:border-gold-500/60"
          />
          <button
            type="button"
            onClick={() => void send()}
            disabled={busy || !input.trim()}
            aria-label="Send"
            className="rounded-xl bg-gold-500 p-2.5 text-ink-950 transition hover:bg-gold-400 disabled:opacity-40"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
