import { expect, test } from "bun:test";
import testnetV2 from "../deployments/11155931/curveball-v2-permissionless.json";
import { discoverAllTokens, type CreatorTokenClient } from "./creatorTokens";
import { activeDeploymentBlock, launchpadAddress } from "./lib/web3";

test("the fee-enabled testnet factory scans from its deployment block", async () => {
  const deploymentBlock = BigInt(testnetV2.deploymentBlock);
  expect(launchpadAddress?.toLowerCase()).toBe(testnetV2.factory.toLowerCase());
  expect(activeDeploymentBlock).toBe(deploymentBlock);
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => deploymentBlock,
    getContractEvents: async ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
      ranges.push({ fromBlock, toBlock });
      return [];
    },
  } as unknown as CreatorTokenClient;

  expect(await discoverAllTokens(client, "v2")).toEqual([]);
  expect(ranges).toEqual([{ fromBlock: deploymentBlock, toBlock: deploymentBlock }]);
});
