import { expect, test } from "bun:test";
import { selectProfileAuthView } from "./profileAuthGate";

test("loading covers the window before Privy has restored the session", () => {
  expect(
    selectProfileAuthView({
      ready: false,
      authenticated: false,
      hasAddress: false,
    }),
  ).toBe("loading");
  expect(
    selectProfileAuthView({
      ready: false,
      authenticated: true,
      hasAddress: false,
    }),
  ).toBe("loading");
});

test("an authenticated session whose wallet is still syncing is restoring, never a login prompt", () => {
  expect(
    selectProfileAuthView({
      ready: true,
      authenticated: true,
      hasAddress: false,
    }),
  ).toBe("restoring");
});

test("sign-in is offered only when ready and not authenticated", () => {
  expect(
    selectProfileAuthView({
      ready: true,
      authenticated: false,
      hasAddress: false,
    }),
  ).toBe("login");
  expect(
    selectProfileAuthView({
      ready: true,
      authenticated: true,
      hasAddress: true,
    }),
  ).toBe("ready");
});
