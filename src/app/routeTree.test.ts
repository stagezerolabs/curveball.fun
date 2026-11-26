import { expect, test } from "bun:test";
import { resolveRoute, routeHref, showsMarketTape } from "./routeTree";

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

test("documentation pages have shareable routes", () => {
  expect(routeHref("docs")).toBe("/docs");
  expect(routeHref("docsPage", { slug: "trading" })).toBe("/docs/trading");
  expect(resolveRoute("/docs").id).toBe("docs");
  expect(resolveRoute("/docs/trading").params.slug).toBe("trading");
});

test("trader profile route resolves a wallet address", () => {
  expect(
    resolveRoute("/profile/0x5cc42e772f67089b4670eec4dcd904be2f2d511c").id,
  ).toBe("trader");
});

test("your dashboard lives at /dashboard; /profile is gone", () => {
  expect(routeHref("dashboard")).toBe("/dashboard");
  expect(resolveRoute("/dashboard").id).toBe("dashboard");
  expect(resolveRoute("/profile").id).toBe("notFound");
});

test("the market tape shows only on landing, explore, and pulse", () => {
  expect(showsMarketTape("landing")).toBe(true);
  expect(showsMarketTape("markets")).toBe(true);
  expect(showsMarketTape("social")).toBe(true);
  expect(showsMarketTape("dashboard")).toBe(false);
  expect(showsMarketTape("docs")).toBe(false);
});
