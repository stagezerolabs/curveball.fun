import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { PulseTraders } from "./PulseTraders";
import type { LeaderboardSnapshot } from "./types";

const address = "0x1111111111111111111111111111111111111111";

const leaderboard: LeaderboardSnapshot = {
  category: "consistent",
  items: [
    {
      address,
      rank: 1,
      stats: {
        tradeCount: 12,
        buyCount: 8,
        sellCount: 4,
        volumeWei: "1000000000000000000",
        realizedPnlWei: "100000000000000000",
        realizedReturnPct: 10,
        marketsTraded: 3,
        firstTrade: "2026-01-01T00:00:00.000Z",
        lastTrade: "2026-01-02T00:00:00.000Z",
      },
      publishedMetrics: { returnBps: 1_000 },
    },
  ],
};

test("leaderboard identities prefer a cached .rise primary name", () => {
  const queryClient = new QueryClient();
  queryClient.setQueryData(
    ["rns", "primary", address.toLowerCase()],
    "leader.rise",
  );

  const html = renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <PulseTraders
        category="consistent"
        data={leaderboard}
        navigate={() => undefined}
      />
    </QueryClientProvider>,
  );

  expect(html).toContain("leader.rise");
  expect(html).toContain("0x1111…1111");
  expect(html).toContain(`/profile/${address}`);
});
