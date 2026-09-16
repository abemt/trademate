import { create } from "zustand";
import { api } from "./api";
import { createTrade, fetchMergedTrades, flushQueue, queueUpsert } from "./sync";
import type { Account, Trade } from "./trades";
import type { EntryGateState } from "../../shared/entryGate";
import type { UrgeEntry, UrgeOutcome } from "../../shared/urges";

let gateRequest = 0;
const URGE_QUEUE_KEY = "tm_urge_queue_v1";

function readUrgeQueue(): UrgeEntry[] {
  try {
    return JSON.parse(localStorage.getItem(URGE_QUEUE_KEY) ?? "[]") as UrgeEntry[];
  } catch {
    return [];
  }
}

function writeUrgeQueue(entries: UrgeEntry[]): void {
  try {
    localStorage.setItem(URGE_QUEUE_KEY, JSON.stringify(entries));
  } catch {
    // storage full or unavailable — the in-memory list still shows the entry
  }
}

export interface Profile {
  id: number;
  trader_name: string;
  timezone: string;
  instrument: string;
  account_type: string;
  account_label: string;
  account_size: number;
  risk_pct_min: number;
  risk_pct_max: number;
  sl_pips_min: number;
  sl_pips_max: number;
  max_trades_per_day: number;
  eval_phase: number;
  prop_daily_loss_usd: number | null;
  prop_max_drawdown_usd: number | null;
  prop_profit_target_usd: number | null;
  prop_profit_target_p2_usd: number | null;
  news_buffer_min: number;
  news_restriction_applies: number;
  market_regime: string;
  market_regime_note: string | null;
  playbook: string;
  entry_triggers: string;
  weaknesses: string;
}

export const TABS = ["today", "analyze", "chart", "mate", "journal", "stats"] as const;
export type Tab = (typeof TABS)[number];

type AuthState = "checking" | "locked" | "authed";

interface AppState {
  auth: AuthState;
  tab: Tab;
  profile: Profile | null;
  trades: Trade[];
  accounts: Account[];
  logFormOpen: boolean;
  prefill: Partial<Trade> | null;
  entryGate: EntryGateState | null;
  entryGateError: string | null;
  entryGateLoading: boolean;
  entryGateReceivedAt: number;
  loadEntryGate: () => Promise<void>;
  acceptEntryGate: (state: EntryGateState) => void;
  urges: UrgeEntry[];
  urgeSheetOpen: boolean;
  setUrgeSheetOpen: (open: boolean) => void;
  loadUrges: () => Promise<void>;
  logUrge: (entry: UrgeEntry) => Promise<void>;
  setUrgeOutcome: (id: string, outcome: UrgeOutcome, instead?: string) => Promise<void>;
  setTab: (tab: Tab) => void;
  setLogFormOpen: (open: boolean) => void;
  setPrefill: (prefill: Partial<Trade> | null) => void;
  checkAuth: () => Promise<void>;
  login: (passcode: string) => Promise<boolean>;
  loadProfile: () => Promise<void>;
  loadAccounts: () => Promise<void>;
  addAccount: (a: { label: string; type: string; starting_balance: number }) => Promise<void>;
  activateAccount: (id: string) => Promise<void>;
  archiveAccount: (id: string) => Promise<void>;
  loadTrades: () => Promise<void>;
  saveTrade: (t: Trade) => Promise<void>;
  deleteTrade: (id: string) => Promise<void>;
}

export const useApp = create<AppState>((set, get) => ({
  auth: "checking",
  tab: "today",
  profile: null,
  trades: [],
  accounts: [],
  logFormOpen: false,
  prefill: null,
  entryGate: null,
  entryGateError: null,
  entryGateLoading: false,
  entryGateReceivedAt: 0,
  urges: [],
  urgeSheetOpen: false,

  setUrgeSheetOpen: (urgeSheetOpen) => set({ urgeSheetOpen }),

  loadUrges: async () => {
    // Flush captures made offline first so the server list already contains them.
    const queued = readUrgeQueue();
    const remaining: UrgeEntry[] = [];
    for (const entry of queued) {
      try {
        await api("/urges", { method: "PUT", body: JSON.stringify(entry) });
      } catch {
        remaining.push(entry);
      }
    }
    writeUrgeQueue(remaining);
    try {
      const r = await api<{ urges: UrgeEntry[] }>("/urges?days=90");
      const ids = new Set(r.urges.map((entry) => entry.id));
      set({ urges: [...remaining.filter((entry) => !ids.has(entry.id)), ...r.urges] });
    } catch {
      if (remaining.length) set((s) => ({ urges: [...remaining, ...s.urges.filter((entry) => !remaining.some((q) => q.id === entry.id))] }));
    }
  },

  logUrge: async (entry) => {
    set((s) => ({ urges: [entry, ...s.urges.filter((existing) => existing.id !== entry.id)] }));
    try {
      const r = await api<{ urge: UrgeEntry }>("/urges", { method: "PUT", body: JSON.stringify(entry) });
      set((s) => ({ urges: s.urges.map((existing) => (existing.id === entry.id ? r.urge : existing)) }));
    } catch {
      writeUrgeQueue([...readUrgeQueue().filter((queued) => queued.id !== entry.id), entry]);
    }
  },

  setUrgeOutcome: async (id, outcome, instead) => {
    const now = new Date().toISOString();
    set((s) => ({ urges: s.urges.map((entry) => (entry.id === id ? { ...entry, outcome, instead: instead ?? entry.instead, updated_at: now } : entry)) }));
    const entry = get().urges.find((candidate) => candidate.id === id);
    if (readUrgeQueue().some((queued) => queued.id === id) && entry) {
      writeUrgeQueue(readUrgeQueue().map((queued) => (queued.id === id ? entry : queued)));
      return;
    }
    try {
      await api(`/urges/${id}`, { method: "PATCH", body: JSON.stringify({ outcome, instead }) });
    } catch {
      if (entry) writeUrgeQueue([...readUrgeQueue(), entry]);
    }
  },

  acceptEntryGate: (state) => {
    const account = get().accounts.find((candidate) => candidate.active === 1 && candidate.archived === 0);
    if (account?.id !== state.account_id) return;
    gateRequest++;
    set({ entryGate: state, entryGateError: null, entryGateLoading: false, entryGateReceivedAt: performance.now() });
  },

  loadEntryGate: async () => {
    const request = ++gateRequest;
    const account = get().accounts.find((candidate) => candidate.active === 1 && candidate.archived === 0);
    if (!account) { set({ entryGate: null, entryGateLoading: false }); return; }
    set({ entryGateLoading: true, entryGateError: null });
    try {
      const state = await api<EntryGateState>(`/entry-gate?account_id=${encodeURIComponent(account.id)}`);
      if (request !== gateRequest) return;
      set({ entryGate: state, entryGateError: null, entryGateLoading: false, entryGateReceivedAt: performance.now() });
    } catch (error) {
      if (request !== gateRequest) return;
      set({ entryGate: null, entryGateLoading: false, entryGateError: error instanceof Error ? error.message : "Entry gate unavailable. Connect to continue." });
    }
  },

  setTab: (tab) => set({ tab }),
  setLogFormOpen: (logFormOpen) => set({ logFormOpen }),
  setPrefill: (prefill) => set({ prefill }),

  checkAuth: async () => {
    try {
      const r = await api<{ authed: boolean }>("/auth/me");
      if (r.authed) {
        set({ auth: "authed" });
        void get().loadProfile();
        void get().loadAccounts();
        void get().loadTrades();
        void get().loadUrges();
      } else {
        set({ auth: "locked" });
      }
    } catch {
      set({ auth: "locked" });
    }
  },

  login: async (passcode) => {
    try {
      await api("/auth/login", { method: "POST", body: JSON.stringify({ passcode }) });
      set({ auth: "authed" });
      void get().loadProfile();
      void get().loadAccounts();
      void get().loadTrades();
      void get().loadUrges();
      return true;
    } catch {
      return false;
    }
  },

  loadProfile: async () => {
    try {
      const r = await api<{ profile: Profile }>("/profile");
      set({ profile: r.profile });
    } catch {
      // keep null — screens fall back to sensible defaults
    }
  },

  loadAccounts: async () => {
    try {
      const r = await api<{ accounts: Account[] }>("/accounts");
      set({ accounts: r.accounts });
      void get().loadEntryGate();
    } catch {
      // keep current list
    }
  },

  addAccount: async (a) => {
    await api("/accounts", { method: "POST", body: JSON.stringify(a) });
    await get().loadAccounts();
  },

  activateAccount: async (id) => {
    await api("/accounts/activate", { method: "POST", body: JSON.stringify({ id }) });
    await get().loadAccounts();
  },

  archiveAccount: async (id) => {
    await api("/accounts/archive", { method: "POST", body: JSON.stringify({ id }) });
    await get().loadAccounts();
  },

  loadTrades: async () => {
    try {
      await flushQueue();
    } catch {
      // offline — pending writes stay queued
    }
    set({ trades: await fetchMergedTrades() });
    void get().loadEntryGate();
  },

  saveTrade: async (t) => {
    if (!get().trades.some((trade) => trade.id === t.id)) {
      const saved = await createTrade(t);
      set((state) => ({ trades: [...state.trades.filter((trade) => trade.id !== saved.id), saved].sort((left, right) => right.opened_at.localeCompare(left.opened_at)) }));
      await get().loadEntryGate();
      return;
    }
    set((s) => {
      const rest = s.trades.filter((x) => x.id !== t.id);
      const next = t.deleted ? rest : [...rest, t];
      next.sort((a, b) => b.opened_at.localeCompare(a.opened_at));
      return { trades: next };
    });
    queueUpsert(t);
    try {
      await flushQueue();
    } catch {
      // offline — will flush on reconnect
    }
    void get().loadEntryGate();
  },

  deleteTrade: async (id) => {
    const t = get().trades.find((x) => x.id === id);
    if (!t) return;
    await get().saveTrade({ ...t, deleted: 1, updated_at: new Date().toISOString() });
  },
}));
