import { createPublicClient, getAddress, http, parseAbi } from "viem";

const chainId = Number(Bun.env.CURVE_CHAIN_ID);
const rpcUrl = Bun.env.CURVE_RPC_URL;
if (!Number.isSafeInteger(chainId) || !rpcUrl?.startsWith("https://"))
  throw new Error("Set CURVE_CHAIN_ID and an HTTPS CURVE_RPC_URL.");
const deployment = (await Bun.file(`deployments/${chainId}/curveball.json`).json()) as {
  launchpad: string;
  singletons: { buybackTreasury: string };
};
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== chainId) throw new Error("RPC chain mismatch.");
const treasury = getAddress(deployment.singletons.buybackTreasury);
const token = getAddress(await client.readContract({
  address: treasury,
  abi: parseAbi(["function curveToken() view returns (address)"]),
  functionName: "curveToken",
}));
const pool = await client.readContract({
  address: getAddress(deployment.launchpad),
  abi: parseAbi(["function poolOf(address token) view returns (address)"]),
  functionName: "poolOf", args: [token],
});
if (pool === "0x0000000000000000000000000000000000000000")
  throw new Error("CURVE is not graduated.");
const path = `deployments/${chainId}/curve-activation.json`;
if (await Bun.file(path).exists()) throw new Error(`Refusing to overwrite ${path}.`);
await Bun.write(path, `${JSON.stringify({chainId, launchpad: deployment.launchpad, buybackTreasury: treasury, curveToken: token, pool}, null, 2)}\n`);
