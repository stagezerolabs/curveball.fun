import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { Token } from "../types";
import { buildNowMoments } from "./nowPulse";
import { PulseNowCard } from "./PulseNowCard";

const token: Token = {
  address: "0x0000000000000000000000000000000000000001",
  creator: "0x0000000000000000000000000000000000000002",
  name: "Glass Orbit",
  symbol: "ORBT",
  createdAt: "2026-10-01T00:00:00.000Z",
  graduated: false,
  progress: 68.4,
  marketCap: 42,
};
const now = 1_000_000;
const sample = (isBuy: boolean, quoteWei: bigint) => ({
  token: token.address,
  trader: token.creator,
  transactionHash: `0x${"a".repeat(64)}` as const,
  eventId: String(quoteWei),
  timestamp: now - 60,
  price: 1,
  volume: 1,
  isBuy,
  quoteWei,
});
const [moment] = buildNowMoments(
  [sample(true, 3n * 10n ** 18n), sample(false, 10n ** 18n)],
  [token],
  "1h",
  now,
);

test("Now cards show the market, the buy/sell split and net inflow only", () => {
  const html = renderToStaticMarkup(
    <PulseNowCard moment={moment} token={token} navigate={() => undefined} />,
  );
  expect(html).toContain("View Glass Orbit market");
  expect(html).toContain("68% to graduation");
  expect(html).toContain("75% of value bought, 25% sold");
  expect(html).toContain("net inflow");
  for (const removed of [
    "Trades",
    "Wallets",
    "Sample transaction",
    "Active",
    "Net buying",
  ])
    expect(html).not.toContain(removed);
});

test("graduated markets hide the curve progress", () => {
  const html = renderToStaticMarkup(
    <PulseNowCard
      moment={moment}
      token={{ ...token, graduated: true }}
      navigate={() => undefined}
    />,
  );
  expect(html).not.toContain("to graduation");
});
