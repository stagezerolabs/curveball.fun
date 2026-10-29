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
  curveLiquidityWeth: 2,
}));

test("graduation feature shows only the top three live coins", () => {
  const html = renderToStaticMarkup(
    <Featured tokens={tokens} loading={false} navigate={() => undefined} />,
  );
  expect(html).toContain("$C4");
  expect(html).toContain("$C3");
  expect(html).toContain("$C2");
  expect(html).not.toContain("$C1");
  expect(html).toContain("MCAP");
});

test("market cards show creator, launch date, changes, volume, liquidity and cap", () => {
  const html = renderToStaticMarkup(
    <MarketList
      tokens={[tokens[0]]}
      loading={false}
      navigate={() => undefined}
      previewStats={{
        [tokens[0].address.toLowerCase()]: {
          athMarketCap: 1_500,
          transactions: 128,
          traders: 42,
          volume24h: 8.25,
          change1h: 10,
          change6h: -3.2,
          change24h: 0,
        },
      }}
    />,
  );
  expect(html).toContain('class="market-card-grid"');
  expect(html).toContain('class="market-card-top"');
  expect(html).not.toContain('class="market-card-social-preview"');
  expect(html).toContain("Coin 1");
  expect(html).toContain("Creator");
  expect(html).toContain("Created");
  expect(html).toContain("Jan 1, 2026");
  expect(html).toContain("1H");
  expect(html).toContain("6H");
  expect(html).toContain("24H");
  expect(html).toContain("Market cap");
  expect(html).toContain("Volume 24h");
  expect(html).toContain("Liquidity");
  expect(html).toContain("+10.0%");
  expect(html).toContain("-3.2%");
  expect(html).toContain("On the curve");
  expect(html).toContain("10.0% sold");
  expect(html).toContain(
    'class="market-card-progress-track" value="10" max="100"',
  );
  expect(html).not.toContain("PRICE");
  expect(html).not.toContain("ATH");
  expect(html).not.toContain("TXNS");
  expect(html).toContain("/markets/");
  expect(html).not.toContain("V1");
  expect(html).not.toContain('class="market-card-address"');
});

test("row view uses a single-column list", () => {
  const html = renderToStaticMarkup(
    <MarketList
      tokens={tokens}
      loading={false}
      navigate={() => undefined}
      view="rows"
    />,
  );
  expect(html).toContain('class="market-card-grid market-card-grid-rows"');
  expect(html.match(/class="market-card /g)?.length).toBe(4);
  expect(html.match(/class="market-card-progress-track"/g)?.length).toBe(4);
});

test("graduated markets keep a full progress bar", () => {
  const html = renderToStaticMarkup(
    <MarketList
      tokens={[{ ...tokens[0], graduated: true }]}
      loading={false}
      navigate={() => undefined}
    />,
  );
  expect(html).toContain(
    'class="market-card-progress-track" value="100" max="100"',
  );
  expect(html).toContain("Graduated · 100%");
});

test("a filled curve waiting for graduation is not marked live", () => {
  for (const pending of [true, false]) {
    const html = renderToStaticMarkup(
      <MarketList
        tokens={[{ ...tokens[0], progress: 100, pending }]}
        loading={false}
        navigate={() => undefined}
      />,
    );
    expect(html).toContain("Bonding complete");
    expect(html).not.toContain("Live");
  }
});
