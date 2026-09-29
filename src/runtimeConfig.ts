import { getAddress, isAddress, type Address } from "viem";
import { expectedChainId as parseExpectedChainId } from "./expectedChainId";

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

  const expectedChainId = parseExpectedChainId(env.EXPECTED_CHAIN_ID, production ? 11_155_931 : 31_337);
  if (production && ![11_155_931, 4_153].includes(expectedChainId)) {
    throw new Error(
      "Production EXPECTED_CHAIN_ID must be RISE Testnet or RISE mainnet.",
    );
  }
  if (expectedChainId === 4_153 && !env.MAINNET_DATABASE_URL?.trim()) {
    throw new Error("MAINNET_DATABASE_URL is required for RISE mainnet isolation.");
  }
  if (expectedChainId === 4_153 && rawAddress.toLowerCase() === "0x1a34768eab2f6b925d25ca1d6dac03c1a25ad39e") {
    throw new Error("The archived mainnet launchpad cannot be used for v2.");
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
