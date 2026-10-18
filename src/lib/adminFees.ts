import { getAccount, readContract, simulateContract, waitForTransactionReceipt, writeContract, getTransactionReceipt } from "wagmi/actions";
import { getAddress, type Address, type Hash } from "viem";
import type { Config } from "wagmi";
import { curveFeeEscrowAbi, curveLaunchpadAbi, erc20Abi } from "../sdk/contracts";

/** CurveLaunchpad.MAX_FEE_BPS: the highest curve fee the owner can set for new launches. */
export const MAX_FEE_BPS = 200;

export type FeeDefaults = {
  feeBps: number;
  creatorShareBps: number;
  buybackShareBps: number;
  creatorTaxCapBps: number;
};

export type FeeAuthority = FeeDefaults & {
  owner: Address;
  pendingOwner: Address;
  guardian: Address;
  /** Immutable: launch fees go here directly, trading fees accrue to it in the escrow. */
  treasury: Address;
};

export type FactoryFunds = {
  symbol: string;
  decimals: number;
  treasuryWallet: { address: Address; balance: bigint };
  /** The treasury's unclaimed share of trading and pool fees. */
  treasuryInEscrow: { address: Address; balance: bigint };
  /** Everything the escrow holds: creator and treasury fees plus every market's buyback balance. */
  escrowHeld: { address: Address; balance: bigint };
};

export type AdminActions = {
  getAccount: typeof getAccount;
  readContract: typeof readContract;
  simulateContract: typeof simulateContract;
  writeContract: typeof writeContract;
  waitForTransactionReceipt: typeof waitForTransactionReceipt;
  getTransactionReceipt: typeof getTransactionReceipt;
};

const defaultActions: AdminActions = {
  getAccount,
  readContract, simulateContract, writeContract, waitForTransactionReceipt, getTransactionReceipt,
};

export function feePercentToBps(value: string): number {
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a percentage with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > MAX_FEE_BPS) {
    throw new Error(`The fee exceeds the launchpad limit of ${MAX_FEE_BPS / 100}%.`);
  }
  return bps;
}

/** setFeeDefaults takes the whole struct, so every other default is resubmitted unchanged. */
export function feeUpdateArgs(nextFeeBps: number, current: FeeDefaults) {
  return [{
    feeBps: nextFeeBps,
    creatorShareBps: current.creatorShareBps,
    buybackShareBps: current.buybackShareBps,
    taxCapBps: current.creatorTaxCapBps,
  }] as const;
}

export async function readFactoryFunds(config: Config, launchpad: Address, chainId: number, actions: AdminActions = defaultActions): Promise<FactoryFunds> {
  const readLaunchpad = (functionName: "quoteToken" | "treasury" | "escrow") =>
    actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName, chainId });
  const [quoteRaw, treasuryRaw, escrowRaw] = await Promise.all([readLaunchpad("quoteToken"), readLaunchpad("treasury"), readLaunchpad("escrow")]);
  const quote = getAddress(quoteRaw as Address);
  const treasury = getAddress(treasuryRaw as Address);
  const escrow = getAddress(escrowRaw as Address);
  const readQuote = (functionName: "symbol" | "decimals" | "balanceOf", args?: readonly [Address]) =>
    actions.readContract(config, { address: quote, abi: erc20Abi, functionName, args, chainId });
  const [symbol, decimals, treasuryBalance, escrowBalance, treasuryOwed] = await Promise.all([
    readQuote("symbol"), readQuote("decimals"), readQuote("balanceOf", [treasury]), readQuote("balanceOf", [escrow]),
    actions.readContract(config, { address: escrow, abi: curveFeeEscrowAbi, functionName: "claimable", args: [treasury, quote], chainId }),
  ]);
  return {
    symbol: symbol as string,
    decimals: Number(decimals),
    treasuryWallet: { address: treasury, balance: BigInt(treasuryBalance) },
    treasuryInEscrow: { address: escrow, balance: BigInt(treasuryOwed) },
    escrowHeld: { address: escrow, balance: BigInt(escrowBalance) },
  };
}

export async function readFeeDefaults(config: Config, launchpad: Address, chainId: number, actions: AdminActions = defaultActions): Promise<FeeAuthority> {
  const read = (functionName: "feeDefaults" | "treasury" | "owner" | "pendingOwner" | "guardian") =>
    actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName, chainId });
  const [defaults, treasury, owner, pendingOwner, guardian] = await Promise.all([
    read("feeDefaults"), read("treasury"), read("owner"), read("pendingOwner"), read("guardian"),
  ]);
  const [feeBps, creatorShareBps, buybackShareBps, creatorTaxCapBps] = defaults as readonly [number, number, number, number];
  return {
    feeBps: Number(feeBps), creatorShareBps: Number(creatorShareBps), buybackShareBps: Number(buybackShareBps), creatorTaxCapBps: Number(creatorTaxCapBps),
    treasury: getAddress(treasury as Address), owner: getAddress(owner as Address), pendingOwner: getAddress(pendingOwner as Address), guardian: getAddress(guardian as Address),
  };
}

async function confirm(config: Config, chainId: number, hash: Hash, actions: AdminActions) {
  let receipt;
  try {
    receipt = await actions.waitForTransactionReceipt(config, { chainId, hash, confirmations: 1, timeout: 120_000 });
  } catch (error) {
    try { receipt = await actions.getTransactionReceipt(config, { chainId, hash }); }
    catch { throw new Error(`Confirmation is taking longer. Check transaction ${hash} in the explorer before retrying.`, { cause: error }); }
  }
  if (receipt.status !== "success") throw new Error(`Transaction ${hash} reverted.`);
  return hash;
}
async function waitForExpectedState(
  config: Config, factory: Address, chainId: number, actions: AdminActions,
  matches: (current: Awaited<ReturnType<typeof readFeeDefaults>>) => boolean,
) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try {
      if (matches(await readFeeDefaults(config, factory, chainId, actions))) return;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
  }
  throw new Error("Transaction confirmed, but the latest state differs. Check the transaction in the explorer and refresh the dashboard.");
}

export async function submitFeeUpdate(config: Config, factory: Address, chainId: number, nextFeeBps: number, onHash?: (hash: Hash) => void, actions: AdminActions = defaultActions) {
  const account = actions.getAccount(config);
  if (!account.address || account.chainId !== chainId) throw new Error("Connect the factory owner or fee admin on the configured network.");
  const current = await readFeeDefaults(config, factory, chainId, actions);
  const signer = getAddress(account.address);
  if (current.owner !== signer) throw new Error("The connected wallet is not the on-chain fee administrator.");
  if (!Number.isInteger(nextFeeBps) || nextFeeBps < 0 || nextFeeBps > MAX_FEE_BPS) throw new Error(`The fee exceeds the launchpad limit of ${MAX_FEE_BPS / 100}%.`);
  if (nextFeeBps === current.feeBps) throw new Error("The fee is already set to this value.");
  const simulation = await actions.simulateContract(config, { address: factory, abi: curveLaunchpadAbi, functionName: "setFeeDefaults", args: feeUpdateArgs(nextFeeBps, current), account: account.address, chainId });
  const hash = await actions.writeContract(config, simulation.request);
  onHash?.(hash);
  await confirm(config, chainId, hash, actions);
  await waitForExpectedState(config, factory, chainId, actions, (updated) => updated.feeBps === nextFeeBps);
  return hash;
}
