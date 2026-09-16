import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoute, routeHref } from "./routeTree.js";

test("resolves static and nested dynamic routes", () => {
  assert.deepEqual(resolveRoute("/markets"), {
    id: "markets",
    params: {},
    title: "Markets — Curveball",
  });
  assert.deepEqual(resolveRoute("/markets/0xabc"), {
    id: "market",
    params: { address: "0xabc" },
    title: "Market — Curveball",
  });
});

test("generates encoded route URLs", () => {
  assert.equal(routeHref("home"), "/");
  assert.equal(
    routeHref("market", { address: "token/one" }),
    "/markets/token%2Fone",
  );
  assert.throws(() => routeHref("market"), /Missing route param/);
  assert.throws(() => routeHref("unknown"), /Unknown route/);
});

test("falls back for unknown paths", () => {
  assert.equal(resolveRoute("/missing").id, "notFound");
});
