import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { configureTestEnvironment } from "../helpers/environment.mjs";

configureTestEnvironment();
const { createSocialServer } = await import("../../src/api/server.mjs");
const { ACTIVE_WALLET_HEADER } = await import("../../src/api/auth/privyAuth.mjs");

describe("HTTP dispatch", () => {
  let server;
  let baseUrl;
  beforeAll(async () => {
    server = createSocialServer();
    baseUrl = await server.listen({ port: 0, host: "127.0.0.1" });
  });
  afterAll(async () => {
    await server.close();
  });

  test("routes unauthenticated viewer and unknown paths", async () => {
    const me = await fetch(`${baseUrl}/v1/me`);
    expect(me.status).toBe(200);
    expect(await me.json()).toEqual({ address: null });
    const unknown = await fetch(`${baseUrl}/v1/missing`);
    expect(unknown.status).toBe(404);
    expect(await unknown.json()).toEqual({ error: "Endpoint not found." });
  });

  test("keeps validation and origin errors on their routes", async () => {
    const pulse = await fetch(`${baseUrl}/v1/pulse?scope=invalid`);
    expect(pulse.status).toBe(400);
    expect(await pulse.json()).toEqual({ error: "Choose a supported Pulse scope and period." });
    const claim = await fetch(`${baseUrl}/v1/me`, { method: "POST" });
    expect(claim.status).toBe(403);
    expect(await claim.json()).toEqual({ error: "Request origin is not allowed." });
  });

  test("dispatches the feature routes", async () => {
    const market = await fetch(`${baseUrl}/v1/markets?tab=invalid`);
    expect(market.status).toBe(400);
    const candles = await fetch(`${baseUrl}/v1/markets/0x0000000000000000000000000000000000000011/candles?interval=7`);
    expect(candles.status).toBe(400);
    const leaderboard = await fetch(`${baseUrl}/v1/leaderboards/invalid`);
    expect(leaderboard.status).toBe(404);
    const notifications = await fetch(`${baseUrl}/v1/notifications`);
    expect(notifications.status).toBe(401);
  });

  test("preflight retains allowed methods and active wallet header", async () => {
    const response = await fetch(`${baseUrl}/v1/me`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("PATCH");
    expect(response.headers.get("access-control-allow-headers")).toContain(ACTIVE_WALLET_HEADER);
  });
});
