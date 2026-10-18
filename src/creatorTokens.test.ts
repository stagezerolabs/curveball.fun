import { expect, test } from "bun:test";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";
import { activeDeploymentBlock, launchpadAddress } from "./lib/web3";
import { factoryForToken } from "./lib/marketFactories";
import { getAddress, type Address } from "viem";

test("discovery scans only the configured factory from its deployment block", async () => {
  const deploymentBlock = activeDeploymentBlock;
  expect(launchpadAddress).not.toBeNull();
  const ranges: { address: string; fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => deploymentBlock,
    getContractEvents: async ({ address, fromBlock, toBlock }: { address: string; fromBlock: bigint; toBlock: bigint }) => {
      ranges.push({ address, fromBlock, toBlock });
      return [];
    },
  } as unknown as CreatorTokenClient;

  expect(await discoverAllTokens(client)).toEqual([]);
  expect(ranges).toContainEqual({ address: launchpadAddress!, fromBlock: deploymentBlock, toBlock: deploymentBlock });
  expect(ranges).toHaveLength(1);
});

test("discovery reads each launch's market from the launchpad and derives its state", async () => {
  const newToken = getAddress("0x0000000000000000000000000000000000000022");
  const creator = getAddress("0x0000000000000000000000000000000000000055");
  const pool = getAddress("0x0000000000000000000000000000000000000066");
  const unrelatedFactory = getAddress("0x2222222222222222222222222222222222222222");
  const launchpad = launchpadAddress!;
  const initialVirtualQuote = 2_500_000_000_000_000n; // a 0.01 WETH target
  const client = {
    getBlockNumber: async () => activeDeploymentBlock,
    getContractEvents: async ({ address, fromBlock }: { address: Address; fromBlock: bigint }) => {
      if (address.toLowerCase() === launchpad.toLowerCase() && fromBlock === activeDeploymentBlock)
        return [{ args: { token: newToken, creator, name: "New", symbol: "NEW", uri: "ipfs://new" }, blockNumber: fromBlock }];
      throw new Error(`Unexpected launchpad ${address}`);
    },
    readContract: async ({ functionName }: { functionName: string }) => {
      if (functionName === "market") return {
        creator, feeBps: 75, creatorShareBps: 5_000, buybackShareBps: 2_500, taxBps: 50, state: 3,
        virtualToken: 200_000n * 10n ** 18n, virtualQuote: 0n, initialVirtualQuote, realQuote: 0n,
        reserveTokens: 40_000n * 10n ** 18n, readyAt: 1_700_000_000, pool,
      };
      throw new Error(`Unexpected ${functionName}`);
    },
    getBlock: async ({ blockNumber }: { blockNumber: bigint }) => ({ timestamp: blockNumber }),
  } as unknown as CreatorTokenClient;
  let showNewToken!: (tokens: Awaited<ReturnType<typeof discoverAllTokens>>) => void;
  const firstBatch = new Promise<Awaited<ReturnType<typeof discoverAllTokens>>>((resolve) => { showNewToken = resolve; });
  const discovery = discoverAllTokens(client, (batch) => {
    if (batch.length) showNewToken(batch);
  });
  expect((await firstBatch).map(({ address }) => address)).toEqual([newToken]);
  const [token] = await discovery;
  expect(token).toMatchObject({
    factory: launchpad, feeBps: 75, creatorTaxBps: 50, lifecycle: "graduated", graduated: true, pending: false,
    readyAt: 1_700_000_000, progress: 100, pool, reserveTokens: (40_000n * 10n ** 18n).toString(),
    graduationTargetWeth: "0.01", metadataUri: "ipfs://new",
  });
  expect(factoryForToken(token.factory)).toBe(launchpad);
  expect(() => factoryForToken(unrelatedFactory)).toThrow("configured launchpad");
});
