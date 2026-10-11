import { expect, test } from "bun:test";
import { getAddress, type Address } from "viem";
import previousDeployment from "../../deployments/11155931/curveball-v2.json";
import { listPreviousLaunches, type PreviousLaunchClient } from "./previousLaunches";

test("lists launches from the previous factory with token and creator addresses", async () => {
  const token = "0x1111111111111111111111111111111111111111" as Address;
  const creator = "0x2222222222222222222222222222222222222222" as Address;
  const queries: { address: Address; fromBlock: bigint; toBlock: bigint }[] = [];
  const client = {
    getBlockNumber: async () => 56_102_377n,
    getContractEvents: async (query: { address: Address; fromBlock: bigint; toBlock: bigint }) => {
      queries.push(query);
      return [{ args: { token, creator, name: "First", symbol: "ONE" }, blockNumber: 56_102_377n }];
    },
  } as PreviousLaunchClient;

  expect(await listPreviousLaunches(client)).toEqual([{ token, creator, name: "First", symbol: "ONE", blockNumber: 56_102_377n }]);
  expect(queries).toHaveLength(1);
  expect(queries[0]).toMatchObject({ address: getAddress(previousDeployment.factory), fromBlock: 56_102_377n, toBlock: 56_102_377n });
});
