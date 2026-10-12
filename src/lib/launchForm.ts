import { parseEther } from "viem";

type LaunchFormInput = {
  name: string;
  symbol: string;
  initialBuy: string;
  launchFee: bigint | undefined;
  feeAccepted: boolean;
  artworkSelected: boolean;
  artworkUri: string;
};

export function hasPublishedArtwork(artworkSelected: boolean, artworkUri: string): boolean {
  return !artworkSelected || /^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})$/i.test(artworkUri);
}

export function canSubmitLaunch(input: LaunchFormInput): boolean {
  if (!input.name.trim() || !input.symbol.trim() || input.launchFee === undefined) return false;
  if (input.launchFee > 0n && !input.feeAccepted) return false;
  if (!hasPublishedArtwork(input.artworkSelected, input.artworkUri)) return false;
  if (!input.initialBuy.trim()) return true;
  try {
    const amount = input.initialBuy.trim();
    if ((amount.split(".")[1]?.length ?? 0) > 18) return false;
    return parseEther(amount) >= 0n;
  } catch {
    return false;
  }
}
