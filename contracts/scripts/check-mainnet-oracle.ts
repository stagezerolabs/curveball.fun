import { createPublicClient, http, parseAbi, getAddress } from "viem";
import { curveLaunchpadAbi } from "../../src/sdk/contracts";

const rpc = Bun.env.RISE_MAINNET_RPC_URL?.trim() || "https://rpc.risechain.com";
const stork = getAddress("0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62");
const feedId =
  "0x7965e1bfc07a34caf0c3aa8146b200264fbb7a0eb85b1d3b1fdceecffd736b02";
const maxAge = 1800n;
const client = createPublicClient({ transport: http(rpc) });
if ((await client.getChainId()) !== 4153)
  throw new Error("RPC is not RISE mainnet.");
const block = await client.getBlock();
const value = await client.readContract({
  address: stork,
  abi: parseAbi([
    "function getTemporalNumericValueUnsafeV1(bytes32 id) view returns ((uint64 timestampNs, int192 quantizedValue))",
  ]),
  functionName: "getTemporalNumericValueUnsafeV1",
  args: [feedId],
  blockNumber: block.number,
});
const timestamp = value.timestampNs / 1_000_000_000n;
const age = block.timestamp - timestamp;
const price = value.quantizedValue;
console.log(`RISE mainnet block: ${block.number}`);
console.log(
  `Stork ETH/USDC: ${price} (18 decimals), age ${age}s, limit ${maxAge}s`,
);
if (
  timestamp > block.timestamp ||
  age > maxAge ||
  price < 100n * 10n ** 18n ||
  price > 100_000n * 10n ** 18n
)
  throw new Error(
    "Stork price is stale or outside Curveball bounds; launches must remain unavailable.",
  );
const recordPath = "../deployments/4153/curveball-oracle-v3.json";
if (await Bun.file(recordPath).exists()) {
  const record = (await Bun.file(recordPath).json()) as {
    launchpad: string;
    chainId: number;
    version: string;
  };
  if (record.chainId !== 4153 || record.version !== "oracle-v3")
    throw new Error("Invalid oracle deployment record.");
  const launchpad = getAddress(record.launchpad);
  const [oracle, contractAge, quote] = await Promise.all([
    client.readContract({
      address: launchpad,
      abi: curveLaunchpadAbi,
      functionName: "storkOracle",
      blockNumber: block.number,
    }),
    client.readContract({
      address: launchpad,
      abi: curveLaunchpadAbi,
      functionName: "MAX_ORACLE_AGE",
      blockNumber: block.number,
    }),
    client.readContract({
      address: launchpad,
      abi: curveLaunchpadAbi,
      functionName: "quoteLaunchFee",
      blockNumber: block.number,
    }),
  ]);
  if (
    oracle !== stork ||
    contractAge !== maxAge ||
    quote[1] !== price ||
    quote[2] !== value.timestampNs
  )
    throw new Error("Launchpad oracle wiring or price quote mismatch.");
  const expectedFee = (10n ** 36n + price - 1n) / price;
  if (quote[0] !== expectedFee)
    throw new Error("Launchpad fee is not $1 in WETH.");
  console.log(`Launchpad: ${launchpad}; fee ${quote[0]} wei WETH ($1 target)`);
}
