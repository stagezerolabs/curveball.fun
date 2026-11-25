import { createPublicClient, getAddress, http, isAddress, parseAbi, zeroAddress } from "viem";

function parseDeployment(value: unknown, chainId: number) {
  if (
    typeof value !== "object" || value === null ||
    !("chainId" in value) || !("version" in value) ||
    !("launchpad" in value) || !("singletons" in value)
  ) throw new Error("Invalid oracle-v3 deployment record.");
  const singletons = value.singletons;
  if (typeof singletons !== "object" || singletons === null || !("buybackTreasury" in singletons))
    throw new Error("Invalid oracle-v3 deployment record.");
  if (
    value.chainId !== chainId || value.version !== "oracle-v3" ||
    typeof value.launchpad !== "string" || !isAddress(value.launchpad) ||
    typeof singletons.buybackTreasury !== "string" || !isAddress(singletons.buybackTreasury)
  ) throw new Error("Invalid oracle-v3 deployment record.");
  return { launchpad: getAddress(value.launchpad), buybackTreasury: getAddress(singletons.buybackTreasury) };
}

const chainId = Number(Bun.env.CURVE_CHAIN_ID);
const rpcUrl = Bun.env.CURVE_RPC_URL;
const expectedToken = Bun.env.CURVE_TOKEN_ADDRESS;
if (!Number.isSafeInteger(chainId) || !rpcUrl?.startsWith("https://") || !expectedToken || !isAddress(expectedToken))
  throw new Error("Set CURVE_CHAIN_ID, an HTTPS CURVE_RPC_URL, and CURVE_TOKEN_ADDRESS.");
const rawDeployment: unknown = await Bun.file(`deployments/${chainId}/curveball-oracle-v3.json`).json();
const deployment = parseDeployment(rawDeployment, chainId);
const client = createPublicClient({ transport: http(rpcUrl) });
if ((await client.getChainId()) !== chainId) throw new Error("RPC chain mismatch.");
const treasury = deployment.buybackTreasury;
const launchpad = deployment.launchpad;
const token = getAddress(await client.readContract({
  address: treasury,
  abi: parseAbi(["function curveToken() view returns (address)"]),
  functionName: "curveToken",
}));
if (token === zeroAddress || token !== getAddress(expectedToken))
  throw new Error("Selected treasury token does not match CURVE_TOKEN_ADDRESS.");
const wiredLaunchpad = await client.readContract({
  address: treasury,
  abi: parseAbi(["function launchpad() view returns (address)"]),
  functionName: "launchpad",
});
if (wiredLaunchpad !== launchpad)
  throw new Error("Buyback treasury points at another launchpad.");
const pool = await client.readContract({
  address: launchpad,
  abi: parseAbi(["function poolOf(address token) view returns (address)"]),
  functionName: "poolOf", args: [token],
});
if (pool === zeroAddress)
  throw new Error("CURVE is not graduated.");
const path = `deployments/${chainId}/curve-activation.json`;
if (await Bun.file(path).exists()) throw new Error(`Refusing to overwrite ${path}.`);
await Bun.write(path, `${JSON.stringify({chainId, version: "oracle-v3", launchpad, buybackTreasury: treasury, curveToken: token, pool}, null, 2)}\n`);
