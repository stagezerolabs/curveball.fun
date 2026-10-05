import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MarketHeader } from "./MarketHeader";
import type { Token } from "../types";

const base = {
  address: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  name: "Token",
  symbol: "TKN",
  graduated: false,
  createdAt: new Date().toISOString(),
  priceUsd: 0.02,
  marketCapUsd: 20000,
} as Token;

test("market header marks a stale ETH/USD rate without hiding the price", () => {
  const html = renderToStaticMarkup(<MarketHeader token={{ ...base, usdStale: true }} />);
  expect(html).toContain("stale rate");
  expect(html).toContain("Using the last known ETH/USD rate");
});

test("market header stays quiet while the ETH/USD rate is fresh", () => {
  const html = renderToStaticMarkup(<MarketHeader token={{ ...base, usdStale: false }} />);
  expect(html).not.toContain("stale rate");
});
