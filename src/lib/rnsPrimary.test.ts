import { describe, expect, test } from "bun:test";
import { parseRnsPrimaryName } from "./rnsPrimary";

const wallet = "0x0000000000000000000000000000000000000001";
const active = {
  chainId: 4153,
  address: wallet,
  primaryName: "alice.rise",
  isExpired: false,
  expiry: "1893456000",
};

describe("RNS primary name response", () => {
  test("accepts an active Mainnet primary name for the connected wallet", () => {
    expect(parseRnsPrimaryName(active, wallet)).toBe("alice.rise");
  });

  test("falls back to the address when the response is for another wallet or network", () => {
    expect(parseRnsPrimaryName({ ...active, address: "0x0000000000000000000000000000000000000002" }, wallet)).toBeNull();
    expect(parseRnsPrimaryName({ ...active, chainId: 11155931 }, wallet)).toBeNull();
  });

  test("rejects expired, malformed, and missing primary names", () => {
    expect(parseRnsPrimaryName({ ...active, isExpired: true }, wallet)).toBeNull();
    expect(parseRnsPrimaryName({ ...active, expiry: "1" }, wallet)).toBeNull();
    expect(parseRnsPrimaryName({ ...active, primaryName: "alice.eth" }, wallet)).toBeNull();
    expect(parseRnsPrimaryName({ ...active, primaryName: null }, wallet)).toBeNull();
  });
});
