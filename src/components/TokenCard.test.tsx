import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { getAddress } from "viem";
import { TokenCard } from "./TokenCard";

test("renders token price and market valuation in USD", () => {
  const html = renderToStaticMarkup(
    <TokenCard
      index={0}
      navigate={() => undefined}
      token={{
        address: getAddress("0x1111111111111111111111111111111111111111"),
        creator: getAddress("0x2222222222222222222222222222222222222222"),
        name: "NominateBear",
        symbol: "NBR",
        graduated: false,
        createdAt: "2026-09-19T14:32:51.882Z",
        price: 0.00001,
        marketCap: 10,
        priceUsd: 0.0263767,
        marketCapUsd: 26_376.7,
      }}
    />,
  );

  expect(html).toContain("$26.38K");
  expect(html).toContain("$0.0263767");
});
