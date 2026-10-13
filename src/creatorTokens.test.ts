import { expect, test } from "bun:test";
import testnetV2 from "../deployments/11155931/curveball-v2-permissionless.json";
import legacyV2 from "../deployments/11155931/curveball-v2.json";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";
import { activeDeploymentBlock, launchpadAddress } from "./lib/web3";
import { factoryForToken } from "./lib/marketFactories";
import { getAddress, zeroAddress, type Address } from "viem";

test("the fee-enabled testnet factory scans from its deployment block", async () => {
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
  const oldRanges = ranges.filter((range) => range.address === legacyV2.factory).sort((a, b) => Number(a.fromBlock - b.fromBlock));
  expect(oldRanges[0].fromBlock).toBe(56_102_377n);
  expect(oldRanges.at(-1)?.toBlock).toBe(deploymentBlock);
  expect(oldRanges.every((range, index) => index === 0 || range.fromBlock === oldRanges[index - 1].toBlock + 1n)).toBe(true);
  expect(ranges.filter((range) => range.address === testnetV2.factory)).toEqual([
    { address: testnetV2.factory, fromBlock: deploymentBlock, toBlock: deploymentBlock },
  ]);
});

test("markets retain their source factory and fee after discovery", async () => {
  const oldToken = getAddress("0x0000000000000000000000000000000000000011");
  const newToken = getAddress("0x0000000000000000000000000000000000000022");
  const oldCurve = getAddress("0x0000000000000000000000000000000000000033");
  const newCurve = getAddress("0x0000000000000000000000000000000000000044");
  const creator = getAddress("0x0000000000000000000000000000000000000055");
  const oldFactory = getAddress(legacyV2.factory);
  const newFactory = getAddress(testnetV2.factory);
  const client = {
    getBlockNumber: async () => activeDeploymentBlock,
    getContractEvents: async ({ address, fromBlock }: { address: Address; fromBlock: bigint }) => {
      if (address.toLowerCase() === oldFactory.toLowerCase() && fromBlock === 56_102_377n)
        return [{ args: { token: oldToken, curve: oldCurve, creator, name: "Old", symbol: "OLD" }, blockNumber: fromBlock }];
      if (address.toLowerCase() === newFactory.toLowerCase() && fromBlock === activeDeploymentBlock)
        return [{ args: { token: newToken, curve: newCurve, creator, name: "New", symbol: "NEW" }, blockNumber: fromBlock }];
      return [];
    },
    readContract: async ({ address, functionName, args }: { address: Address; functionName: string; args?: readonly Address[] }) => {
      if (functionName === "supply") return 1_000_000n * 10n ** 18n;
      if (functionName === "curveSupply") return 800_000n * 10n ** 18n;
      if (functionName === "initialVQ") return 10n * 10n ** 18n;
      if (functionName === "market") return [args?.[0] === oldToken ? oldCurve : newCurve, creator, address.toLowerCase() === oldFactory.toLowerCase() ? 50 : 75, 5000, 2500, 0, creator];
      if (functionName === "sold" || functionName === "virtualQuote") return 10n * 10n ** 18n;
      if (functionName === "virtualToken") return 1_000_000n * 10n ** 18n;
      if (functionName === "ready" || functionName === "graduated") return false;
      if (functionName === "pool") return zeroAddress;
      throw new Error(`Unexpected ${functionName}`);
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
  } as unknown as CreatorTokenClient;
  const tokens = await discoverAllTokens(client, "v2");
  expect(tokens.map(({ factory, feeBps }) => [factory, feeBps])).toEqual([[newFactory, 75], [oldFactory, 50]]);
  expect(factoryForToken(tokens[1].factory)).toBe(oldFactory);
});
