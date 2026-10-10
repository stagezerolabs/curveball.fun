import { createPublicClient, getAddress, http, keccak256, parseAbi, type Abi, type Address, type Hash } from "viem";
import { riseTestnet } from "viem/chains";
import { v2FactoryAbi } from "../src/sdk/v2Contracts";

const fixedRateVenueAbi = parseAbi(["function input() view returns (address)", "function quote() view returns (address)"]);
const tokenBuyAdapterAbi = parseAbi([
  "function factory() view returns (address)", "function input() view returns (address)",
  "function quote() view returns (address)", "function venue() view returns (address)",
]);
const mockUsdcAbi = parseAbi(["function balanceOf(address) view returns (uint256)"]);

const RPC = Bun.env.RISE_TESTNET_RPC_URL;
if (!RPC?.startsWith("https://")) throw new Error("Set an HTTPS RISE_TESTNET_RPC_URL.");
const client = createPublicClient({ chain: riseTestnet, transport: http(RPC) });
if (await client.getChainId() !== 11_155_931) throw new Error("RPC is not RISE Testnet.");
async function read<T>(address: Address, abi: Abi, functionName: string, args?: readonly unknown[]): Promise<T> {
  return client.readContract({ address, abi, functionName, ...(args ? { args } : {}) } as never) as Promise<T>;
}

const broadcast = await Bun.file("contracts/broadcast/DeployTokenBeta.s.sol/11155931/run-latest.json").json();
const transactions = broadcast.transactions as Array<{ contractName: string; transactionType: string; contractAddress: string; hash: Hash }>;
const names = ["MockBetaUSDC", "MockBetaWETH", "FixedRateVenue", "CurveLaunchFactory", "CurveTokenBuyAdapter"] as const;
const creations = names.map((name) => {
  const matches = transactions.filter((tx) => tx.contractName === name && tx.transactionType === "CREATE");
  if (matches.length !== 1) throw new Error(`Expected one broadcast creation for ${name}.`);
  return { name, address: getAddress(matches[0].contractAddress) };
});
const [musdc, mweth, venue, factory, adapter] = creations.map((item) => item.address);
if (transactions.length !== 16 || transactions.some((tx) => !tx.hash) || new Set(transactions.map((tx) => tx.hash)).size !== 16) throw new Error("Incomplete beta broadcast.");
const receipts = await Promise.all(transactions.map(({ hash }) => client.getTransactionReceipt({ hash })));
if (receipts.some((receipt) => receipt.status !== "success")) throw new Error("A beta broadcast transaction failed.");
const liveCreations = creations.map((item) => {
  const matches = receipts.filter((receipt) => receipt.contractAddress && getAddress(receipt.contractAddress) === item.address);
  if (matches.length !== 1) throw new Error(`${item.name} live creation receipt mismatch.`);
  return { ...item, hash: matches[0].transactionHash, blockNumber: matches[0].blockNumber };
});
const authority = getAddress("0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3");
const expectedIcarus = getAddress("0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9");
const [owner, treasury, quote, icarus, boundAdapter, enabled, venueInput, venueQuote, adapterFactory, adapterInput, adapterQuote, adapterVenue, inventory] = await Promise.all([
  read<Address>(factory, v2FactoryAbi, "owner"),
  read<Address>(factory, v2FactoryAbi, "treasury"),
  read<Address>(factory, v2FactoryAbi, "quote"),
  read<Address>(factory, v2FactoryAbi, "icarusFactory"),
  read<Address>(factory, parseAbi(["function tokenBuyAdapter() view returns (address)"]), "tokenBuyAdapter"),
  read<boolean>(factory, v2FactoryAbi, "tokenBuyEnabled"),
  read<Address>(venue, fixedRateVenueAbi, "input"),
  read<Address>(venue, fixedRateVenueAbi, "quote"),
  read<Address>(adapter, tokenBuyAdapterAbi, "factory"),
  read<Address>(adapter, tokenBuyAdapterAbi, "input"),
  read<Address>(adapter, tokenBuyAdapterAbi, "quote"),
  read<Address>(adapter, tokenBuyAdapterAbi, "venue"),
  read<bigint>(mweth, mockUsdcAbi, "balanceOf", [venue]),
]);
if (owner !== authority || treasury !== authority || icarus !== expectedIcarus || quote !== mweth || boundAdapter !== adapter || !enabled || venueInput !== musdc || venueQuote !== mweth || adapterFactory !== factory || adapterInput !== musdc || adapterQuote !== mweth || adapterVenue !== venue || inventory !== 1_000n * 10n ** 18n) {
  throw new Error("Live beta wiring, authority, or venue inventory mismatch.");
}
const services = {
  deployer: "CurveLaunchDeployer", escrow: "CurveFeeEscrow", vault: "CurveBuybackVault",
  guard: "CurveGraduationGuard", locker: "CurveLpLocker", executor: "CurveGraduationExecutor",
  hook: "CurveMemeHook", launchAndBuy: "CurveLaunchAndBuy",
} as const;
const serviceAddresses: Record<string, Address> = {};
for (const [field, name] of Object.entries(services)) {
  const match = transactions.find((tx) => tx.contractName === name && tx.transactionType === "CREATE");
  if (!match) throw new Error(`Missing ${name} creation.`);
  const expected = getAddress(match.contractAddress);
  const live = await read<Address>(factory, v2FactoryAbi, field);
  if (live !== expected || receipts.filter((receipt) => receipt.contractAddress && getAddress(receipt.contractAddress) === expected).length !== 1) {
    throw new Error(`${name} live factory wiring mismatch.`);
  }
  serviceAddresses[field] = expected;
}
const codeHashes: Record<string, string> = {};
for (const { name, address } of [...creations, ...Object.entries(serviceAddresses).map(([name, address]) => ({ name, address }))]) {
  const code = await client.getBytecode({ address: address as Address });
  if (!code || code === "0x") throw new Error(`${name} has no live code.`);
  codeHashes[name] = keccak256(code);
}
const record = {
  version: "token-funded-beta", chainId: 11_155_931, deploymentBlock: liveCreations[0].blockNumber.toString(),
  factory, musdc, mweth, venue, adapter, treasury: authority, icarusFactory: expectedIcarus,
  services: serviceAddresses, codeHashes, transactions: liveCreations.map(({ name, address, hash }) => ({ name, address, hash })),
};
await Bun.write("deployments/11155931/token-beta.json", `${JSON.stringify(record, null, 2)}\n`);
console.log(`Recorded token-funded beta factory ${factory} at block ${record.deploymentBlock}`);
