import { getAccount, getBytecode, readContract, simulateContract, waitForTransactionReceipt, writeContract, getTransactionReceipt } from "wagmi/actions";
import { getAddress, keccak256, zeroAddress, type Address, type Hash, type Hex } from "viem";
import type { Config } from "wagmi";
import { erc20Abi, factoryFeeControllerAbi, v2FactoryAbi } from "../sdk/v2Contracts";
import { FEE_CONTROLLER_CODE_HASH, V21_FEE_CONTROLLER_CODE_HASH } from "./feeControllerCodeHash";

const reviewedControllerHashes: ReadonlySet<Hex> = new Set([FEE_CONTROLLER_CODE_HASH, V21_FEE_CONTROLLER_CODE_HASH]);

export const ADMIN_ADDRESS = getAddress("0x5cc42e772f67089b4670eec4dcd904be2f2d511c");
export const SUPER_ADMIN_ADDRESS = getAddress("0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3");

export type FeeDefaults = {
  feeBps: number;
  creatorShareBps: number;
  buybackShareBps: number;
  creatorTaxCapBps: number;
  treasury: Address;
};

export type FeeAuthority = FeeDefaults & {
  owner: Address;
  pendingOwner: Address;
  controller: { address: Address; superAdmin: Address; feeAdmin: Address } | null;
};

export type FactoryFunds = {
  symbol: string;
  decimals: number;
  tradingTreasury: { address: Address; balance: bigint };
  launchTreasury: { address: Address; balance: bigint };
  buybackVault: { address: Address; balance: bigint };
};

export type AdminActions = {
  getAccount: typeof getAccount;
  getCodeHash: (config: Config, address: Address, chainId: number) => Promise<Hex | null>;
  readContract: typeof readContract;
  simulateContract: typeof simulateContract;
  writeContract: typeof writeContract;
  waitForTransactionReceipt: typeof waitForTransactionReceipt;
  getTransactionReceipt: typeof getTransactionReceipt;
};

const defaultActions: AdminActions = {
  getAccount,
  getCodeHash: async (config, address, chainId) => {
    const code = await getBytecode(config, { address, chainId });
    return code ? keccak256(code) : null;
  },
  readContract, simulateContract, writeContract, waitForTransactionReceipt, getTransactionReceipt,
};

export function feePercentToBps(value: string, taxCapBps: number): number {
  if (!/^(?:\d+)(?:\.\d{1,2})?$/.test(value.trim())) throw new Error("Enter a percentage with at most two decimal places.");
  const [whole, fraction = ""] = value.trim().split(".");
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  if (!Number.isSafeInteger(bps) || bps < 0 || bps > 500 || bps + taxCapBps > 550) {
    throw new Error("The fee exceeds the factory limit.");
  }
  return bps;
}

export function feeUpdateArgs(nextFeeBps: number, current: FeeDefaults): readonly [number, number, number, number, Address] {
  return [nextFeeBps, current.creatorShareBps, current.buybackShareBps, current.creatorTaxCapBps, current.treasury];
}

export async function readFactoryFunds(config: Config, factory: Address, chainId: number, actions: AdminActions = defaultActions): Promise<FactoryFunds> {
  const readFactory = (functionName: "quote" | "treasury" | "launchFeeTreasury" | "vault") =>
    actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName, chainId });
  const [quoteRaw, tradingRaw, launchRaw, vaultRaw] = await Promise.all([
    readFactory("quote"), readFactory("treasury"), readFactory("launchFeeTreasury"), readFactory("vault"),
  ]);
  const quote = getAddress(quoteRaw as Address);
  const trading = getAddress(tradingRaw as Address);
  const launch = getAddress(launchRaw as Address);
  const vault = getAddress(vaultRaw as Address);
  const readQuote = (functionName: "symbol" | "decimals" | "balanceOf", args?: readonly [Address]) =>
    actions.readContract(config, { address: quote, abi: erc20Abi, functionName, args, chainId });
  const [symbol, decimals, tradingBalance, launchBalance, vaultBalance] = await Promise.all([
    readQuote("symbol"), readQuote("decimals"), readQuote("balanceOf", [trading]),
    launch === zeroAddress ? Promise.resolve(0n) : readQuote("balanceOf", [launch]),
    readQuote("balanceOf", [vault]),
  ]);
  return {
    symbol: symbol as string,
    decimals: Number(decimals),
    tradingTreasury: { address: trading, balance: BigInt(tradingBalance) },
    launchTreasury: { address: launch, balance: BigInt(launchBalance) },
    buybackVault: { address: vault, balance: BigInt(vaultBalance) },
  };
}

export async function readFeeDefaults(config: Config, factory: Address, chainId: number, actions: AdminActions = defaultActions): Promise<FeeAuthority> {
  const read = (functionName: "feeBps" | "creatorShareBps" | "buybackShareBps" | "creatorTaxCapBps" | "treasury" | "owner" | "pendingOwner") =>
    actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName, chainId });
  const [feeBps, creatorShareBps, buybackShareBps, creatorTaxCapBps, treasury, owner, pendingOwner] = await Promise.all([
    read("feeBps"), read("creatorShareBps"), read("buybackShareBps"), read("creatorTaxCapBps"), read("treasury"), read("owner"), read("pendingOwner"),
  ]);
  const ownerAddress = getAddress(owner as Address);
  let controller: FeeAuthority["controller"] = null;
  if (ownerAddress !== ADMIN_ADDRESS && ownerAddress !== SUPER_ADMIN_ADDRESS) {
    try {
      const ownerHash = await actions.getCodeHash(config, ownerAddress, chainId);
      if (!ownerHash || !reviewedControllerHashes.has(ownerHash)) throw new Error("Unrecognized factory owner code.");
      const controllerRead = (functionName: "factory" | "owner" | "feeAdmin") =>
        actions.readContract(config, { address: ownerAddress, abi: factoryFeeControllerAbi, functionName, chainId });
      const [boundFactory, superAdmin, feeAdmin] = await Promise.all([
        controllerRead("factory"), controllerRead("owner"), controllerRead("feeAdmin"),
      ]);
      if (getAddress(boundFactory as Address) === getAddress(factory)) {
        controller = { address: ownerAddress, superAdmin: getAddress(superAdmin as Address), feeAdmin: getAddress(feeAdmin as Address) };
      }
    } catch {
      // A factory owner that is not this controller has no delegated fee authority.
    }
  }
  return { feeBps: Number(feeBps), creatorShareBps: Number(creatorShareBps), buybackShareBps: Number(buybackShareBps), creatorTaxCapBps: Number(creatorTaxCapBps), treasury: getAddress(treasury as Address), owner: ownerAddress, pendingOwner: getAddress(pendingOwner as Address), controller };
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
  const controller = current.controller?.superAdmin === SUPER_ADMIN_ADDRESS && current.controller.feeAdmin === signer
    ? current.controller.address : null;
  if (current.owner !== signer && !controller) throw new Error("The connected wallet is not the on-chain fee administrator.");
  if (!Number.isInteger(nextFeeBps) || nextFeeBps < 0 || nextFeeBps > 500 || nextFeeBps + current.creatorTaxCapBps > 550) throw new Error("The fee exceeds the factory limit.");
  if (nextFeeBps === current.feeBps) throw new Error("The fee is already set to this value.");
  let hash: Hash;
  if (controller) {
    const simulation = await actions.simulateContract(config, { address: controller, abi: factoryFeeControllerAbi, functionName: "setTradingFeeBps", args: [nextFeeBps], account: account.address, chainId });
    hash = await actions.writeContract(config, simulation.request);
  } else {
    const simulation = await actions.simulateContract(config, { address: factory, abi: v2FactoryAbi, functionName: "setFeeDefaults", args: feeUpdateArgs(nextFeeBps, current), account: account.address, chainId });
    hash = await actions.writeContract(config, simulation.request);
  }
  onHash?.(hash);
  await confirm(config, chainId, hash, actions);
  await waitForExpectedState(config, factory, chainId, actions, (updated) => updated.feeBps === nextFeeBps);
  return hash;
}

export async function nominateFeeController(config: Config, factory: Address, chainId: number, candidate: Address, onHash?: (hash: Hash) => void, actions: AdminActions = defaultActions) {
  const account = actions.getAccount(config);
  if (!account.address || account.chainId !== chainId) throw new Error("Connect the factory owner on the configured network.");
  const current = await readFeeDefaults(config, factory, chainId, actions);
  const signer = getAddress(account.address);
  if (current.owner !== signer || current.pendingOwner !== zeroAddress) throw new Error("The factory must be owned by this wallet with no pending transfer.");
  const controller = getAddress(candidate);
  const controllerHash = await actions.getCodeHash(config, controller, chainId);
  if (!controllerHash || !reviewedControllerHashes.has(controllerHash)) throw new Error("Controller bytecode does not match the reviewed deployment.");
  const read = (functionName: "factory" | "owner" | "feeAdmin") =>
    actions.readContract(config, { address: controller, abi: factoryFeeControllerAbi, functionName, chainId });
  const [boundFactory, superAdmin, feeAdmin] = await Promise.all([read("factory"), read("owner"), read("feeAdmin")]);
  if (getAddress(boundFactory as Address) !== getAddress(factory) || getAddress(superAdmin as Address) !== SUPER_ADMIN_ADDRESS || getAddress(feeAdmin as Address) !== ADMIN_ADDRESS) {
    throw new Error("Controller must be bound to this factory, owned by dot, and assign this wallet as fee admin.");
  }
  const simulation = await actions.simulateContract(config, { address: factory, abi: v2FactoryAbi, functionName: "transferOwnership", args: [controller], account: account.address, chainId });
  const hash = await actions.writeContract(config, simulation.request);
  onHash?.(hash);
  await confirm(config, chainId, hash, actions);
  await waitForExpectedState(config, factory, chainId, actions, (updated) => updated.owner === signer && updated.pendingOwner === controller);
  return hash;
}
