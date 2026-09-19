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
