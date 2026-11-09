import { getAddress, type Address, type Hex } from "viem";

export const RISE_TESTNET_CHAIN_ID = 11_155_931 as const;
export const RISE_TESTNET_RPC_URL = "https://testnet.riselabs.xyz";
export const RISE_MAINNET_CHAIN_ID = 4_153 as const;
export const RISE_MAINNET_RPC_URL = "https://rpc.risechain.com";
export const RISE_MAINNET_EXPLORER_URL = "https://explorer.risechain.com";
export const RISE_TESTNET_EXPLORER_URL =
  "https://explorer.testnet.riselabs.xyz";
export type CurveballDeployment = Readonly<{
  chainId: number;
  launchpad: Address;
  swapAdapter?: Address;
  swapAdapterCodeHash?: Hex;
  slippageBps: number;
  deadlineSeconds: number;
}>;

export function defineCurveballDeployment(input: {
  chainId: number;
  launchpad: string;
  swapAdapter?: string;
  swapAdapterCodeHash?: string;
  slippageBps?: number;
  deadlineSeconds?: number;
}): CurveballDeployment {
  const slippageBps = input.slippageBps ?? 300;
  const deadlineSeconds = input.deadlineSeconds ?? 300;

  if (
    ![RISE_TESTNET_CHAIN_ID, RISE_MAINNET_CHAIN_ID, 31_337].includes(
      input.chainId,
    )
  ) {
    throw new Error(
      "Curveball requires RISE Testnet, RISE mainnet, or a local Anvil chain.",
    );
  }
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= 10_000
  ) {
    throw new Error(
      "Curveball slippage must be an integer from 0 to 9,999 bps.",
    );
  }
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new Error(
      "Curveball transaction deadline must be a positive number of seconds.",
    );
  }
  if (Boolean(input.swapAdapter) !== Boolean(input.swapAdapterCodeHash))
    throw new Error(
      "Swap adapter address and bytecode hash must be configured together.",
    );
  if (
    input.swapAdapterCodeHash &&
    !/^0x[0-9a-fA-F]{64}$/.test(input.swapAdapterCodeHash)
  )
    throw new Error("Invalid swap adapter bytecode hash.");

  return Object.freeze({
    chainId: input.chainId,
    launchpad: getAddress(input.launchpad),
    ...(input.swapAdapter
      ? { swapAdapter: getAddress(input.swapAdapter) }
      : {}),
    ...(input.swapAdapterCodeHash
      ? { swapAdapterCodeHash: input.swapAdapterCodeHash.toLowerCase() as Hex }
      : {}),
    slippageBps,
    deadlineSeconds,
  });
}

export function applySlippage(amount: bigint, slippageBps: number): bigint {
  if (amount < 0n) throw new Error("Amount cannot be negative.");
  if (
    !Number.isInteger(slippageBps) ||
    slippageBps < 0 ||
    slippageBps >= 10_000
  ) {
    throw new Error("Invalid slippage.");
  }
  return (amount * BigInt(10_000 - slippageBps)) / 10_000n;
}

export type TokenInput = Readonly<{
  name: string;
  symbol: string;
  uri: string;
}>;

export function validateTokenInput(input: TokenInput): TokenInput {
  const name = input.name.trim();
  const symbol = input.symbol.trim().toUpperCase();
  const uri = input.uri.trim();

  if (name.length < 1 || new TextEncoder().encode(name).length > 64) {
    throw new Error("Token name must contain 1–64 UTF-8 bytes.");
  }
  if (!/^[A-Z0-9]{1,12}$/.test(symbol)) {
    throw new Error(
      "Token symbol must contain 1–12 uppercase letters or numbers.",
    );
  }
  // The launchpad rejects an empty URI, so a launch always needs published metadata.
  if (!uri) throw new Error("Token metadata URI is required.");
  if (new TextEncoder().encode(uri).length > 2_048)
    throw new Error("Token metadata URI is too long.");
  const isHttps = /^https:\/\/[^\s]+$/i.test(uri);
  const isIpfs =
    /^ipfs:\/\/(Qm[1-9A-HJ-NP-Za-km-z]{44}|baf[a-z2-7]{20,})(\/[^\s]*)?$/i.test(
      uri,
    );
  if (!isHttps && !isIpfs) {
    throw new Error("Token metadata URI must be a valid HTTPS or IPFS URI.");
  }
  return Object.freeze({ name, symbol, uri });
}

export function createDeadline(nowMs: number, deadlineSeconds: number): bigint {
  if (!Number.isFinite(nowMs) || nowMs < 0)
    throw new Error("Invalid current time.");
  if (!Number.isInteger(deadlineSeconds) || deadlineSeconds <= 0) {
    throw new Error("Invalid transaction deadline.");
  }
  return BigInt(Math.floor(nowMs / 1_000) + deadlineSeconds);
}
