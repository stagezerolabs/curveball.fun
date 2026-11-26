import { describe, expect, test } from "bun:test";

import { replayWallet } from "../../src/analytics/positionLedger.mjs";
import { E, LAUNCHPAD, eventFactory } from "./ledgerFixtures.mjs";

const W = "0xwallet";
const R = "0xrecipient";
const CREATOR = "0xcreator";
const milli = (n) => (BigInt(n) * E) / 1000n;

function replay(f, wallet = W, creatorByToken = new Map()) {
  return replayWallet({
    wallet,
    events: f.forWallet(wallet),
    launchpadAddress: LAUNCHPAD,
    creatorByToken,
  });
}

describe("replayWallet", () => {
  test("removed cost rounds up and sums to basis", () => {
    const f = eventFactory();
    f.buy(W, "0xa", 3n, 100n);
    f.sell(W, "0xa", 1n, 40n);
    f.sell(W, "0xa", 1n, 40n);
    f.sell(W, "0xa", 1n, 40n);
    const result = replay(f);
    const position = result.perToken.get("0xa");
    expect(result.trades.filter((t) => !t.isBuy).map((t) => t.removedCost)).toEqual(
      [34n, 33n, 33n],
    );
    expect(position.realizedCost).toBe(100n);
    expect(position.remainingCost).toBe(0n);
    expect(position.realizedPnl).toBe(20n);
  });

  test("peak capital does not double count recycled capital", () => {
    const f = eventFactory();
    f.buy(W, "0xa", 1000n, milli(50));
    f.buy(W, "0xb", 1000n, milli(30));
    f.sell(W, "0xa", 400n, milli(30));
    f.buy(W, "0xc", 1000n, milli(40));
    const result = replay(f);
    expect(result.perToken.get("0xa").realizedPnl).toBe(milli(10));
    expect(result.peakCapital).toBe(100000000000000000n);
  });

  test("transfer-out realizes a loss at zero proceeds", () => {
    const f = eventFactory();
    f.buy(W, "0xa", 1000n, milli(50));
    f.transfer(W, R, "0xa", 500n);
    const position = replay(f).perToken.get("0xa");
    expect(position.realizedPnl).toBe(-25000000000000000n);
    expect(position.remainingCost).toBe(25000000000000000n);
    expect(position.knownBalance).toBe(500n);
    expect(position.markableBalance).toBe(500n);
    expect(position.transferOutCount).toBe(1);
  });

  test("recipient of transferred tokens earns nothing", () => {
    const f = eventFactory();
    f.buy(W, "0xa", 1000n, milli(50));
    f.transfer(W, R, "0xa", 500n);
    f.sell(R, "0xa", 500n, milli(30));
    const position = replay(f, R).perToken.get("0xa");
    expect(position.realizedPnl).toBe(0n);
    expect(position.unknownSold).toBe(500n);
    expect(position.markableBalance).toBe(0n);
  });

  test("inbound tokens add no basis and no markable value", () => {
    const f = eventFactory();
    f.buy(W, "0xa", 1000n, milli(50));
    f.transfer(W, R, "0xa", 500n);
    const position = replay(f, R).perToken.get("0xa");
    expect(position.knownBalance).toBe(0n);
    expect(position.markableBalance).toBe(0n);
    expect(position.onchainBalance).toBe(500n);
  });

  test("curve sell legs are not double counted as transfers", () => {
    const f = eventFactory();
    f.buy(W, "0xa", 1000n, milli(50));
    f.sell(W, "0xa", 1000n, milli(60));
    const result = replay(f);
    const position = result.perToken.get("0xa");
    expect(position.realizedPnl).toBe(milli(10));
    expect(position.transferOutCount).toBe(0);
    expect(position.onchainBalance).toBe(0n);
    expect(result.trades).toHaveLength(2);
  });

  test("creator-own trades are excluded", () => {
    const f = eventFactory();
    f.buy(CREATOR, "0xown", 1000n, milli(50));
    f.sell(CREATOR, "0xown", 1000n, milli(90));
    f.buy(CREATOR, "0xother", 1000n, milli(20));
    const result = replay(f, CREATOR, new Map([["0xown", CREATOR]]));
    expect(result.perToken.has("0xown")).toBe(false);
    expect(result.excludedCreatorTrades).toBe(2);
    expect(result.trades).toHaveLength(1);
    expect(result.peakCapital).toBe(milli(20));
  });

  test("sum of per-token realized P&L equals wallet realized P&L", () => {
    const f = eventFactory();
    f.buy(W, "0xa", 3n, 100n);
    f.sell(W, "0xa", 1n, 40n);
    f.buy(W, "0xb", 1000n, milli(50));
    f.transfer(W, R, "0xb", 300n);
    f.sell(W, "0xb", 200n, milli(5));
    f.buy(W, "0xc", 1000n, milli(30));
    f.sell(W, "0xc", 1000n, milli(31));
    const result = replay(f);
    let sum = 0n;
    for (const position of result.perToken.values()) sum += position.realizedPnl;
    expect(sum).toBe(result.realizedPnl);
    expect(result.entityId).toBe(W);
  });
});
