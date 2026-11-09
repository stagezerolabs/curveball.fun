import { parseEther } from "viem";

export type InitialBuyPercent = 0 | 25 | 50 | 100;

/** Keep the launch fee in WETH, then spend the selected share of the remainder. */
export function initialBuyFromWethBalance(
  balance: bigint,
  launchFee: bigint,
  percent: InitialBuyPercent,
): bigint {
  const spendable = balance > launchFee ? balance - launchFee : 0n;
  return (spendable * BigInt(percent)) / 100n;
}

type LaunchFormInput = {
  name: string;
  symbol: string;
  initialBuy: string;
  launchFee: bigint | undefined;
  artworkUri: string;
  taxPercent: string;
  /** The launchpad's fee-default tax cap; undefined until read. */
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
 * Whether the launch can be submitted. Check metadata and creator tax before the wallet is asked.
 */
export function canSubmitLaunch(input: LaunchFormInput): boolean {
  if (
    !input.name.trim() ||
    !input.symbol.trim() ||
    input.launchFee === undefined
  )
    return false;
  if (!hasPublishedArtwork(input.artworkUri)) return false;
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
