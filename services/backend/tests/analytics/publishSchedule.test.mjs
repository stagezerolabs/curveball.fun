import { describe, expect, test } from "bun:test";

import {
  publishAsOfBlock,
  shouldPublish,
} from "../../src/analytics/publishSchedule.mjs";

const now = 10_000_000;
const ago = (seconds) => now - seconds * 1000;

describe("leaderboard publish schedule", () => {
  test("coalesces dirty publishes to once per 60s and refreshes every 300s", () => {
    expect(shouldPublish({ dirty: true, lastPublishedAt: ago(59), now })).toBe(false);
    expect(shouldPublish({ dirty: true, lastPublishedAt: ago(60), now })).toBe(true);
    expect(shouldPublish({ dirty: false, lastPublishedAt: ago(299), now })).toBe(false);
    expect(shouldPublish({ dirty: false, lastPublishedAt: ago(300), now })).toBe(true);
  });

  test("publishes when never published", () => {
    expect(shouldPublish({ dirty: false, lastPublishedAt: null, now })).toBe(true);
  });

  test("as-of block trails every cursor and the 20-block depth", () => {
    expect(
      publishAsOfBlock({ head: 1000n, cursors: { trades: 995n, ledger: 990n } }),
    ).toBe(980n);
    expect(
      publishAsOfBlock({ head: 1000n, cursors: { trades: 970n, ledger: 990n } }),
    ).toBe(969n);
  });

  test("no publish block before anything is indexed", () => {
    expect(
      publishAsOfBlock({ head: 10n, cursors: { trades: 0n, ledger: 0n } }),
    ).toBeNull();
  });
});
