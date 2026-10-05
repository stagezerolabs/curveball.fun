import { getAddress, parseAbiItem, type Address } from "viem";

const events = {
  LaunchCreated: parseAbiItem("event LaunchCreated(address indexed token,address indexed curve,address indexed creator,string name,string symbol,string uri)"),
  GraduationStarted: parseAbiItem("event GraduationStarted(address indexed token,address indexed curve)"),
  GraduationDeferred: parseAbiItem("event GraduationDeferred(address indexed token,bytes reason)"),
  Graduated: parseAbiItem("event Graduated(address indexed token,address indexed pool,uint256 tokenLiquidity,uint256 quoteLiquidity,uint256 liquidity)"),
  Trade: parseAbiItem("event Trade(address indexed token,address indexed trader,bool isBuy,uint256 grossCurveQuote,uint256 netTraderQuote,uint256 feeQuote,uint256 creatorTaxQuote,uint256 tokenAmount,uint256 vQAfter,uint256 vTAfter,uint256 soldAfter)"),
  FeeAccrued: parseAbiItem("event FeeAccrued(address indexed launch,address indexed asset,address indexed recipient,uint256 amount)"),
  FeeClaimed: parseAbiItem("event FeeClaimed(address indexed launch,address indexed asset,address indexed recipient,uint256 amount)"),
  BuybackExecuted: parseAbiItem("event BuybackExecuted(address indexed launch,address indexed venue,uint256 quoteSpent,uint256 tokensBought)"),
  VestedClaimed: parseAbiItem("event VestedClaimed(address indexed launch,address indexed recipient,uint256 amount)"),
  PoolFeesRouted: parseAbiItem("event PoolFeesRouted(address indexed token,address indexed pool,address indexed asset,uint256 amount)"),
  PoolRegistered: parseAbiItem("event PoolRegistered(address indexed pool,address indexed token,address indexed creator)"),
  TokensRescued: parseAbiItem("event TokensRescued(address indexed asset,uint256 amount,address indexed recipient)"),
  NativeRescued: parseAbiItem("event NativeRescued(uint256 amount,address indexed recipient)"),
};

export type IndexedV2Log = {
  event: keyof typeof events;
  args: Record<string, any>;
  blockNumber: bigint;
  logIndex: number;
  transactionHash: string;
  source: Address;
};

type LogClient = { getLogs(parameters: { address: Address; event: { name: string }; fromBlock: bigint; toBlock: bigint }): Promise<readonly { args?: unknown; blockNumber?: bigint | null; logIndex?: number | null; transactionHash?: string | null }[]> };

export async function collectV2Logs(client: LogClient, addresses: {
  factory: Address; escrow: Address; vault: Address; locker: Address; hook?: Address; wrapper?: Address; curves: readonly Address[];
}, fromBlock: bigint, toBlock: bigint): Promise<IndexedV2Log[]> {
  const queries: { address: Address; event: keyof typeof events }[] = [
    { address: addresses.factory, event: "LaunchCreated" },
    { address: addresses.factory, event: "GraduationStarted" },
    { address: addresses.factory, event: "GraduationDeferred" },
    { address: addresses.factory, event: "Graduated" },
    { address: addresses.escrow, event: "FeeAccrued" },
    { address: addresses.escrow, event: "FeeClaimed" },
    { address: addresses.vault, event: "BuybackExecuted" },
    { address: addresses.vault, event: "VestedClaimed" },
    { address: addresses.locker, event: "PoolRegistered" },
  ];
  for (const address of new Set([addresses.factory, addresses.escrow, addresses.vault, addresses.locker, addresses.wrapper].filter((x): x is Address => !!x))) {
    queries.push({ address, event: "TokensRescued" }, { address, event: "NativeRescued" });
  }
  if (addresses.hook) queries.push({ address: addresses.hook, event: "PoolFeesRouted" });
  const read = async ({ address, event }: { address: Address; event: keyof typeof events }) => {
    const logs = await client.getLogs({ address, event: events[event], fromBlock, toBlock });
    return logs.map((log) => {
      if (log.blockNumber == null || log.logIndex == null || !log.transactionHash || !log.args) throw new Error(`Incomplete ${event} log`);
      return { event, args: log.args as Record<string, any>, blockNumber: log.blockNumber, logIndex: log.logIndex, transactionHash: log.transactionHash, source: address };
    });
  };
  const initial = (await Promise.all(queries.map(read))).flat();
  const launched = initial.filter((log) => log.event === "LaunchCreated").map((log) => getAddress(log.args.curve));
  const curves = [...new Set([...addresses.curves.map(getAddress), ...launched])];
  const curveLogs = (await Promise.all(curves.flatMap((address) => ["Trade", "TokensRescued", "NativeRescued"].map((event) => read({ address, event: event as keyof typeof events }))))).flat();
  return [...initial, ...curveLogs].sort((a, b) => a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1);
}
