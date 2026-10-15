export type MarketState = "public" | "invited-beta" | "uninvited-beta" | "ready" | "graduated";

type BetaContext = {
  walletConnected: boolean;
};

type MarketStateInput = BetaContext & {
  publicLaunchOpen?: boolean;
  invited?: boolean;
  graduated?: boolean;
  pending?: boolean;
  progress?: number | null;
};

export function selectMarketState(input: MarketStateInput): {
  state: MarketState;
  hasBetaAccess: boolean;
  canCreate: boolean;
  canBuy: boolean;
} {
  const isPublic = input.publicLaunchOpen === true;
  const hasBetaAccess = isPublic || input.invited === true;
  const buyBlockedByMarket = input.pending === true || (input.progress ?? 0) >= 100;
  const state: MarketState = input.graduated
    ? "graduated"
    : buyBlockedByMarket
      ? "ready"
      : isPublic
        ? "public"
        : input.invited === true
          ? "invited-beta"
          : "uninvited-beta";

  return {
    state,
    hasBetaAccess,
    canCreate: input.walletConnected && hasBetaAccess,
    canBuy: input.walletConnected && hasBetaAccess && !input.graduated && !buyBlockedByMarket,
  };
}

export function getBetaReadEnabled(input: BetaContext & { hasLaunchpadAddress: boolean }): {
  publicLaunchOpen: boolean;
  invited: boolean;
} {
  return {
    publicLaunchOpen: input.hasLaunchpadAddress,
    invited: input.walletConnected && input.hasLaunchpadAddress,
  };
}
