import assert from "node:assert/strict";
import test from "node:test";
import { mockPulseMoments } from "./mockPulse";

const asOf = Date.parse("2026-10-19T12:00:00Z");

test("mock Now and Following respect the selected time window", () => {
  assert.equal(mockPulseMoments("now", "1h", asOf).length, 2);
  assert.equal(mockPulseMoments("now", "24h", asOf).length, 4);
  assert.equal(mockPulseMoments("following", "1h", asOf).length, 2);
  assert.equal(mockPulseMoments("following", "24h", asOf).length, 3);
});

test("mock Following values stay internally consistent", () => {
  for (const moment of mockPulseMoments("following", "24h", asOf)) {
    assert.equal(moment.reason, "following");
    assert.equal(moment.followedTraderCount, moment.distinctWalletCount);
    assert.equal(moment.buyCount + moment.sellCount, moment.tradeCount);
    assert.equal(BigInt(moment.buyQuoteWei) - BigInt(moment.sellQuoteWei), BigInt(moment.netQuoteWei));
  }
});
