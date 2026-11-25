import { expect, test } from "bun:test";
import { duplicateMarketSlug, marketSlugBase } from "../../src/indexing/marketSlug.mjs";

test("market slugs normalize tickers and keep colliding tokens distinct", () => {
  expect(marketSlugBase("CURVE")).toBe("curve");
  expect(marketSlugBase("  Hello__World  ")).toBe("hello-world");
  expect(marketSlugBase("💚")).toBe("token");
  expect(duplicateMarketSlug("curve", "0xCe4b88c65E3C1F57Ba43c1F6A3536ae15D6aF299"))
    .toBe("curve--ce4b88c65e3c1f57ba43c1f6a3536ae15d6af299");
});
