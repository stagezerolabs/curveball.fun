import { createPublicClient, getAddress, http, keccak256, parseAbi, type Address, type Hex } from "viem";
import { validateDeployment } from "../../src/deployment";
import { factoryAbi } from "../../src/sdk/contracts";

const requestedNetwork = Bun.env.DEPLOYMENT_NETWORK?.trim() || "mainnet";
if (requestedNetwork !== "mainnet" && requestedNetwork !== "testnet") {
  throw new Error("DEPLOYMENT_NETWORK must be mainnet or testnet.");
}
const network = requestedNetwork === "testnet"
  ? {
      name: "testnet",
      chainId: 11_155_931,
      outputPath: "deployments/11155931/curveball.json",
      broadcastPath: "contracts/broadcast/DeployTestnet.s.sol/11155931/run-latest.json",
      rpcUrl: Bun.env.RISE_TESTNET_RPC_URL?.trim() || Bun.env.VITE_RPC_URL?.trim(),
      icarusFactory: getAddress("0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9"),
      explorerOrigin: "https://explorer.testnet.riselabs.xyz",
    }
  : {
      name: "mainnet",
      chainId: 4_153,
      outputPath: "deployments/4153/curveball.json",
      broadcastPath: "contracts/broadcast/DeployProduction.s.sol/4153/run-latest.json",
      rpcUrl: Bun.env.RISE_MAINNET_RPC_URL?.trim(),
      icarusFactory: getAddress("0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615"),
      explorerOrigin: "https://explorer.risechain.com",
    };
const { chainId, outputPath, broadcastPath, rpcUrl, icarusFactory } = network;
const expectedNames = [
  "CurveLaunchFeeTreasury",
  "CurveV1Factory",
  "CurveLaunchDeployer",
  "CurveFeeEscrow",
  "CurveBuybackVault",
  "CurveV1Locker",
  "CurveMemeHook",
  "CurveLaunchAndBuy",
  "CurveHolderReserve",
  "CurveV1PoolAdapter",
] as const;
const weth = getAddress("0x4200000000000000000000000000000000000006");
const venueAbi = parseAbi([
  "function poolFactory() view returns (address)",
  "function isMock() view returns (bool)",
]);
const reserveAbi = parseAbi(["function feeEscrow() view returns (address)"]);
const feeTreasuryAbi = parseAbi(["function owner() view returns (address)"]);
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
    name: expectedNames[index],
    address,
    hash: transaction.hash,
    blockNumber: BigInt(receipt.blockNumber),
  };
});

const feeTreasury = created[0].address;
const factory = created[1].address;
const client = createPublicClient({ transport: http(rpcUrl) });
if (await client.getChainId() !== chainId) throw new Error(`RPC is not RISE ${network.name}.`);
const services = await validateDeployment(client as unknown as Parameters<typeof validateDeployment>[0], factory, weth);
const expectedServices: Partial<Record<(typeof expectedNames)[number], Address>> = {
  CurveLaunchDeployer: services.deployer,
  CurveFeeEscrow: services.escrow,
  CurveBuybackVault: services.vault,
  CurveV1Locker: services.locker,
  CurveMemeHook: services.hook,
  CurveLaunchAndBuy: services.launchAndBuy,
  CurveHolderReserve: services.holderReserve,
  CurveV1PoolAdapter: services.venue,
};
for (const deployment of created.slice(2)) {
  if (expectedServices[deployment.name] !== deployment.address) {
    throw new Error(`${deployment.name} does not match factory wiring.`);
  }
}

const [owner, treasury, launchFee, launchFeeTreasury, graduationTarget, supply, curveSupply, initialVQ, publicLaunchOpen, venueFactory, isMock, reserveEscrow, feeTreasuryOwner] = await Promise.all([
  client.readContract({ address: factory, abi: factoryAbi, functionName: "owner" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "treasury" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "launchFee" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "launchFeeTreasury" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "graduationTarget" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "supply" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "curveSupply" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "initialVQ" }),
  client.readContract({ address: factory, abi: factoryAbi, functionName: "publicLaunchOpen" }),
  client.readContract({ address: services.venue, abi: venueAbi, functionName: "poolFactory" }),
  client.readContract({ address: services.venue, abi: venueAbi, functionName: "isMock" }),
  client.readContract({ address: services.holderReserve, abi: reserveAbi, functionName: "feeEscrow" }),
  client.readContract({ address: feeTreasury, abi: feeTreasuryAbi, functionName: "owner" }),
]);
if (
  !publicLaunchOpen ||
  isMock ||
  venueFactory !== icarusFactory ||
  reserveEscrow !== services.escrow ||
  launchFeeTreasury !== feeTreasury ||
  feeTreasuryOwner !== owner ||
  launchFee !== 1_000_000_000_000_000n
) {
  throw new Error(`${network.name} service policy mismatch.`);
}
if (supply !== 1_000_000n * 10n ** 18n || curveSupply !== 800_000n * 10n ** 18n) {
  throw new Error("Supply policy mismatch.");
}

const codeHashes: Record<string, Hex> = {};
const sourceVerification: Record<string, { name: string; url: string }> = {};
for (const deployment of created) {
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
  version: "current",
  release: network.name,
  chainId,
  sourceCommit: gitCommit,
  factory,
  deploymentBlock: created[1].blockNumber.toString(),
  quote: services.quote,
  icarusFactory,
  owner,
  treasury,
  launchFee: launchFee.toString(),
  launchFeeTreasury,
  graduationTarget: graduationTarget.toString(),
  supply: supply.toString(),
  curveSupply: curveSupply.toString(),
  initialVQ: initialVQ.toString(),
  services,
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
console.log(`Recorded Curveball factory ${factory} at block ${record.deploymentBlock}.`);
console.log(`VITE_LAUNCHPAD_ADDRESS=${factory}`);
console.log(`VITE_DEPLOYMENT_BLOCK=${record.deploymentBlock}`);
console.log(`KEEPER_FACTORY_ADDRESS=${factory}`);
console.log(`KEEPER_DEPLOYMENT_BLOCK=${record.deploymentBlock}`);
