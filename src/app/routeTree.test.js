import assert from "node:assert/strict";
import test from "node:test";
import { resolveRoute, routeHref } from "./routeTree.ts";

test("resolves static and dynamic routes", () => {
  assert.deepEqual(resolveRoute("/"), {
    id: "landing",
    params: {},
    title: "Curveball — Fair token launches",
  });
  assert.deepEqual(resolveRoute("/app"), {
    id: "home",
    params: {},
    title: "Explore — Curveball",
  });
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
  assert.deepEqual(resolveRoute("/profile"), {
    id: "profile",
    params: {},
    title: "Your launches — Curveball",
  });
});

test("generates encoded route URLs", () => {
  assert.equal(routeHref("landing"), "/");
  assert.equal(routeHref("home"), "/app");
  assert.equal(routeHref("profile"), "/profile");
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
