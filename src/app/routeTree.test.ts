import { expect, test } from "bun:test";
import { resolveRoute, routeHref } from "./routeTree";

test("unknown routes fall through to not found", () => {
  expect(routeHref("markets")).toBe("/markets");
  expect(() => routeHref("home")).toThrow("Unknown route: home");
  expect(resolveRoute("/app").id).toBe("notFound");
  expect(resolveRoute("/beta/markets/0xabc").id).toBe("notFound");
});

test("admin dashboard has a direct route", () => {
  expect(resolveRoute("/admin").id).toBe("admin");
  expect(routeHref("admin")).toBe("/admin");
});

test("protocol stats has a direct route", () => {
  expect(resolveRoute("/stats").id).toBe("stats");
  expect(routeHref("stats")).toBe("/stats");
});

test("trader profile route resolves a wallet address", () => {
  expect(
    resolveRoute("/profile/0x5cc42e772f67089b4670eec4dcd904be2f2d511c").id,
  ).toBe("trader");
});
