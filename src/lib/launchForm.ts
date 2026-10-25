import { parseEther } from "viem";

type LaunchFormInput = {
  name: string;
  symbol: string;
  initialBuy: string;
  launchFee: bigint | undefined;
  feeAccepted: boolean;
  artworkUri: string;
  taxPercent: string;
  reservePercent: string;
  /** The launchpad's MAX_RESERVE_BPS and fee-default tax cap; undefined until read. */
  maxReserveBps: number | undefined;
  taxCapBps: number | undefined;
};

export function hasPublishedArtwork(artworkUri: string): boolean {
  return /^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})$/i.test(
    artworkUri,
  );
}

/** Basis points from a percent string with at most two decimals, or null when it isn't one. */
export function percentToBps(percent: string): number | null {
  const value = percent.trim();
  if (!/^\d+(\.\d{1,2})?$/.test(value)) return null;
  return Math.round(Number(value) * 100);
}

/**
 * Whether the launch can be submitted. The launchpad rejects an empty metadata URI, a reserve above
 * MAX_RESERVE_BPS and a tax above the cap, so each is checked here before the wallet is asked.
 */
export function canSubmitLaunch(input: LaunchFormInput): boolean {
  if (
    !input.name.trim() ||
    !input.symbol.trim() ||
    input.launchFee === undefined
  )
    return false;
  if (input.launchFee > 0n && !input.feeAccepted) return false;
  if (!hasPublishedArtwork(input.artworkUri)) return false;
  const reserveBps = percentToBps(input.reservePercent);
  if (
    reserveBps === null ||
    input.maxReserveBps === undefined ||
    reserveBps > input.maxReserveBps
  )
    return false;
  const taxBps = percentToBps(input.taxPercent || "0");
  if (
    taxBps === null ||
    input.taxCapBps === undefined ||
    taxBps > input.taxCapBps
  )
    return false;
  if (!input.initialBuy.trim()) return true;
  try {
    const amount = input.initialBuy.trim();
    if ((amount.split(".")[1]?.length ?? 0) > 18) return false;
    return parseEther(amount) >= 0n;
  } catch {
    return false;
  }
}
