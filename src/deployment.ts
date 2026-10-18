import { getAddress, type Address, type Hex } from "viem";
import { curveFeeEscrowAbi, curveHolderReserveAbi, curveLaunchpadAbi, curveLpLockerAbi } from "./sdk/contracts";

export type DeploymentClient = {
  getBytecode(parameters: { address: Address }): Promise<Hex | undefined>;
  readContract(parameters: { address: Address; abi: unknown; functionName: string }): Promise<unknown>;
};

export type LaunchpadDeployment = {
  launchpad: Address;
  escrow: Address;
  locker: Address;
  reserve: Address;
  tokenImplementation: Address;
  quoteToken: Address;
  icarusFactory: Address;
};

/** Reads a lean launchpad's singletons and checks that each one has code and points back at it. */
export async function validateLaunchpad(client: DeploymentClient, launchpad: Address, expectedQuote?: Address): Promise<LaunchpadDeployment> {
  const read = async (address: Address, abi: unknown, functionName: string) =>
    getAddress(await client.readContract({ address, abi, functionName }) as string);
  if (!await hasCode(client, launchpad)) throw new Error("Launchpad has no deployed code.");
  const [escrow, locker, reserve, tokenImplementation, quoteToken, icarusFactory] = await Promise.all(
    ["escrow", "locker", "reserve", "tokenImplementation", "quoteToken", "icarusFactory"]
      .map((functionName) => read(launchpad, curveLaunchpadAbi, functionName)),
  );
  if (expectedQuote && quoteToken !== getAddress(expectedQuote)) throw new Error("Quote token mismatch.");
  const singletons = { escrow, locker, reserve, tokenImplementation };
  for (const [name, address] of Object.entries(singletons)) {
    if (!await hasCode(client, address)) throw new Error(`${name} has no deployed code.`);
  }
  const backPointers = await Promise.all([
    read(escrow, curveFeeEscrowAbi, "launchpad"),
    read(locker, curveLpLockerAbi, "launchpad"),
    read(reserve, curveHolderReserveAbi, "launchpad"),
  ]);
  if (backPointers.some((pointer) => pointer !== getAddress(launchpad))) throw new Error("A singleton points at another launchpad.");
  if (await read(locker, curveLpLockerAbi, "escrow") !== escrow) throw new Error("Locker points at another escrow.");
  return { launchpad: getAddress(launchpad), ...singletons, quoteToken, icarusFactory };
}

async function hasCode(client: DeploymentClient, address: Address) {
  const code = await client.getBytecode({ address });
  return Boolean(code && code !== "0x");
}
