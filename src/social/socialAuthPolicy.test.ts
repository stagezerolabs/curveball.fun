import { describe, expect, test } from "bun:test";
import { createSocialAuthRequestGate, selectSocialAuthAction } from "./socialAuthPolicy";

describe("social authentication policy", () => {
  test("does not reopen login after Privy authenticated while the wallet address hydrates", () => {
    expect(selectSocialAuthAction({
      ready: true,
      authenticated: true,
      hasAddress: false,
    })).toBe("await-wallet");
  });

  test("deduplicates concurrent sign-in requests", async () => {
    const gate = createSocialAuthRequestGate<string>();
    let loginPrompts = 0;

    const first = gate.request(() => { loginPrompts += 1; });
    const second = gate.request(() => { loginPrompts += 1; });
    gate.resolve("0xwallet");

    expect(first).toBe(second);
    expect(loginPrompts).toBe(1);
    expect(await first).toBe("0xwallet");
    expect(await second).toBe("0xwallet");
  });
});
