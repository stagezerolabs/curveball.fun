import { expect, test } from "bun:test";
import { canonicalPathname, resolveRoute, routeHref } from "./routeTree";

test("the old app URL resolves to the single markets page", () => {
  expect(canonicalPathname("/app")).toBe("/markets");
  expect(canonicalPathname("/app/")).toBe("/markets");
  expect(resolveRoute("/app").id).toBe("markets");
  expect(routeHref("markets")).toBe("/markets");
  expect(() => routeHref("home")).toThrow("Unknown route: home");
});

test("old beta URLs resolve to the main markets", () => {
  expect(resolveRoute("/beta").id).toBe("markets");
  expect(resolveRoute("/beta/markets").id).toBe("markets");
  expect(canonicalPathname("/beta/markets/0xabc")).toBe("/markets/0xabc");
  expect(resolveRoute("/beta/markets/0xabc")).toEqual({
    id: "market", params: { address: "0xabc" }, title: "Market — Curveball",
  });
});

test("retired migration links open the active markets", () => {
  expect(canonicalPathname("/migration")).toBe("/markets");
  expect(resolveRoute("/migration").id).toBe("markets");
  expect(() => routeHref("migration")).toThrow("Unknown route: migration");
});

test("admin dashboard has a direct route", () => {
  expect(resolveRoute("/admin").id).toBe("admin");
  expect(routeHref("admin")).toBe("/admin");
});

test("protocol stats has a direct route", () => {
  expect(resolveRoute("/stats").id).toBe("stats");
  expect(routeHref("stats")).toBe("/stats");
});
