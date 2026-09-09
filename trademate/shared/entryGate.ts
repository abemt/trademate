export const PLAN_WAIT_MS = 15 * 60 * 1000;
export const ENTRY_WINDOW_MS = 5 * 60 * 1000;

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
  alert_price: number;
  invalidation_price: number;
  invalidation_rule: string;
  conditions: [string, string, string];
  no_trade_if: string;
  alert_set: boolean;
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
  if (!input || typeof input !== "object") throw new Error("Write your entry plan first.");
  const value = input as Record<string, unknown>;
  const sentence = (field: unknown, label: string, limit = 1000): string => {
    if (typeof field !== "string" || field.trim().length < 12 || field.trim().length > limit || !/[a-z\p{L}]/iu.test(field)) {
      throw new Error(`${label}: write a specific condition (12-${limit} characters).`);
    }
    return field.trim();
  };
  const price = (field: unknown, label: string): number => {
    if (typeof field !== "number" || !Number.isFinite(field) || field <= 0) throw new Error(`${label}: enter a positive price.`);
    return field;
  };
  if (!["bullish", "bearish", "neutral"].includes(String(value.bias))) throw new Error("Choose today's bias.");
  if (value.direction !== "long" && value.direction !== "short") throw new Error("Choose the planned direction.");
  if (!ENTRY_SETUPS.some((setup) => setup.id === value.setup)) throw new Error("Choose a playbook setup.");
  if ((value.bias === "bullish" && value.direction === "short") || (value.bias === "bearish" && value.direction === "long")) {
    throw new Error("The entry direction conflicts with the locked daily bias.");
  }
  if (!Array.isArray(value.conditions) || value.conditions.length !== 3) throw new Error("Write all three confirmations.");
  const conditions = value.conditions.map((condition, index) => sentence(condition, `Confirmation ${index + 1}`, 500)) as [string, string, string];
  if (new Set(conditions.map((condition) => condition.toLowerCase().replace(/\W/g, ""))).size !== 3) {
    throw new Error("Use three different confirmations.");
  }
  if (value.alert_set !== true) throw new Error("Set your price alert before locking the plan.");
  return {
    bias: value.bias as EntryPlanInput["bias"], direction: value.direction,
    setup: value.setup as EntryPlanInput["setup"], thesis: sentence(value.thesis, "Bias and setup rationale"),
    alert_price: price(value.alert_price, "Alert level"),
    invalidation_price: price(value.invalidation_price, "Invalidation level"),
    invalidation_rule: sentence(value.invalidation_rule, "Invalidation rule"),
    conditions, no_trade_if: sentence(value.no_trade_if, "Walk-away condition"), alert_set: true,
  };
}

export function sessionBlock(state: EntryGateState, now = Date.now()): string | null {
  if (tradingDate(state.timezone, now) !== state.date) return "A new trading day has started. Refresh the gate.";
  if (state.sit_out) return "Trading is finished for this account today.";
  if (state.trade_count >= state.max_trades) return "Daily trade limit reached. No extra trade.";
  if (state.open_count > 0) return "Manage the existing position before planning another entry.";
  return null;
}

export function planBlock(state: EntryGateState, now = Date.now(), requireConfirmation = false): string | null {
  const blocked = sessionBlock(state, now);
  if (blocked) return blocked;
  const plan = state.plan;
  if (!plan) return "Lock a plan before entry.";
  if (plan.account_id !== state.account_id || plan.date !== state.date) return "This plan belongs to another account or day.";
  if (plan.cancelled_at || plan.used_trade_id) return "This plan is no longer available. A new entry needs a new plan.";
  const created = Date.parse(plan.created_at);
  const ready = Date.parse(plan.ready_at);
  if (!Number.isFinite(created) || !Number.isFinite(ready) || ready < created + PLAN_WAIT_MS) return "The plan timing is invalid.";
  if (now < ready) return "The 15-minute planning wait is still running.";
  if (plan.confirmed_at) {
    const confirmed = Date.parse(plan.confirmed_at);
    if (!Number.isFinite(confirmed) || confirmed < ready || now < confirmed || now >= confirmed + ENTRY_WINDOW_MS) {
      return "The entry window expired. Cancel this plan and reassess.";
    }
  } else if (requireConfirmation) return "Confirm all three market conditions before entry.";
  return null;
}

export function allConfirmed(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every((answer) => answer === true);
}

export function noTradeWin(state: EntryGateState): boolean {
  return state.sit_out !== null && state.trade_count === 0;
}