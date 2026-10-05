import { expect, test } from "bun:test";
import { app } from "./server";

test("serves permanent production metadata for NominateBear", async () => {
  const response = await app.request("/api/metadata/nominatebear");

  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toContain("public");
  expect(await response.json()).toEqual({
    name: "NominateBear",
    symbol: "NBR",
    description: "The first token launched on Curveball.",
    website: "https://curveball-fun.netlify.app/markets",
  });
});

test("does not expose curve-trade estimates as wallet holdings", async () => {
  for (const path of [
    "/api/tokens/0x1111111111111111111111111111111111111111/holders",
    "/api/tokens/0x1111111111111111111111111111111111111111/position/0x2222222222222222222222222222222222222222",
  ]) {
    const response = await app.request(path);
    expect(response.status).toBe(501);
    expect(await response.json()).toMatchObject({ error: "Wallet holdings are not indexed yet." });
  }
});
