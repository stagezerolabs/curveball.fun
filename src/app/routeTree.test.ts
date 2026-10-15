import { expect, test } from "bun:test";
import { resolveRoute, routeHref } from "./routeTree";

test("unknown routes throw and retired URLs fall through to not found", () => {
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
