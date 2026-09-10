export const ENTRY_SETUPS = [
  { id: "m15_double", label: "M15 double top / bottom" },
  { id: "h1_rejection", label: "H1 rejection" },
  { id: "bos_retest", label: "Break of structure + retest" },
] as const;

export interface EntryPlanInput {
  bias: "bullish" | "bearish" | "neutral";
  direction: "long" | "short";
  setup: typeof ENTRY_SETUPS[number]["id"];
  thesis: string;
  conditions: [string, string, string];
  invalidation_price: number;
  // Optional since v2; plans locked before 2026-09-10 always carry them.
  invalidation_rule?: string;
  alert_price?: number;
  no_trade_if?: string;
  alert_set?: boolean;
}

export interface EntryPlan {
  id: string;
  account_id: string;
  date: string;
  created_at: string;
  ready_at: string;
  confirmed_at: string | null;
  cancelled_at: string | null;
  used_trade_id: string | null;
  details: EntryPlanInput;
}

export interface EntryGateState {
  account_id: string;
  date: string;
  timezone: string;
  server_now: string;
  trade_count: number;
  open_count: number;
  max_trades: number;
  sit_out: { reason: string; created_at: string } | null;
  sit_out_days?: { date: string; reason: string; entries: number }[];
  plan: EntryPlan | null;
}

export function tradingDate(timezone: string, now = Date.now()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(now));
}

export function validateEntryPlan(input: unknown): EntryPlanInput {
  if (!input || typeof input !== "object") throw new Error("Write your plan first.");
  const value = input as Record<string, unknown>;
  const text = (field: unknown, label: string, limit: number): string => {
    if (typeof field !== "string" || field.trim().length < 3 || field.trim().length > limit || !/[a-z\p{L}]/iu.test(field)) {
      throw new Error(`${label}: a few words are enough (3-${limit} characters).`);
    }
    return field.trim();
  };
  const price = (field: unknown, label: string): number => {
    if (typeof field !== "number" || !Number.isFinite(field) || field <= 0) throw new Error(`${label}: enter a positive price.`);
    return field;
  };
  const given = (field: unknown) => field !== undefined && field !== null && field !== "";
  if (!["bullish", "bearish", "neutral"].includes(String(value.bias))) throw new Error("Choose today's bias.");
  if (value.direction !== "long" && value.direction !== "short") throw new Error("Choose the direction.");
  if (!ENTRY_SETUPS.some((setup) => setup.id === value.setup)) throw new Error("Choose a playbook setup.");
  if ((value.bias === "bullish" && value.direction === "short") || (value.bias === "bearish" && value.direction === "long")) {
    throw new Error("The direction contradicts your daily bias. Change the bias or skip the trade.");
  }
  if (!Array.isArray(value.conditions) || value.conditions.length !== 3) throw new Error("Write the three things you must see.");
  const conditions = value.conditions.map((condition, index) => text(condition, `Must see ${index + 1}`, 500)) as [string, string, string];
  if (new Set(conditions.map((condition) => condition.toLowerCase().replace(/\W/g, ""))).size !== 3) {
    throw new Error("The three confirmations must be different.");
  }
  const plan: EntryPlanInput = {
    bias: value.bias as EntryPlanInput["bias"], direction: value.direction,
    setup: value.setup as EntryPlanInput["setup"], thesis: text(value.thesis, "Why this trade", 1000),
    conditions, invalidation_price: price(value.invalidation_price, "Invalidation price"),
  };
  if (given(value.alert_price)) plan.alert_price = price(value.alert_price, "Alert level");
  if (given(value.invalidation_rule)) plan.invalidation_rule = text(value.invalidation_rule, "Invalidation rule", 1000);
  if (given(value.no_trade_if)) plan.no_trade_if = text(value.no_trade_if, "Walk-away condition", 1000);
  return plan;
}

export function sessionBlock(state: EntryGateState, now = Date.now()): string | null {
  if (tradingDate(state.timezone, now) !== state.date) return "A new trading day has started. Refresh.";
  if (state.sit_out) return "You finished trading for today. Entries are locked.";
  if (state.trade_count >= state.max_trades) return `Daily limit reached (${state.max_trades}). No extra trade.`;
  return null;
}

export function planBlock(state: EntryGateState, now = Date.now()): string | null {
  const blocked = sessionBlock(state, now);
  if (blocked) return blocked;
  const plan = state.plan;
  if (!plan) return "Write the plan before you enter.";
  if (plan.account_id !== state.account_id || plan.date !== state.date) return "This plan belongs to another account or day.";
  if (plan.cancelled_at || plan.used_trade_id) return "This plan was already used or cancelled. Write a new one.";
  return null;
}

export function noTradeWin(state: EntryGateState): boolean {
  return state.sit_out !== null && state.trade_count === 0;
}