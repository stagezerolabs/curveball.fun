import { describe, expect, test } from "bun:test";
import { readCachedLaunches, readCachedPayout, writeCachedLaunches, writeCachedPayout } from "./landingStatsCache";

function memoryStorage() {
  const entries = new Map<string, string>();
  return {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => { entries.set(key, value); },
  };
}

const token = { address: "0x1111111111111111111111111111111111111111" as const, creator: "0x2222222222222222222222222222222222222222" as const, graduated: false };

describe("landing stats cache", () => {
  test("restores launch counts and creator payout with their fetch times", () => {
    const storage = memoryStorage();
    writeCachedLaunches("network-a", [token], 100, storage);
    writeCachedPayout("network-a", { amount: 1234567890123456789n, decimals: 18 }, 200, storage);
    expect(readCachedLaunches("network-a", storage)).toEqual({ value: [token], updatedAt: 100 });
    expect(readCachedPayout("network-a", storage)).toEqual({ value: { amount: 1234567890123456789n, decimals: 18 }, updatedAt: 200 });
    expect(readCachedLaunches("network-b", storage)).toBeNull();
  });

  test("ignores malformed stored data", () => {
    const storage = memoryStorage();
    storage.setItem("bad:launches", JSON.stringify({ updatedAt: 100, value: [{ address: "bad", creator: "bad", graduated: false }] }));
    storage.setItem("bad:payout", JSON.stringify({ updatedAt: 100, value: { amount: "oops", decimals: 18 } }));
    expect(readCachedLaunches("bad", storage)).toBeNull();
    expect(readCachedPayout("bad", storage)).toBeNull();
  });
});
