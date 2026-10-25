import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import type { TradeActivity } from "../lib/marketChart";
import type { Token } from "../types";
import { MarketActivity } from "./MarketActivity";

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

  expect(html).toContain("Total (WETH)");
  expect(html).toContain("Amount (BALL)");
  expect(html).toContain("Avg. price");
  expect(html).toContain("0.5");
  expect(html).toContain("trader.rise");
  expect(html).toContain(`/profile/${trade.trader}`);
  expect(html).toContain("Following");
  expect(html).not.toContain("Venue");
  expect(html).toContain("Block 12,345");
  expect(html).toContain("0x5555…5555");
});
