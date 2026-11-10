import { parseEther } from "viem";
import { NATIVE_GAS_RESERVE } from "../sdk/sdk";

export type InitialBuyPercent = 0 | 25 | 50 | 100;
export const LAUNCH_GAS_RESERVE = NATIVE_GAS_RESERVE * 3n;
const BPS = 10_000n;

/** All-in spend that reaches the per-wallet cap in the opening launch transaction. */
export function firstBuySpendCap({
  graduationTarget,
  tokenSupply,
  curveSupply,
  walletCapBps,
  feeBps,
  creatorTaxBps,
}: {
  graduationTarget: bigint;
  tokenSupply: bigint;
  curveSupply: bigint;
  walletCapBps: number;
  feeBps: number;
  creatorTaxBps: number;
}): bigint {
  if (
    graduationTarget <= 0n ||
    curveSupply <= 0n ||
    curveSupply >= tokenSupply ||
    walletCapBps <= 0
  ) return 0n;
  const virtualQuote =
    (graduationTarget * (tokenSupply - curveSupply)) / curveSupply;
  const walletCap = (curveSupply * BigInt(walletCapBps)) / BPS;
  const remaining = tokenSupply - walletCap;
  const curveQuote =
    (tokenSupply * virtualQuote + remaining - 1n) / remaining - virtualQuote;
  // The first buy happens in launch(), so elapsed time is zero and opening tax is 99%.
  return (
    curveQuote +
    (curveQuote * BigInt(feeBps)) / BPS +
    (curveQuote * BigInt(creatorTaxBps)) / BPS +
    (curveQuote * 9_900n) / BPS
  );
}

/** Budget a launch across existing WETH and ETH while leaving ETH for wallet transactions. */
export function launchFundingState(
  wethBalance: bigint,
  nativeBalance: bigint,
  launchFee: bigint,
  initialBuy: bigint,
) {
  const spendableEth =
    nativeBalance > LAUNCH_GAS_RESERVE
      ? nativeBalance - LAUNCH_GAS_RESERVE
      : 0n;
  const available = wethBalance + spendableEth;
  const maxInitialBuy = available > launchFee ? available - launchFee : 0n;
  const total = launchFee + initialBuy;
  const wethUsed = wethBalance < total ? wethBalance : total;
  const ethToWrap = total - wethUsed;
  return {
    maxInitialBuy,
    wethUsed,
    ethToWrap,
    canFund:
      initialBuy >= 0n &&
      nativeBalance >= LAUNCH_GAS_RESERVE &&
      spendableEth >= ethToWrap,
  };
}

/** Spend the selected share of the combined budget after the fee and gas reserve. */
export function initialBuyFromAvailableBalance(
  wethBalance: bigint,
  nativeBalance: bigint,
  launchFee: bigint,
  percent: InitialBuyPercent,
  spendCap?: bigint,
): bigint {
  const walletMaximum = launchFundingState(
    wethBalance,
    nativeBalance,
    launchFee,
    0n,
  ).maxInitialBuy;
  const maximum =
    spendCap !== undefined && spendCap < walletMaximum
      ? spendCap
      : walletMaximum;
  return (maximum * BigInt(percent)) / 100n;
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
