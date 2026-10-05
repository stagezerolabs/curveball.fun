import { expect, test } from "bun:test";
import { getAddress, zeroAddress } from "viem";
import { validateV2Deployment } from "./v2Deployment";

const factory = getAddress("0x1111111111111111111111111111111111111111");
const quote = getAddress("0x4200000000000000000000000000000000000006");
const service = getAddress("0x2222222222222222222222222222222222222222");

test("V2 health rejects a factory that has not finished service initialization", async () => {
  const client = {
    getBytecode: async () => "0x6000" as const,
    readContract: async (p: { functionName: string }) => p.functionName === "quote" ? quote : zeroAddress,
  };
  await expect(validateV2Deployment(client, factory, quote)).rejects.toThrow("not initialized");
});

test("V2 health accepts the configured quote and deployed services", async () => {
  const client = {
    getBytecode: async () => "0x6000" as const,
    readContract: async (p: { functionName: string }) => p.functionName === "quote" ? quote : service,
  };
  expect(await validateV2Deployment(client, factory, quote)).toMatchObject({ quote, deployer: service });
});
