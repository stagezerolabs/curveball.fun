import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { PulseTraders } from "./PulseTraders";
import type { LeaderboardSnapshot } from "./types";

const address = "0x1111111111111111111111111111111111111111";

const leaderboard: LeaderboardSnapshot = {
  category: "consistent",
  status: "ranked",
  stale: false,
  paused: false,
  ageMinutes: 1,
  rules: { minQualifyingTrades: 10 },
  watching: [],
  progress: [],
  items: [
    {
      address,
      rank: 1,
      confidence: "developing",
      stats: {
        tradeCount: 12,
        qualifyingTradeCount: 12,
        realizedPnlWei: "100000000000000000",
        realizedCostWei: "1000000000000000000",
        realizedReturnPct: 10,
        marketsTraded: 3,
        firstTrade: "2026-01-01T00:00:00.000Z",
        lastTrade: "2026-01-02T00:00:00.000Z",
      },
      publishedMetrics: { returnBps: 1_000, netPnlWei: "100000000000000000" },
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

function render(data: LeaderboardSnapshot, category: LeaderboardSnapshot["category"] = "consistent") {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <PulseTraders category={category} data={data} navigate={() => undefined} />
    </QueryClientProvider>,
  );
}

const watchingRow = (address: `0x${string}`, trades: number) => ({
  address,
  rank: null,
  provisional: true as const,
  qualifyingTradeCount: trades,
  marketCount: 2,
  activeDayCount: 2,
  requirementsMet: 2,
  requirementsTotal: 5,
  lastTradeAt: "2026-11-25T00:00:00.000Z",
});

const noQualifiers: LeaderboardSnapshot = {
  category: "consistent",
  status: "no_qualifiers",
  stale: false,
  paused: false,
  ageMinutes: 2,
  asOfBlock: "28100000",
  rules: {
    minQualifyingTrades: 7,
    minTradeWei: "5000000000000000",
    minMarkets: 3,
    minActiveDays: 5,
    minPeakCapitalWei: "50000000000000000",
    minFirstTradeAgeDays: 14,
  },
  items: [],
  watching: [
    watchingRow("0x2222222222222222222222222222222222222222", 6),
    watchingRow("0x3333333333333333333333333333333333333333", 3),
  ],
  progress: [{ requirementsMet: 2, requirementsTotal: 5, walletCount: 2 }],
};

function watchingSection(html: string) {
  const start = html.indexOf('aria-label="Watching"');
  expect(start).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</ul>", start));
}

test("ranked rows show the rank and only the return percent", () => {
  const html = render(leaderboard);
  expect(html).toContain('aria-label="Rank 1"');
  expect(html).toContain("+10.0%");
  expect(html).not.toContain("WETH");
  expect(html).not.toContain("Developing");
  // Visible text only; the row keeps its pulse-leader-return class.
  expect(html).not.toMatch(/>[^<]*\breturn\b[^<]*</i);
});

test("no_qualifiers renders the checklist from rules", () => {
  const html = render(noQualifiers);
  expect(html).toContain("No traders qualify yet");
  expect(html).toContain("7 trades of 0.005+ WETH");
  expect(html).toContain("3 markets");
  expect(html).toContain("5 active days");
  expect(html).toContain("0.05 WETH peak capital");
  expect(html).toContain("First trade 14+ days ago");
});

test("watching rows show Not ranked and no percent", () => {
  const section = watchingSection(render(noQualifiers));
  expect(section).toContain("Not ranked");
  expect(section).toContain("6 trades, 2 markets");
  expect(section).toContain("Meets 2 of 5");
  expect(section).not.toContain("%");
  expect(section).not.toContain("WETH");
});

test("watching renders no rank numbers", () => {
  const html = render(noQualifiers);
  expect(html).not.toContain('aria-label="Rank');
  expect(html).not.toContain("<ol");
});

test("pending board says rankings are being calculated", () => {
  const html = render({ ...noQualifiers, status: "pending", watching: [], progress: [] });
  expect(html).toContain("Rankings are being calculated.");
});

test("paused board hides rows", () => {
  const html = render({ ...leaderboard, stale: true, paused: true, ageMinutes: 75 });
  expect(html).toContain("Rankings paused");
  expect(html).not.toContain('aria-label="Rank 1"');
});

test("stale board shows Updated N min ago", () => {
  const html = render({ ...leaderboard, stale: true, ageMinutes: 22 });
  expect(html).toContain("Updated 22 min ago");
  expect(html).toContain('aria-label="Rank 1"');
});

test("no How ranking works panel is rendered", () => {
  expect(render(noQualifiers)).not.toContain("How ranking works");
  expect(render(leaderboard)).not.toContain("<details");
});


test("preview boards render without a Preview rules badge", () => {
  expect(render({ ...leaderboard, preview: true })).not.toContain("Preview rules");
});
