import { getAddress } from "viem";
import { launchpadAbi } from "../../../abi.mjs";

const LOG_RANGE = 5_000n;
const LOG_SCAN_CONCURRENCY = 4;

export function createMarketCatalog({
  publicClient,
  launchpad,
  deploymentBlock,
}) {
  const markets = new Map();
  let nextBlock = deploymentBlock;

  async function discoverLaunches() {
    const latest = await publicClient.getBlockNumber();
    while (nextBlock <= latest) {
      const ranges = [];
      for (
        let block = nextBlock;
        block <= latest && ranges.length < LOG_SCAN_CONCURRENCY;
        block += LOG_RANGE
      ) {
        const toBlock =
          block + LOG_RANGE - 1n < latest ? block + LOG_RANGE - 1n : latest;
        ranges.push({ fromBlock: block, toBlock });
      }
      const batches = await Promise.all(
        ranges.map((range) =>
          publicClient.getContractEvents({
            address: launchpad,
            abi: launchpadAbi,
            eventName: "LaunchCreated",
            ...range,
            strict: true,
          }),
        ),
      );
      for (const logs of batches) {
        for (const log of logs) {
          const token = getAddress(log.args.token);
          markets.set(token.toLowerCase(), token);
        }
      }
      nextBlock = ranges.at(-1).toBlock + 1n;
    }
  }

  return { markets, discoverLaunches };
}
