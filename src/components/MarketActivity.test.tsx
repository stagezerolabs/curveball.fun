import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { TradeActivity } from "../lib/marketChart";
import type { Token } from "../types";
import { averageUsdPrice, MarketActivity } from "./MarketActivity";
import { holderPercentage } from "./MarketHolders";

const token: Token = {
  address: "0x1111111111111111111111111111111111111111",
  creator: "0x2222222222222222222222222222222222222222",
  name: "Curveball Test",
  symbol: "BALL",
  quoteSymbol: "WETH",
  createdAt: "2026-01-01T00:00:00.000Z",
  graduated: false,
};

const trade: TradeActivity = {
  trader: "0x3333333333333333333333333333333333333333",
  participantRole: "trader",
  venue: "curve",
  venueAddress: "0x4444444444444444444444444444444444444444",
  isBuy: true,
  tokenAmount: 2_000_000_000_000_000_000n,
  quoteAmount: 1_000_000_000_000_000_000n,
  timestamp: 1_767_225_600,
  blockNumber: 12_345n,
  logIndex: 1,
  transactionHash:
    "0x5555555555555555555555555555555555555555555555555555555555555555",
  isFollowed: true,
};

test("trade history includes execution, wallet, time, and transaction details", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    ["rns", "primary", trade.trader.toLowerCase()],
    "trader.rise",
  );
  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <MarketActivity
        token={token}
        trades={[trade]}
        loading={false}
        error={false}
        navigate={() => undefined}
      />
    </QueryClientProvider>,
  );

  expect(html).toContain("Total (USD)");
  expect(html).toContain("Amount (BALL)");
  expect(html).toContain("Avg. price");
  expect(html).toContain("USD per token");
  expect(html).toContain("trader.rise");
  expect(html).toContain(`/profile/${trade.trader}`);
  expect(html).toContain("Following");
  expect(html).not.toContain("Venue");
  expect(html).toContain("Block 12,345");
  expect(html).toContain("0x5555…5555");
  expect(html).toContain('role="tab" aria-selected="true" aria-controls="market-trades-panel"');
  expect(html).toContain('role="tab" aria-selected="false" aria-controls="market-holders-panel"');
  expect(html).toContain("Top 50 holders");
});

test("trade execution price uses the current USD exchange rate", () => {
  expect(averageUsdPrice(trade.quoteAmount, trade.tokenAmount, 2_000)).toBe("$1,000.00");
  expect(averageUsdPrice(trade.quoteAmount, trade.tokenAmount, null)).toBe("—");
  expect(averageUsdPrice(1_000_000n, 1_000_000_000_000_000_000n, 2_000)).toBe("$0.000000002");
});

test("holder percentages use eligible wallet supply and handle empty supply", () => {
  expect(holderPercentage(1n, 3n)).toBe(33.3333);
  expect(holderPercentage(9n, 10n)).toBe(90);
  expect(holderPercentage(1n, 0n)).toBe(0);
});
