import { describe, expect, test } from "bun:test";
import { getAddress } from "viem";

const configured = "0x5cc42e772f67089b4670eec4dcd904be2f2d511c";
process.env.VITE_ADMIN_ADDRESS = configured;
const { ADMIN_ADDRESS, isAdminAddress } = await import("./adminAccess");

describe("admin access", () => {
  test("recognizes only the configured connected wallet", () => {
    expect(
      isAdminAddress(getAddress("0x5cc42e772f67089b4670eec4dcd904be2f2d511c")),
    ).toBe(true);
    expect(
      isAdminAddress(getAddress("0x0000000000000000000000000000000000000001")),
    ).toBe(false);
    expect(isAdminAddress(undefined)).toBe(false);
    expect(ADMIN_ADDRESS.toLowerCase()).toBe(
      "0x5cc42e772f67089b4670eec4dcd904be2f2d511c",
    );
  });
});
