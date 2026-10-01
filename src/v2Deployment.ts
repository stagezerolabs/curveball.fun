import { getAddress, zeroAddress, type Address, type Hex } from "viem";
import { v2FactoryAbi } from "./sdk/v2Contracts";

export type V2DeploymentClient = {
  getBytecode(parameters: { address: Address }): Promise<Hex | undefined>;
  readContract(parameters: { address: Address; abi: unknown; functionName: string }): Promise<unknown>;
};

export async function validateV2Deployment(client: V2DeploymentClient, factory: Address, expectedQuote?: Address) {
  const names = ["quote", "deployer", "escrow", "vault", "guard", "executor", "locker", "hook", "launchAndBuy"] as const;
  const [factoryCode, values] = await Promise.all([
    client.getBytecode({ address: factory }),
    Promise.all(names.map((functionName) => client.readContract({ address: factory, abi: v2FactoryAbi, functionName }))),
  ]);
  if (!factoryCode || factoryCode === "0x") throw new Error("V2 factory has no deployed code.");
  const addresses = Object.fromEntries(names.map((name, index) => [name, getAddress(values[index] as string)])) as Record<typeof names[number], Address>;
  if (expectedQuote && addresses.quote !== getAddress(expectedQuote)) throw new Error("V2 quote token mismatch.");
  if (names.slice(1).some((name) => addresses[name] === zeroAddress)) throw new Error("V2 factory is not initialized.");
  const codes = await Promise.all(names.slice(1).map((name) => client.getBytecode({ address: addresses[name] })));
  if (codes.some((code) => !code || code === "0x")) throw new Error("V2 service has no deployed code.");
  return addresses;
}
