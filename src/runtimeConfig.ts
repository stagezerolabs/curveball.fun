import { getAddress, isAddress, type Address } from "viem";

export type ChainRuntime = Readonly<{
  production: boolean;
  rpcUrl: string;
  launchpadAddress: Address | null;
  expectedChainId: number;
  indexerStartBlock: bigint;
}>;

export function readChainRuntime(
  env: Record<string, string | undefined>,
): ChainRuntime {
  const production = env.NODE_ENV === "production";
  const rawAddress = env.LAUNCHPAD_ADDRESS?.trim() ?? "";
  if (production && !rawAddress) {
    throw new Error("LAUNCHPAD_ADDRESS is required in production.");
  }
  if (rawAddress && !isAddress(rawAddress)) {
    throw new Error("LAUNCHPAD_ADDRESS must be a valid contract address.");
  }

  const rpcUrl = env.RPC_URL?.trim() || "http://127.0.0.1:8545";
  if (production && !rpcUrl.startsWith("https://")) {
    throw new Error("RPC_URL must use HTTPS in production.");
  }

  const expectedChainId = Number(
    env.EXPECTED_CHAIN_ID || (production ? "4153" : "31337"),
  );
  if (!Number.isSafeInteger(expectedChainId) || expectedChainId <= 0) {
    throw new Error("EXPECTED_CHAIN_ID must be a positive integer.");
  }
  if (production && expectedChainId !== 4153) {
    throw new Error("Production EXPECTED_CHAIN_ID must be RISE mainnet (4153).");
  }

  const start = env.INDEXER_START_BLOCK ?? (production ? "" : "0");
  if (!/^\d+$/.test(start)) {
    throw new Error("INDEXER_START_BLOCK must be a non-negative integer.");
  }

  return Object.freeze({
    production,
    rpcUrl,
    launchpadAddress: rawAddress ? getAddress(rawAddress) : null,
    expectedChainId,
    indexerStartBlock: BigInt(start),
  });
}
