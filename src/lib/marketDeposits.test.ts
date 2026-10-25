import { describe, expect, test } from "bun:test";
import type { Address, Hash } from "viem";
import type { TradeActivity } from "./marketChart";
import { buildMarketDepositPoints, depositsInRange } from "./marketDeposits";

const address = "0x0000000000000000000000000000000000000001" as Address;
const hash = `0x${"a".repeat(64)}` as Hash;

function trade(
  timestamp: number,
  virtualQuoteAfter?: bigint,
  venue: TradeActivity["venue"] = "curve",
): TradeActivity {
  return {
    trader: address,
    participantRole: "trader",
    venue,
    isBuy: true,
    tokenAmount: 1n,
    quoteAmount: 1n,
    ...(virtualQuoteAfter === undefined ? {} : { virtualQuoteAfter }),
    timestamp,
    blockNumber: BigInt(timestamp),
    logIndex: 0,
    transactionHash: hash,
  };
}

describe("market deposit history", () => {
  test("subtracts the virtual seed and ignores pool swaps", () => {
    expect(
      buildMarketDepositPoints(
        [
          trade(30, 4_000000000000000000n),
          trade(10, 3_000000000000000000n),
          trade(40, undefined, "pool"),
        ],
        "2500000000000000000",
      ),
    ).toEqual([
      { time: 10, value: 0.5 },
      { time: 30, value: 1.5 },
    ]);
  });

  test("carries the prior balance into a selected range", () => {
    const day = 86_400;
    expect(
      depositsInRange(
        [
          { time: 0, value: 1 },
          { time: day * 6, value: 2 },
          { time: day * 8, value: 3 },
        ],
        "week",
      ),
    ).toEqual([
      { time: day, value: 1 },
      { time: day * 6, value: 2 },
      { time: day * 8, value: 3 },
    ]);
  });
});
