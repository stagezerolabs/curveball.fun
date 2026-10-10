import { createPublicClient, getAddress, http, parseAbi, type Address, type Hash } from "viem";
import { riseTestnet } from "viem/chains";

const rpc = Bun.env.RISE_TESTNET_RPC_URL;
if (!rpc?.startsWith("https://")) throw new Error("Set an HTTPS RISE_TESTNET_RPC_URL.");
const client = createPublicClient({ chain: riseTestnet, transport: http(rpc) });
if (await client.getChainId() !== 11_155_931) throw new Error("RPC is not RISE Testnet.");

const broadcast = await Bun.file("broadcast/DeployAsdBridge.s.sol/11155931/run-latest.json").json();
const creations = (broadcast.transactions as Array<{ contractName: string; transactionType: string; contractAddress: Address; hash: Hash }>).filter(
  (tx) => tx.contractName === "MockQuoteBridge" && tx.transactionType === "CREATE",
);
if (creations.length !== 1) throw new Error("Expected exactly one MockQuoteBridge deployment.");
const creation = creations[0];
const bridge = getAddress(creation.contractAddress);
const receipt = await client.getTransactionReceipt({ hash: creation.hash });
if (receipt.status !== "success" || !receipt.contractAddress || getAddress(receipt.contractAddress) !== bridge) {
  throw new Error("Bridge deployment receipt does not match the broadcast.");
}

const bridgeAbi = parseAbi([
  "function mockQuote() view returns (address)",
  "function weth() view returns (address)",
]);
const erc20Abi = parseAbi(["function balanceOf(address) view returns (uint256)"]);
const [mockQuote, weth, reserve] = await Promise.all([
  client.readContract({ address: bridge, abi: bridgeAbi, functionName: "mockQuote" }),
  client.readContract({ address: bridge, abi: bridgeAbi, functionName: "weth" }),
  client.readContract({ address: "0x4200000000000000000000000000000000000006", abi: erc20Abi, functionName: "balanceOf", args: [bridge] }),
]);
if (getAddress(mockQuote) !== getAddress("0x19556A38028A4018bae295670DAeCB1e74bd9f20") ||
    getAddress(weth) !== getAddress("0x4200000000000000000000000000000000000006") ||
    reserve !== 20_000_000_000_000_000n) {
  throw new Error("Bridge assets or funded reserve differ from the deployment plan.");
}

const record = { chainId: 11_155_931, bridge, deploymentBlock: receipt.blockNumber.toString(), transactionHash: receipt.transactionHash, reserveWei: reserve.toString() };
await Bun.write("../deployments/11155931/asd-bridge.json", `${JSON.stringify(record, null, 2)}\n`);
console.log(`Recorded funded ASD bridge ${bridge} at block ${record.deploymentBlock}`);
