import { createPublicClient, getAddress, http, keccak256, type Address, type Hex } from "viem";
import { validateLaunchpad } from "../../src/deployment";
import { curveFeeEscrowAbi, curveLaunchpadAbi } from "../../src/sdk/contracts";

const requestedNetwork = Bun.env.DEPLOYMENT_NETWORK?.trim() || "mainnet";
if (requestedNetwork !== "mainnet" && requestedNetwork !== "testnet") {
  throw new Error("DEPLOYMENT_NETWORK must be mainnet or testnet.");
}
const network = requestedNetwork === "testnet"
  ? {
      name: "testnet",
      chainId: 11_155_931,
      outputPath: "deployments/11155931/curveball.json",
      rpcUrl: Bun.env.RISE_TESTNET_RPC_URL?.trim() || Bun.env.VITE_RPC_URL?.trim(),
      icarusFactory: getAddress("0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9"),
      explorerOrigin: "https://explorer.testnet.riselabs.xyz",
      // Testnet authorities are the dot operator; mainnet's are checked by the deploy preflight.
      operator: getAddress("0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3") as Address | undefined,
    }
  : {
      name: "mainnet",
      chainId: 4_153,
      outputPath: "deployments/4153/curveball.json",
      rpcUrl: Bun.env.RISE_MAINNET_RPC_URL?.trim(),
      icarusFactory: getAddress("0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615"),
      explorerOrigin: "https://explorer.risechain.com",
      operator: undefined as Address | undefined,
    };
const { chainId, outputPath, rpcUrl, icarusFactory } = network;
const broadcastPath = `contracts/broadcast/Deploy.s.sol/${chainId}/run-latest.json`;
// The order Deploy.s.sol creates them in; the token implementation is created inside the launchpad's constructor.
const expectedNames = ["CurveFeeEscrow", "CurveLpLocker", "CurveHolderReserve", "CurveLaunchpad"] as const;
const weth = getAddress("0x4200000000000000000000000000000000000006");
const explorerApiUrl = `${network.explorerOrigin}/api/v2/smart-contracts`;

type BroadcastTransaction = {
  transactionType: string;
  contractName: string;
  contractAddress?: string;
  hash: Hex;
};
type BroadcastReceipt = {
  contractAddress?: string | null;
  transactionHash: Hex;
  status: string;
  blockNumber: string;
};

if (!rpcUrl?.startsWith("https://")) throw new Error(`No HTTPS RPC configured for RISE ${network.name}.`);
if (network.name === "mainnet" && Bun.env.CONFIRM_RECORD_PRODUCTION !== "RECORD_CURVEBALL_RISE_MAINNET_4153") {
  throw new Error("Production record confirmation missing.");
}
if (await Bun.file(outputPath).exists()) throw new Error(`Refusing to overwrite ${outputPath}.`);

const broadcast = await Bun.file(broadcastPath).json() as {
  transactions: BroadcastTransaction[];
  receipts: BroadcastReceipt[];
};
const creations = broadcast.transactions.filter((transaction) => transaction.transactionType === "CREATE");
if (creations.length !== expectedNames.length || creations.some((transaction, index) => transaction.contractName !== expectedNames[index])) {
  throw new Error(`Broadcast does not contain the ordered ${network.name} deployment.`);
}
const receiptsByHash = new Map(broadcast.receipts.map((receipt) => [receipt.transactionHash.toLowerCase(), receipt]));
const created = creations.map((transaction, index) => {
  if (!transaction.contractAddress) throw new Error(`Missing ${expectedNames[index]} address.`);
  const receipt = receiptsByHash.get(transaction.hash.toLowerCase());
  if (!receipt || receipt.status !== "0x1" || !receipt.contractAddress) {
    throw new Error(`No successful creation receipt for ${expectedNames[index]}.`);
  }
  const address = getAddress(transaction.contractAddress);
  if (getAddress(receipt.contractAddress) !== address) throw new Error(`${expectedNames[index]} receipt mismatch.`);
  return {
    name: expectedNames[index] as string,
    address,
    hash: transaction.hash,
    blockNumber: BigInt(receipt.blockNumber),
  };
});

const launchpad = created[3].address;
const client = createPublicClient({ transport: http(rpcUrl) });
if (await client.getChainId() !== chainId) throw new Error(`RPC is not RISE ${network.name}.`);
const singletons = await validateLaunchpad(client as unknown as Parameters<typeof validateLaunchpad>[0], launchpad, weth);
const wired: Record<string, Address> = {
  CurveFeeEscrow: singletons.escrow,
  CurveLpLocker: singletons.locker,
  CurveHolderReserve: singletons.reserve,
};
for (const deployment of created.slice(0, 3)) {
  if (wired[deployment.name] !== deployment.address) throw new Error(`${deployment.name} does not match the launchpad's wiring.`);
}
if (singletons.icarusFactory !== icarusFactory) throw new Error("Launchpad points at another Icarus factory.");

const read = (functionName: string) => client.readContract({ address: launchpad, abi: curveLaunchpadAbi, functionName } as never) as Promise<unknown>;
const [owner, guardian, treasury, launchFee, graduationTarget, feeDefaults, supply, curveSupply, maxReserveBps, paused, escrowOwner] = await Promise.all([
  read("owner"),
  read("guardian"),
  read("treasury"),
  read("launchFee"),
  read("graduationTarget"),
  read("feeDefaults"),
  read("SUPPLY"),
  read("CURVE_SUPPLY"),
  read("MAX_RESERVE_BPS"),
  read("paused"),
  client.readContract({ address: singletons.escrow, abi: curveFeeEscrowAbi, functionName: "owner" }),
]) as [Address, Address, Address, bigint, bigint, readonly [number, number, number, number], bigint, bigint, bigint, boolean, Address];
const [feeBps, creatorShareBps, buybackShareBps, taxCapBps] = feeDefaults;
if (
  paused ||
  escrowOwner !== owner ||
  launchFee !== 1_000_000_000_000_000n ||
  graduationTarget < 10_000_000_000_000_000n ||
  feeBps !== 75 || creatorShareBps !== 5_000 || buybackShareBps !== 2_500 || taxCapBps !== 50 ||
  (network.operator && (owner !== network.operator || guardian !== network.operator || treasury !== network.operator))
) {
  throw new Error(`${network.name} policy mismatch.`);
}
if (supply !== 1_000_000n * 10n ** 18n || curveSupply !== 800_000n * 10n ** 18n) throw new Error("Supply policy mismatch.");

const verified = [...created, { name: "CurveToken", address: singletons.tokenImplementation, hash: created[3].hash, blockNumber: created[3].blockNumber }];
const codeHashes: Record<string, Hex> = {};
const sourceVerification: Record<string, { name: string; url: string }> = {};
for (const deployment of verified) {
  const code = await client.getBytecode({ address: deployment.address });
  if (!code || code === "0x") throw new Error(`${deployment.name} has no live code.`);
  codeHashes[deployment.name] = keccak256(code);

  let verifiedName = "";
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const response = await fetch(`${explorerApiUrl}/${deployment.address}`);
    if (response.ok) {
      const result = await response.json() as { is_verified?: boolean; name?: string };
      if (result.is_verified && result.name === deployment.name) {
        verifiedName = result.name;
        break;
      }
    }
    await Bun.sleep(5_000);
  }
  if (!verifiedName) throw new Error(`${deployment.name} is not source-verified on the RISE explorer.`);
  sourceVerification[deployment.name] = {
    name: verifiedName,
    url: `${network.explorerOrigin}/address/${deployment.address}?tab=contract`,
  };
}
const gitCommit = Bun.spawnSync(["git", "rev-parse", "HEAD"]).stdout.toString().trim();
const record = {
  version: "lean-v2",
  release: network.name,
  chainId,
  sourceCommit: gitCommit,
  launchpad,
  deploymentBlock: created[3].blockNumber.toString(),
  quote: singletons.quoteToken,
  icarusFactory,
  owner,
  guardian,
  treasury,
  launchFee: launchFee.toString(),
  graduationTarget: graduationTarget.toString(),
  feeDefaults: { feeBps, creatorShareBps, buybackShareBps, taxCapBps },
  supply: supply.toString(),
  curveSupply: curveSupply.toString(),
  maxReserveBps: maxReserveBps.toString(),
  singletons: {
    escrow: singletons.escrow,
    locker: singletons.locker,
    reserve: singletons.reserve,
    tokenImplementation: singletons.tokenImplementation,
  },
  codeHashes,
  sourceVerification,
  transactions: created.map(({ name, address, hash, blockNumber }) => ({
    name,
    address,
    hash,
    blockNumber: blockNumber.toString(),
  })),
};
await Bun.write(outputPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`Recorded Curveball launchpad ${launchpad} at block ${record.deploymentBlock}.`);
console.log(`VITE_LAUNCHPAD_ADDRESS=${launchpad}`);
console.log(`VITE_DEPLOYMENT_BLOCK=${record.deploymentBlock}`);
console.log(`KEEPER_FACTORY_ADDRESS=${launchpad}`);
console.log(`KEEPER_DEPLOYMENT_BLOCK=${record.deploymentBlock}`);
