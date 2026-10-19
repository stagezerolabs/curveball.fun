import { parseEther, type Address } from "viem";
import type { PulseMoment, PulsePeriod, PulseScope } from "./types";

type ExampleMoment = {
  name: string;
  symbol: string;
  minutesAgo: number;
  durationMinutes: number;
  trades: number;
  buys: number;
  wallets: number;
  buyWeth: string;
  sellWeth: string;
  followedTraders?: number;
};

const exampleMarkets: Record<PulseScope, ExampleMoment[]> = {
  now: [
    { name: "Glass Orbit", symbol: "ORBT", minutesAgo: 8, durationMinutes: 34, trades: 37, buys: 27, wallets: 14, buyWeth: "18.4", sellWeth: "5.6" },
    { name: "Ballast", symbol: "BLST", minutesAgo: 22, durationMinutes: 27, trades: 24, buys: 9, wallets: 11, buyWeth: "3.1", sellWeth: "7.3" },
    { name: "Side Quest", symbol: "SIDE", minutesAgo: 118, durationMinutes: 96, trades: 19, buys: 13, wallets: 8, buyWeth: "4.8", sellWeth: "2.9" },
    { name: "Low Tide", symbol: "TIDE", minutesAgo: 417, durationMinutes: 121, trades: 15, buys: 6, wallets: 7, buyWeth: "1.2", sellWeth: "2.4" },
  ],
  following: [
    { name: "Nightjar", symbol: "NJAR", minutesAgo: 13, durationMinutes: 22, trades: 8, buys: 6, wallets: 3, buyWeth: "2.1", sellWeth: "0.65", followedTraders: 3 },
    { name: "Alley Cat", symbol: "ALCY", minutesAgo: 41, durationMinutes: 13, trades: 5, buys: 2, wallets: 2, buyWeth: "0.4", sellWeth: "1.15", followedTraders: 2 },
    { name: "Beamline", symbol: "BEAM", minutesAgo: 187, durationMinutes: 74, trades: 11, buys: 8, wallets: 4, buyWeth: "5.2", sellWeth: "1.5", followedTraders: 4 },
  ],
};

export const exampleFollowingTraders = [
  { name: "Mira", focus: "Early curve entries" },
  { name: "Kestrel", focus: "Small-cap rotation" },
  { name: "Vale", focus: "Patient exits" },
] as const;

export function mockPulseMoments(scope: PulseScope, period: PulsePeriod, asOf = Date.now()): PulseMoment[] {
  const windowMinutes = period === "1h" ? 60 : 24 * 60;
  return exampleMarkets[scope]
    .filter((example) => example.minutesAgo < windowMinutes)
    .map((example, index) => {
      const buy = parseEther(example.buyWeth);
      const sell = parseEther(example.sellWeth);
      const net = buy - sell;
      return {
        tokenAddress: `0x${String(index + (scope === "now" ? 1 : 101)).padStart(40, "0")}` as Address,
        tokenName: example.name,
        tokenSymbol: example.symbol,
        firstAt: new Date(asOf - (example.minutesAgo + example.durationMinutes) * 60_000).toISOString(),
        latestAt: new Date(asOf - example.minutesAgo * 60_000).toISOString(),
        tradeCount: example.trades,
        buyCount: example.buys,
        sellCount: example.trades - example.buys,
        distinctWalletCount: example.wallets,
        buyQuoteWei: buy.toString(),
        sellQuoteWei: sell.toString(),
        netQuoteWei: net.toString(),
        followedTraderCount: example.followedTraders ?? 0,
        reason: scope === "following" ? "following" : net > 0n ? "net_buying" : net < 0n ? "net_selling" : "activity",
        sampleTransactionHash: `0x${"0".repeat(64)}`,
      };
    });
}
