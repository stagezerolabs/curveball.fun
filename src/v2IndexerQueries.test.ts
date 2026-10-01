import { expect, test } from "bun:test";
import { collectV2Logs } from "./v2IndexerQueries";

test("V2 indexer includes curves launched in the current batch and orders all events", async () => {
  const factory = "0x1111111111111111111111111111111111111111" as const;
  const curve = "0x2222222222222222222222222222222222222222" as const;
  const queried: string[] = [];
  const client = {
    getLogs: async (p: { address: string; event: { name: string } }) => {
      queried.push(`${p.address}:${p.event.name}`);
      if (p.event.name === "LaunchCreated") return [{ args: { token: factory, curve, creator: factory, name: "N", symbol: "N", uri: "" }, blockNumber: 10n, logIndex: 1, transactionHash: "0x01" }];
      if (p.event.name === "Trade" && p.address === curve) return [{ args: { token: factory, trader: factory, isBuy: true }, blockNumber: 10n, logIndex: 2, transactionHash: "0x01" }];
      return [];
    },
  };
  const logs = await collectV2Logs(client, { factory, escrow: factory, vault: factory, locker: factory, curves: [] }, 10n, 10n);
  expect(logs.map((log) => log.event)).toEqual(["LaunchCreated", "Trade"]);
  expect(queried).toContain(`${curve}:Trade`);
});

test("V2 indexer collects pool registration, deferral, and asset recovery across the lifecycle", async () => {
  const factory = "0x1111111111111111111111111111111111111111" as const;
  const curve = "0x2222222222222222222222222222222222222222" as const;
  const locker = "0x3333333333333333333333333333333333333333" as const;
  const client = {
    getLogs: async (p: { address: string; event: { name: string } }) => {
      const event = p.event.name;
      if (event === "LaunchCreated") return [{ args: { token: factory, curve, creator: factory, name: "N", symbol: "N", uri: "" }, blockNumber: 1n, logIndex: 0, transactionHash: "0x01" }];
      if (event === "GraduationDeferred") return [{ args: { token: factory, reason: "0x" }, blockNumber: 2n, logIndex: 0, transactionHash: "0x02" }];
      if (event === "PoolRegistered" && p.address === locker) return [{ args: { token: factory, pool: curve, creator: factory }, blockNumber: 3n, logIndex: 0, transactionHash: "0x03" }];
      if (event === "TokensRescued" && p.address === curve) return [{ args: { asset: factory, amount: 1n, recipient: factory }, blockNumber: 4n, logIndex: 0, transactionHash: "0x04" }];
      return [];
    },
  };
  const logs = await collectV2Logs(client, { factory, escrow: factory, vault: factory, locker, curves: [] }, 1n, 4n);
  expect(logs.map((log) => log.event)).toEqual(["LaunchCreated", "GraduationDeferred", "PoolRegistered", "TokensRescued"]);
  expect(logs.at(-1)?.source).toBe(curve);
});
