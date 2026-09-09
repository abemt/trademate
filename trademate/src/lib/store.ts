import { create } from "zustand";
import { api } from "./api";
import { createTrade, fetchMergedTrades, flushQueue, queueUpsert } from "./sync";
import type { Account, Trade } from "./trades";
import type { EntryGateState } from "../../shared/entryGate";

let gateRequest = 0;

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
