import { expect, test } from "bun:test";
import testnetV2 from "../deployments/11155931/curveball-v2-permissionless.json";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";
import { activeDeploymentBlock, launchpadAddress } from "./lib/web3";
import { factoryForToken } from "./lib/marketFactories";
import { getAddress, zeroAddress, type Address } from "viem";

test("discovery scans only the current testnet factory from its deployment block", async () => {
  const deploymentBlock = BigInt(testnetV2.deploymentBlock);
  expect(launchpadAddress?.toLowerCase()).toBe(testnetV2.factory.toLowerCase());
  expect(activeDeploymentBlock).toBe(deploymentBlock);
  const ranges: { address: string; fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => deploymentBlock,
    getContractEvents: async ({ address, fromBlock, toBlock }: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      ranges.push({ address, fromBlock, toBlock });
      return [];
    },
  } as unknown as CreatorTokenClient;

  expect(await discoverAllTokens(client, "v2")).toEqual([]);
  expect(ranges).toEqual([
    { address: testnetV2.factory, fromBlock: deploymentBlock, toBlock: deploymentBlock },
  ]);
});

test("discovery and market access use only the current factory", async () => {
  const newToken = getAddress("0x0000000000000000000000000000000000000022");
  const newCurve = getAddress("0x0000000000000000000000000000000000000044");
  const creator = getAddress("0x0000000000000000000000000000000000000055");
  const oldFactory = getAddress("0x36628AbAC7B2cdcde1A8fa21868AfeCB74660ECf");
  const newFactory = getAddress(testnetV2.factory);
  const client = {
    getBlockNumber: async () => activeDeploymentBlock,
    getContractEvents: async ({ address, fromBlock }: { address: Address; fromBlock: bigint }) => {
      if (address.toLowerCase() === newFactory.toLowerCase() && fromBlock === activeDeploymentBlock)
        return [{ args: { token: newToken, curve: newCurve, creator, name: "New", symbol: "NEW" }, blockNumber: fromBlock }];
      throw new Error(`Unexpected factory ${address}`);
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "supply") return 1_000_000n * 10n ** 18n;
      if (functionName === "curveSupply") return 800_000n * 10n ** 18n;
      if (functionName === "initialVQ") return 10n * 10n ** 18n;
      if (functionName === "market") return [newCurve, creator, 75, 5000, 2500, 0, creator];
      if (functionName === "sold" || functionName === "virtualQuote") return 10n * 10n ** 18n;
      if (functionName === "virtualToken") return 1_000_000n * 10n ** 18n;
      if (functionName === "ready" || functionName === "graduated") return false;
      if (functionName === "pool") return zeroAddress;
      throw new Error(`Unexpected ${functionName}`);
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
  } as unknown as CreatorTokenClient;
  const tokens = await discoverAllTokens(client, "v2");
  expect(tokens.map(({ factory, feeBps }) => [factory, feeBps])).toEqual([[newFactory, 75]]);
  expect(factoryForToken(tokens[0].factory)).toBe(newFactory);
  expect(() => factoryForToken(oldFactory)).toThrow("unsupported factory");
});
