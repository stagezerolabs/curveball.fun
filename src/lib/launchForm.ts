import { parseEther } from "viem";

type LaunchFormInput = {
  name: string;
  symbol: string;
  initialBuy: string;
  launchFee: bigint | undefined;
  feeAccepted: boolean;
};

export function canSubmitLaunch(input: LaunchFormInput): boolean {
  if (!input.name.trim() || !input.symbol.trim() || input.launchFee === undefined) return false;
  if (input.launchFee > 0n && !input.feeAccepted) return false;
  if (!input.initialBuy.trim()) return true;
  try {
    const amount = input.initialBuy.trim();
    if ((amount.split(".")[1]?.length ?? 0) > 18) return false;
    return parseEther(amount) >= 0n;
  } catch {
    return false;
  }
}
