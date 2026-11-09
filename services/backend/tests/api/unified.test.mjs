import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { configureTestEnvironment } from "../helpers/environment.mjs";

configureTestEnvironment();
const { createSocialServer } = await import("../../src/api/server.mjs");
const { registerWebRoutes } = await import("../../src/web/routes.mjs");

describe("unified Fastify server", () => {
  let app;
  let root;
  let baseUrl;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "curveball-web-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<h1>Curveball</h1>");
    await writeFile(join(root, "assets", "app.js"), "console.log('ok')");
    app = createSocialServer();
    await registerWebRoutes(app, { distRoot: root });
    baseUrl = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app?.close();
    if (root) await rm(root, { recursive: true, force: true });
  });

  test("serves the app and social API from one listener", async () => {
    const [home, nested, asset, missingAsset, me] = await Promise.all([
      fetch(baseUrl),
      fetch(`${baseUrl}/markets/0x123`),
      fetch(`${baseUrl}/assets/app.js`),
      fetch(`${baseUrl}/assets/missing`),
      fetch(`${baseUrl}/v1/me`),
    ]);
    expect(home.status).toBe(200);
    expect(await home.text()).toContain("Curveball");
    expect(nested.status).toBe(200);
    expect(await nested.text()).toContain("Curveball");
    expect(asset.headers.get("cache-control")).toContain("immutable");
    expect(await asset.text()).toContain("console.log");
    expect(missingAsset.headers.get("cache-control")).toBe("no-cache");
    expect(home.headers.get("x-frame-options")).toBe("DENY");
    expect(await me.json()).toEqual({ address: null });
  });

  test("rejects unsupported web methods", async () => {
    const response = await fetch(`${baseUrl}/markets`, { method: "POST" });
    expect(response.status).toBe(405);
    expect(response.headers.get("allow")).toBe("GET, HEAD");
  });

  test("artwork route keeps same-origin protection", async () => {
    const response = await fetch(`${baseUrl}/api/artwork`, {
      method: "POST",
      headers: { Origin: "https://other.example" },
      body: new FormData(),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "Invalid request origin." });
  });
});
