// Every threshold used by the curve-exit-realized-v3 leaderboard lives here, so the
// engine, the API `rules` payload, and the UI checklist cannot drift apart.
// Wei amounts are decimal strings; convert with BigInt at the point of use.
export const LEADERBOARD_RULES_V3 = Object.freeze({
  methodologyVersion: "curve-exit-realized-v3",
  minQualifyingTradeWei: "5000000000000000", // 0.005 WETH net quote
  qualifyingTradePeakCapitalBps: 100, // and >= 1% of the wallet's peak capital
  minPeakCapitalWei: "20000000000000000", // 0.02 WETH for every P&L category
  shrinkageK: 8,
  openPositionCapBps: 5000,
  twapWindowSec: 6 * 3600,
  staleMarketSec: 7 * 86400,
  depthGateRealQuoteWei: "500000000000000000", // 0.5 WETH real quote
  depthGateOtherTraders: 5,
  launchWindowBlocks: 2,
  publishDepthBlocks: 20,
  publishIntervalSec: 60,
  publishCronSec: 300,
  apiStaleMinutes: 15,
  apiPausedMinutes: 60,
  maxRankedRows: 100,
  maxWatchingRows: 10,
  confidence: Object.freeze({ established: 25, developing: 10 }),
  categories: Object.freeze({
    consistent: Object.freeze({
      minQualifyingTrades: 10,
      minMarkets: 3,
      minActiveDays: 5,
      minFirstTradeAgeDays: 14,
      maxLastTradeAgeDays: 30,
      minPeakCapitalWei: "50000000000000000", // 0.05 WETH
      maxSingleMarketShareBps: 6000,
      maxLaunchWindowShareBps: 5000,
    }),
    new: Object.freeze({
      minQualifyingTrades: 5,
      minMarkets: 2,
      minActiveDays: 3,
      maxFirstTradeAgeDays: 14,
      minPeakCapitalWei: "20000000000000000",
    }),
    trending: Object.freeze({
      windowDays: 7,
      minQualifyingTrades: 4,
      minMarkets: 2,
      minActiveDays: 3,
      minPeakCapitalWei: "20000000000000000",
    }),
    followers: Object.freeze({
      windowDays: 30,
      minQualifyingTrades: 2,
      minActiveDays: 2,
      minFollowerVolumeWei: "5000000000000000",
      minFollowerAccountAgeDays: 7,
    }),
  }),
});

const PUBLIC_CATEGORY_KEYS = [
  "minQualifyingTrades",
  "minMarkets",
  "minActiveDays",
  "minFirstTradeAgeDays",
  "maxFirstTradeAgeDays",
  "maxLastTradeAgeDays",
  "windowDays",
  "minPeakCapitalWei",
  "maxSingleMarketShareBps",
];

// Checklist and scoring numbers only. Depth-gate and launch-window internals stay
// server-side (spec section 9) so evasion stays costly.
export function publicRules(category, rules = LEADERBOARD_RULES_V3) {
  const gates = rules.categories[category] ?? {};
  const out = {
    methodologyVersion: rules.methodologyVersion,
    minTradeWei: rules.minQualifyingTradeWei,
    shrinkageK: rules.shrinkageK,
    openPositionCapBps: rules.openPositionCapBps,
    updateIntervalSec: rules.publishCronSec,
  };
  for (const key of PUBLIC_CATEGORY_KEYS) {
    if (gates[key] !== undefined) out[key] = gates[key];
  }
  if (category === "followers") {
    out.minFollowerVolumeWei = gates.minFollowerVolumeWei;
    out.minFollowerAccountAgeDays = gates.minFollowerAccountAgeDays;
  }
  return out;
}
