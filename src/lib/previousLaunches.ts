import { getAddress, type Address } from "viem";
import previousDeployment from "../../deployments/11155931/curveball-v2.json";
import { v2FactoryAbi } from "../sdk/v2Contracts";

export const previousFactory = getAddress(previousDeployment.factory);
const FIRST_LAUNCH_BLOCK = 56_102_377n;
const QUERY_BLOCKS = 5_000n;
const QUERY_CONCURRENCY = 3;

export type PreviousLaunch = {
  token: Address;
  creator: Address;
  name: string;
  symbol: string;
  blockNumber: bigint;
};

type LaunchLog = {
  args?: { token?: Address; creator?: Address; name?: string; symbol?: string };
  blockNumber?: bigint | null;
};

export type PreviousLaunchClient = {
  getBlockNumber(): Promise<bigint>;
  getContractEvents(parameters: object): Promise<readonly LaunchLog[]>;
};

async function readLogs(client: PreviousLaunchClient, parameters: object) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await client.getContractEvents(parameters);
    } catch (error) {
      lastError = error;
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, Math.min(500 * 2 ** attempt, 4_000)));
    }
  }
  throw lastError;
}

export async function listPreviousLaunches(client: PreviousLaunchClient): Promise<PreviousLaunch[]> {
  const latest = await client.getBlockNumber();
  if (latest < FIRST_LAUNCH_BLOCK) return [];
  const ranges: { fromBlock: bigint; toBlock: bigint }[] = [];
  for (let fromBlock = FIRST_LAUNCH_BLOCK; fromBlock <= latest; fromBlock += QUERY_BLOCKS) {
    ranges.push({ fromBlock, toBlock: fromBlock + QUERY_BLOCKS - 1n < latest ? fromBlock + QUERY_BLOCKS - 1n : latest });
  }
  const launches: PreviousLaunch[] = [];
  let nextRange = 0;
  await Promise.all(Array.from({ length: Math.min(QUERY_CONCURRENCY, ranges.length) }, async () => {
    while (nextRange < ranges.length) {
      const range = ranges[nextRange++];
      const logs = await readLogs(client, {
        address: previousFactory,
        abi: v2FactoryAbi,
        eventName: "LaunchCreated",
        ...range,
        strict: true,
      });
      for (const log of logs) {
        const { token, creator, name, symbol } = log.args ?? {};
        if (!token || !creator || !name || !symbol || log.blockNumber == null) continue;
        launches.push({ token: getAddress(token), creator: getAddress(creator), name, symbol, blockNumber: log.blockNumber });
      }
    }
  }));
  return launches.sort((a, b) => Number(b.blockNumber - a.blockNumber));
}
