import { expect, test } from "bun:test";
import { canonicalPathname, resolveRoute, routeHref } from "./routeTree";

test("the old app URL resolves to the single markets page", () => {
  expect(canonicalPathname("/app")).toBe("/markets");
  expect(canonicalPathname("/app/")).toBe("/markets");
  expect(resolveRoute("/app").id).toBe("markets");
  expect(routeHref("markets")).toBe("/markets");
  expect(() => routeHref("home")).toThrow("Unknown route: home");
});
