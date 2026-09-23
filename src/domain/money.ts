// Money and budget semantics. Price-level symbols become labeled ESTIMATES,
// never precise quotes; missing prices are unknown, not zero.
import type { CheckResult, Money } from "./types";

export function formatMoney(amount: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

export function formatMoneyRange(low: number | null | undefined, high: number | null | undefined, currency = "USD"): string {
  if (low == null && high == null) return "Price not verified";
  if (low != null && high != null && Math.round(low) !== Math.round(high)) {
    return `${formatMoney(low, currency)}–${formatMoney(high, currency)}`;
  }
  return formatMoney((low ?? high)!, currency);
}

/**
 * Approximate per-person dinner/activity ranges for Google-style price levels.
 * Documented estimate (DECISIONS.md); always labeled "estimate" in the UI.
 */
const PRICE_LEVEL_RANGES: Record<number, [number, number]> = {
  1: [8, 18],
  2: [15, 35],
  3: [30, 60],
  4: [55, 120],
};

/** Parse provider price strings: "$$", "$20–30", "$10-20", "$50+". */
export function parsePriceString(raw: string | null | undefined, sourceKind: Money["sourceKind"]): Money | null {
  if (!raw) return null;
  const s = raw.trim();
  const range = /^\$?\s*(\d+(?:\.\d+)?)\s*[–—-]\s*\$?\s*(\d+(?:\.\d+)?)/.exec(s);
  if (range) {
    return { min: Number(range[1]), max: Number(range[2]), currency: "USD", basis: "per_person", kind: "range", sourceKind };
  }
  const plus = /^\$?\s*(\d+(?:\.\d+)?)\s*\+/.exec(s);
  if (plus) {
    return { min: Number(plus[1]), max: null, currency: "USD", basis: "per_person", kind: "range", sourceKind };
  }
  if (/^\${1,4}$/.test(s)) {
    const [min, max] = PRICE_LEVEL_RANGES[s.length];
    return { min, max, currency: "USD", basis: "per_person", kind: "price_level", sourceKind: "estimate" };
  }
  const single = /^\$?\s*(\d+(?:\.\d+)?)$/.exec(s);
  if (single) {
    const v = Number(single[1]);
    return { min: v, max: v, currency: "USD", basis: "per_person", kind: "quote", sourceKind };
  }
  return null;
}

export function isEstimated(money: Money | null | undefined): boolean {
  if (!money) return false;
  return money.kind === "estimate" || money.kind === "price_level" || money.sourceKind === "estimate";
}

/** Per-person bounds. per_group costs are divided by group size. */
export function perPersonBounds(money: Money | null | undefined, groupSize: number): { low: number | null; high: number | null } {
  if (!money) return { low: null, high: null };
  const divisor = money.basis === "per_group" ? Math.max(1, groupSize) : 1;
  const min = money.min ?? null;
  const max = money.max ?? null;
  const low = min ?? max;
  const high = max ?? null;
  return {
    low: low == null ? null : low / divisor,
    high: high == null ? null : high / divisor,
  };
}

export interface BudgetCheck {
  result: CheckResult;
  /** amount over the limit (positive) when FAIL */
  over?: number;
  message: string;
  estimated: boolean;
}

/**
 * Hard maximum: FAIL only when the lowest possible price exceeds the max;
 * PASS only when the highest possible price is within it. Anything else,
 * including a missing price or an open-ended range, is UNKNOWN.
 */
export function checkMaxBudget(low: number | null, high: number | null, max: number, estimated: boolean, currency = "USD"): BudgetCheck {
  if (low == null && high == null) {
    return { result: "UNKNOWN", message: "Price not verified", estimated: false };
  }
  if (low != null && low > max + 0.005) {
    const over = Math.round(low - max);
    return { result: "FAIL", over, message: `${formatMoney(over, currency)} over maximum budget`, estimated };
  }
  if (high != null && high <= max + 0.005) {
    return { result: "PASS", message: `Within ${formatMoney(max, currency)} max`, estimated };
  }
  return {
    result: "UNKNOWN",
    message: `${formatMoneyRange(low, high, currency)} may exceed ${formatMoney(max, currency)} max`,
    estimated,
  };
}

/** Soft preference: returns satisfaction 0..100 and how far above preference. */
export function preferredBudgetScore(low: number | null, high: number | null, preferred: number): { score: number | null; over: number } {
  if (low == null && high == null) return { score: null, over: 0 };
  const expected = high != null && low != null ? (low + high) / 2 : (high ?? low)!;
  if ((high ?? expected) <= preferred) return { score: 100, over: 0 };
  const over = Math.max(0, expected - preferred);
  if (over <= 0) return { score: 90, over: 0 };
  const pct = over / Math.max(1, preferred);
  return { score: Math.max(0, Math.round(100 - pct * 200)), over: Math.round(over) };
}
