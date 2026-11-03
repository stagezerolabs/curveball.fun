import type { MarketLifecycle } from "../sdk/sdk";

/** CurveLaunchpad.GRADUATION_TIMEOUT: how long a sold-out market waits before it can abort. */
export const GRADUATION_TIMEOUT_SECONDS = 7 * 24 * 60 * 60;

type MarketSnapshot = {
  graduated: boolean;
  lifecycle?: MarketLifecycle;
  pool?: string | null;
  pending?: boolean;
  progress?: number | null;
  readyAt?: number | null;
};

/** Graduated markets trade through their Icarus pool once it has been indexed. */
export function tradeVenueForMarket(market: MarketSnapshot) {
  if (!market.graduated && market.lifecycle !== "graduated") return "curve";
  if (!market.pool || /^0x0{40}$/i.test(market.pool)) return "pool-pending";
  return "pool";
}

/** Identifies the exact market, venue, side, and amount a displayed quote belongs to. */
export function tradeQuoteKey(
  market: MarketSnapshot & { address: string },
  side: "buy" | "sell",
  amount: string,
) {
  return [
    market.address.toLowerCase(),
    tradeVenueForMarket(market),
    market.pool?.toLowerCase() ?? "",
    side,
    amount,
  ].join(":");
}

/** Pool swaps require a verified pause read and a deployed atomic swap adapter. */
export function poolTradeAvailability(input: {
  venue: ReturnType<typeof tradeVenueForMarket>;
  paused?: boolean;
  adapter?: string | null;
}) {
  if (input.venue === "pool-pending") return "pool-pending";
  if (input.venue !== "pool") return "curve";
  if (!input.adapter) return "adapter-unavailable";
  if (input.paused === true) return "paused";
  if (input.paused !== false) return "checking";
  return "open";
}

/** The lifecycle, falling back to the older cached fields for tokens discovered before it existed. */
function lifecycleOf(market: MarketSnapshot): MarketLifecycle {
  if (market.lifecycle && market.lifecycle !== "none") return market.lifecycle;
  if (market.graduated) return "graduated";
  if (market.pending || (market.progress ?? 0) >= 100) return "ready";
  return "trading";
}

export function getMarketDisplayStatus(market: MarketSnapshot) {
  switch (lifecycleOf(market)) {
    case "graduated":
      return { kind: "graduated", label: "Graduated" } as const;
    case "ready":
      return { kind: "ready", label: "Bonding complete" } as const;
    case "aborted":
      return { kind: "aborted", label: "Graduation aborted" } as const;
    default:
      return { kind: "live", label: "Live" } as const;
  }
}

export type TradeState =
  "trading" | "ready" | "overdue" | "aborted" | "graduated";

/**
 * What the curve accepts right now. Pause blocks only buys (and launches). A sold-out market
 * accepts nothing until it graduates; once it has waited past the timeout, a sell aborts the
 * graduation and goes through. An aborted market keeps selling, and buys until it sells out again.
 */
export function selectTradeState(
  input: MarketSnapshot & { paused: boolean; nowSeconds: number },
) {
  const lifecycle = lifecycleOf(input);
  const soldOut = (input.progress ?? 0) >= 100;
  const overdue =
    lifecycle === "ready" &&
    input.readyAt != null &&
    input.nowSeconds >= input.readyAt + GRADUATION_TIMEOUT_SECONDS;
  const state: TradeState =
    lifecycle === "ready" && overdue
      ? "overdue"
      : lifecycle === "none"
        ? "trading"
        : lifecycle;
  const open = state === "trading" || state === "aborted";
  return {
    state,
    canBuy: open && !soldOut && !input.paused,
    canSell: open || state === "overdue",
    /** The next sell aborts the stuck graduation as part of the same transaction. */
    sellAborts: state === "overdue",
    canGraduate:
      state === "ready" ||
      state === "overdue" ||
      (state === "aborted" && soldOut),
  };
}
