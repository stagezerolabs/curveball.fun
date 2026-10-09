import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { Featured } from "./Featured";
import { MarketList } from "./MarketList";
import type { Token } from "../types";

const tokens: Token[] = [1, 2, 3, 4].map((number) => ({
  address: `0x${String(number).padStart(40, "0")}` as Token["address"],
  creator: "0x0000000000000000000000000000000000000001",
  name: `Coin ${number}`,
  symbol: `C${number}`,
  createdAt: "2026-01-01T00:00:00.000Z",
  graduated: false,
  progress: number * 10,
  price: 0.01,
  marketCap: 1000,
}));

test("graduation feature shows only the top three live coins", () => {
  const html = renderToStaticMarkup(<Featured tokens={tokens} loading={false} navigate={() => undefined} />);
  expect(html).toContain("$C4");
  expect(html).toContain("$C3");
  expect(html).toContain("$C2");
  expect(html).not.toContain("$C1");
});

test("market cards show artwork, identity, market data, and curve progress", () => {
  const html = renderToStaticMarkup(<MarketList tokens={[tokens[0]]} loading={false} navigate={() => undefined} />);
  expect(html).toContain('class="market-card-grid"');
  expect(html).toContain('class="market-card-art"');
  expect(html).toContain("Coin 1");
  expect(html).toContain("Market cap");
  expect(html).toContain("Price");
  expect(html).toContain("10.0%");
  expect(html).toContain('/markets/');
});
