import { createPublicClient, getAddress, http, keccak256, type Address } from "viem";
import { resolveV2Broadcast } from "../../scripts/v2Broadcast";
import { v2FactoryAbi } from "../../src/sdk/v2Contracts";
import { validateV2Deployment } from "../../src/v2Deployment";

const outputPath = "deployments/11155931/curveball-v2-permissionless.json";
const broadcastPath = "contracts/broadcast/DeployPermissionlessV2.s.sol/11155931/run-latest.json";
const rpcUrl = Bun.env.RISE_TESTNET_RPC_URL;
if (!rpcUrl?.startsWith("https://")) throw new Error("RISE_TESTNET_RPC_URL must be HTTPS.");
if (Bun.env.CONFIRM_RECORD_PERMISSIONLESS_V2 !== "RECORD_PERMISSIONLESS_CURVEBALL_V2_RISE_TESTNET_11155931") {
  throw new Error("Replacement record confirmation missing.");
}
if (await Bun.file(outputPath).exists()) throw new Error(`Refusing to overwrite ${outputPath}.`);

const { creates, factory, initializeHash } = resolveV2Broadcast(await Bun.file(broadcastPath).json());
const client = createPublicClient({ transport: http(rpcUrl) });
if (await client.getChainId() !== 11_155_931) throw new Error("RPC is not RISE Testnet.");
const services = await validateV2Deployment(
  client as Parameters<typeof validateV2Deployment>[0], factory,
  getAddress("0x4200000000000000000000000000000000000006"),
);
const expectedServices = [services.deployer, services.escrow, services.vault, services.guard, services.locker, services.executor, services.hook, services.launchAndBuy];
if (creates.slice(1).some((tx, i) => tx.address !== expectedServices[i])) throw new Error("Broadcast services do not match factory wiring.");
const receipts = await Promise.all([...creates.map((tx) => tx.hash), initializeHash].map((hash) =>
  client.getTransactionReceipt({ hash: hash as `0x${string}` }),
));
for (let i = 0; i < creates.length; i++) {
  const receipt = receipts[i];
  if (receipt.status !== "success" || !receipt.contractAddress || getAddress(receipt.contractAddress) !== creates[i].address) {
    throw new Error(`Live ${creates[i].name} receipt mismatch.`);
  }
}
const initialization = receipts.at(-1)!;
if (initialization.status !== "success" || !initialization.to || getAddress(initialization.to) !== factory) {
  throw new Error("Live initialization receipt mismatch.");
}
const [icarusFactory, treasury, owner, supply, curveSupply, initialVQ, permissionless] = await Promise.all([
  client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "icarusFactory" }),
  client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "treasury" }),
  client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "owner" }),
  client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "supply" }),
  client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "curveSupply" }),
  client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "initialVQ" }),
  client.readContract({ address: factory, abi: v2FactoryAbi, functionName: "publicLaunchOpen" }),
]);
if (icarusFactory !== getAddress("0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9")
  || treasury !== getAddress("0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3") || owner !== treasury) {
  throw new Error("Canonical dependency or owner mismatch.");
}
if (!permissionless) throw new Error("Replacement factory is not permissionless.");
if (supply !== 1_000_000n * 10n ** 18n || curveSupply !== 800_000n * 10n ** 18n || initialVQ !== 10n * 10n ** 18n) {
  throw new Error("Curve constants mismatch.");
}
const codeHashes: Record<string, string> = {};
for (const [name, address] of Object.entries({ factory, ...services })) {
  const code = await client.getBytecode({ address: address as Address });
  if (!code || code === "0x") throw new Error(`${name} has no code.`);
  codeHashes[name] = keccak256(code);
}
const record = {
  version: "v2", release: "permissionless", chainId: 11_155_931, factory,
  deploymentBlock: receipts[0].blockNumber.toString(), quote: services.quote, icarusFactory, treasury,
  supply: supply.toString(), curveSupply: curveSupply.toString(), initialVQ: initialVQ.toString(),
  permissionless, services, codeHashes,
  transactions: creates.map((tx) => ({ name: tx.name, hash: tx.hash, address: tx.address })),
  initialization: { hash: initializeHash, blockNumber: initialization.blockNumber.toString() },
};
await Bun.write(outputPath, `${JSON.stringify(record, null, 2)}\n`);
console.log(`Recorded permissionless V2 factory ${factory} at block ${receipts[0].blockNumber}`);
