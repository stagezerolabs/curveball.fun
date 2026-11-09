import {
  createPublicClient,
  encodeAbiParameters,
  getAddress,
  http,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from "viem";

const networkName = Bun.env.DEPLOYMENT_NETWORK?.trim() || "testnet";
if (networkName !== "testnet" && networkName !== "mainnet")
  throw new Error("DEPLOYMENT_NETWORK must be testnet or mainnet.");
const testnet = networkName === "testnet";
const chainId = testnet ? 11_155_931 : 4_153;
const rpcUrl = testnet
  ? Bun.env.RISE_TESTNET_RPC_URL?.trim() || Bun.env.VITE_RPC_URL?.trim()
  : Bun.env.RISE_MAINNET_RPC_URL?.trim();
if (!rpcUrl?.startsWith("https://"))
  throw new Error(`An HTTPS RISE ${networkName} RPC is required.`);

const launchpadRecordPath = `deployments/${chainId}/curveball.json`;
const adapterRecordPath = `deployments/${chainId}/icarus-swap-adapter.json`;
const broadcastPath = `contracts/broadcast/DeployIcarusSwap.s.sol/${chainId}/run-latest.json`;
const explorerOrigin = testnet
  ? "https://explorer.testnet.riselabs.xyz"
  : "https://explorer.risechain.com";
if (await Bun.file(adapterRecordPath).exists())
  throw new Error(`${adapterRecordPath} already exists.`);

const launchpadRecord = (await Bun.file(launchpadRecordPath).json()) as {
  chainId: number;
  launchpad: string;
  quote: string;
  icarusFactory: string;
};
if (launchpadRecord.chainId !== chainId)
  throw new Error("Launchpad record is for another chain.");
const launchpad = getAddress(launchpadRecord.launchpad);
const quoteToken = getAddress(launchpadRecord.quote);
const icarusFactory = getAddress(launchpadRecord.icarusFactory);

const broadcast = (await Bun.file(broadcastPath).json()) as {
  transactions: Array<{
    transactionType: string;
    contractName: string;
    contractAddress?: string;
    hash: Hex;
  }>;
  receipts: Array<{
    transactionHash: Hex;
    contractAddress?: string | null;
    status: string;
    blockNumber: string;
  }>;
};
const creations = broadcast.transactions.filter(
  (transaction) => transaction.transactionType === "CREATE",
);
if (
  creations.length !== 1 ||
  creations[0].contractName !== "CurveIcarusSwapAdapter"
)
  throw new Error(
    "Broadcast does not contain exactly one swap adapter creation.",
  );
const creation = creations[0];
if (!creation.contractAddress)
  throw new Error("Broadcast is missing the swap adapter address.");
const adapter = getAddress(creation.contractAddress);
const receipt = broadcast.receipts.find(
  (item) => item.transactionHash.toLowerCase() === creation.hash.toLowerCase(),
);
if (
  !receipt ||
  receipt.status !== "0x1" ||
  !receipt.contractAddress ||
  getAddress(receipt.contractAddress) !== adapter
) {
  throw new Error("No successful swap adapter deployment receipt.");
}

const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== chainId)
  throw new Error(`RPC is not RISE ${networkName}.`);
const abi = parseAbi([
  "function launchpad() view returns (address)",
  "function quoteToken() view returns (address)",
  "function icarusFactory() view returns (address)",
]);
const readAdapter = (
  functionName: "launchpad" | "quoteToken" | "icarusFactory",
) =>
  client.readContract({
    address: adapter,
    abi,
    functionName,
  } as never) as Promise<Address>;
const [code, wiredLaunchpad, wiredQuote, wiredFactory] = await Promise.all([
  client.getBytecode({ address: adapter }),
  readAdapter("launchpad"),
  readAdapter("quoteToken"),
  readAdapter("icarusFactory"),
]);
if (!code || code === "0x") throw new Error("Swap adapter has no live code.");

// Pin only the implementation compiled from this checkout. A matching explorer
// contract name alone does not establish that the broadcast used these sources.
const artifact = (await Bun.file(
  "contracts/out/CurveIcarusSwapAdapter.sol/CurveIcarusSwapAdapter.json",
).json()) as { bytecode: { object: Hex } };
if (!/^0x[0-9a-fA-F]+$/.test(artifact.bytecode.object))
  throw new Error(
    "Compiled swap adapter bytecode is missing; run forge build.",
  );
const constructorArgs = encodeAbiParameters(
  [{ type: "address" }, { type: "address" }, { type: "address" }],
  [launchpad, quoteToken, icarusFactory],
);
const expectedCreationCode =
  `${artifact.bytecode.object}${constructorArgs.slice(2)}`.toLowerCase();
const [deploymentTx, liveReceipt] = await Promise.all([
  client.getTransaction({ hash: creation.hash }),
  client.getTransactionReceipt({ hash: creation.hash }),
]);
if (
  deploymentTx.to !== null ||
  deploymentTx.input.toLowerCase() !== expectedCreationCode
)
  throw new Error(
    "Deployed swap adapter creation code does not match this checkout.",
  );
if (
  liveReceipt.status !== "success" ||
  !liveReceipt.contractAddress ||
  getAddress(liveReceipt.contractAddress) !== adapter ||
  liveReceipt.blockNumber !== BigInt(receipt.blockNumber)
) {
  throw new Error(
    "Onchain swap adapter receipt does not match the broadcast record.",
  );
}
if (
  getAddress(wiredLaunchpad) !== launchpad ||
  getAddress(wiredQuote) !== quoteToken ||
  getAddress(wiredFactory) !== icarusFactory
) {
  throw new Error("Swap adapter wiring does not match the recorded launchpad.");
}

let verified = false;
for (let attempt = 0; attempt < 12; attempt += 1) {
  const response = await fetch(
    `${explorerOrigin}/api/v2/smart-contracts/${adapter}`,
  );
  if (response.ok) {
    const source = (await response.json()) as {
      is_verified?: boolean;
      name?: string;
    };
    if (source.is_verified && source.name === "CurveIcarusSwapAdapter") {
      verified = true;
      break;
    }
  }
  if (attempt < 11) await Bun.sleep(1_000);
}
if (!verified)
  throw new Error("Swap adapter source is not verified on Blockscout.");

const record = {
  version: "icarus-swap-v1",
  chainId,
  launchpad,
  adapter,
  quoteToken,
  icarusFactory,
  codeHash: keccak256(code),
  deploymentBlock: BigInt(receipt.blockNumber).toString(),
  transactionHash: creation.hash,
};
await Bun.write(adapterRecordPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(
  `Recorded verified swap adapter ${adapter} for RISE ${networkName}.`,
);
