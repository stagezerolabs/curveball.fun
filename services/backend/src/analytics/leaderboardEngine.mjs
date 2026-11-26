// Pure v3 leaderboard engine ("curve-exit-realized-v3"). Fed by one bulk load at publish
// time; every number is reproducible from trades, transfers, markets and market state at
// `asOfBlock`. Wei values are BigInt internally and decimal strings in metrics.
//
// Seam for linked-wallet clustering (deferred): every evaluation carries `entityId`, which
// is the wallet address today, and ranked categories keep one row per entity.
import { ceilDiv, markPosition } from "./curveExit.mjs";
import { LEADERBOARD_RULES_V3, publicRules } from "./leaderboardRules.mjs";
import { replayWallet } from "./positionLedger.mjs";
import {
  compareEntities,
  confidenceLabel,
  floorDiv,
  returnBps,
  scoredPnl,
  shrunkScore,
} from "./rankingScore.mjs";

export const RANKED_CATEGORIES = ["consistent", "new", "trending", "followers"];
const PNL_CATEGORIES = new Set(["consistent", "new", "trending"]);
const MARKABLE_STATES = new Set(["trading", "aborted"]);

const lower = (value) => String(value).toLowerCase();
const big = (value) =>
  value === null || value === undefined ? null : BigInt(value);
const isoTime = (seconds) =>
  seconds === null || seconds === undefined
    ? null
    : new Date(seconds * 1000).toISOString();

function bpsShare(part, whole) {
  if (whole <= 0n) return 0;
  return Number(floorDiv(part * 10000n, whole));
}

// Splits the wallet's scored unrealized allowance across markets so per-market scored P&L
// sums exactly to the wallet figure. Negative marks count in full; the remaining allowance
// is shared pro rata across positive marks, with the rounding remainder on the first.
function allocateScoredUnrealized(rows, allowance) {
  const total = rows.reduce((sum, row) => sum + row.unrealized, 0n);
  if (allowance === total) return rows.map((row) => row.unrealized);
  const negative = rows.reduce(
    (sum, row) => sum + (row.unrealized < 0n ? row.unrealized : 0n),
    0n,
  );
  const positive = total - negative;
  const budget = allowance - negative;
  const shares = rows.map((row) =>
    row.unrealized < 0n
      ? row.unrealized
      : row.unrealized > 0n
        ? (row.unrealized * budget) / positive
        : 0n,
  );
  let remainder = allowance - shares.reduce((sum, share) => sum + share, 0n);
  for (let i = 0; i < rows.length && remainder !== 0n; i++) {
    if (rows[i].unrealized > 0n) {
      shares[i] += remainder;
      remainder = 0n;
    }
  }
  return shares;
}

function normalizeMarket(raw) {
  return {
    token: lower(raw.token),
    creator: raw.creator ? lower(raw.creator) : null,
    launchpad: raw.launchpad ? lower(raw.launchpad) : null,
    launchBlock: big(raw.launchBlock),
    initialVirtualQuote: big(raw.initialVirtualQuote) ?? 0n,
    feeBps: BigInt(raw.feeBps ?? 0),
    creatorTaxBps: BigInt(raw.creatorTaxBps ?? 0),
    state: raw.state,
    vQ: big(raw.vQ),
    vT: big(raw.vT),
    latestTradeAt: raw.latestTradeAt ?? null,
  };
}

function markToken({ wallet, position, market, states, tradersByToken, asOfTime, rules }) {
  const markable = position.markableBalance;
  const row = { openValue: 0n, unrealized: 0n, staleMark: false, thinMarket: false };
  if (markable <= 0n) return row;
  const priceable =
    market &&
    MARKABLE_STATES.has(market.state) &&
    market.vQ !== null &&
    market.vT !== null &&
    market.vQ > 0n &&
    market.vT > 0n &&
    market.latestTradeAt !== null &&
    asOfTime - market.latestTradeAt <= rules.staleMarketSec;
  if (!priceable) {
    row.staleMark = true;
    return row;
  }
  const realQuote = market.vQ - market.initialVirtualQuote;
  const traders = tradersByToken.get(market.token) ?? new Set();
  const others = traders.size - (traders.has(wallet) ? 1 : 0);
  if (
    realQuote < BigInt(rules.depthGateRealQuoteWei) ||
    others < rules.depthGateOtherTraders
  ) {
    row.thinMarket = true;
    return row;
  }
  const mark = markPosition({
    amount: markable,
    now: { vT: market.vT, vQ: market.vQ, realQuote: realQuote > 0n ? realQuote : 0n },
    states,
    initialVirtualQuote: market.initialVirtualQuote,
    feeBps: market.feeBps,
    taxBps: market.creatorTaxBps,
    asOfTime,
    windowSec: rules.twapWindowSec,
  });
  const cost = ceilDiv(position.remainingCost * markable, position.knownBalance);
  row.openValue = mark;
  row.unrealized = mark - cost;
  return row;
}

function evaluateWallet({ wallet, events, ctx }) {
  const { rules, asOfTime, marketsByToken, statesByToken, tradersByToken } = ctx;
  const replay = replayWallet({
    wallet,
    events,
    launchpadAddress: ctx.launchpads,
    creatorByToken: ctx.creatorByToken,
  });
  const peak = replay.peakCapital;
  const minTrade = BigInt(rules.minQualifyingTradeWei);
  const capitalFloor = floorDiv(peak * BigInt(rules.qualifyingTradePeakCapitalBps), 10000n);
  const qualifying = replay.trades.filter(
    (trade) => trade.netQuote >= minTrade && trade.netQuote >= capitalFloor,
  );

  const perMarketRows = [];
  for (const [token, position] of [...replay.perToken.entries()].sort()) {
    if (position.tradeCount === 0 && position.knownBalance === 0n && position.realizedPnl === 0n)
      continue;
    const mark = markToken({
      wallet,
      position,
      market: marketsByToken.get(token),
      states: statesByToken.get(token) ?? [],
      tradersByToken,
      asOfTime,
      rules,
    });
    perMarketRows.push({ token, position, ...mark, realized: position.realizedPnl });
  }

  const realized = perMarketRows.reduce((sum, row) => sum + row.realized, 0n);
  const unrealized = perMarketRows.reduce((sum, row) => sum + row.unrealized, 0n);
  const openValue = perMarketRows.reduce((sum, row) => sum + row.openValue, 0n);
  const net = realized + unrealized;
  const scored = scoredPnl(realized, unrealized);
  const shares = allocateScoredUnrealized(perMarketRows, scored - realized);
  const perMarket = perMarketRows.map((row, index) => {
    const qualifyingHere = qualifying.filter((trade) => trade.token === row.token).length;
    return {
      token: row.token,
      realizedPnlWei: row.realized.toString(),
      unrealizedPnlWei: row.unrealized.toString(),
      scoredPnlWei: (row.realized + shares[index]).toString(),
      openValueWei: row.openValue.toString(),
      remainingCostWei: row.position.remainingCost.toString(),
      knownBalance: row.position.knownBalance.toString(),
      markableBalance: row.position.markableBalance.toString(),
      tradeCount: row.position.tradeCount,
      qualifyingTradeCount: qualifyingHere,
      transferOutCount: row.position.transferOutCount,
      unknownSold: row.position.unknownSold.toString(),
      staleMark: row.staleMark,
      thinMarket: row.thinMarket,
    };
  });

  let positiveTotal = 0n;
  let positiveMax = 0n;
  for (const row of perMarket) {
    const value = BigInt(row.scoredPnlWei);
    if (value > 0n) {
      positiveTotal += value;
      if (value > positiveMax) positiveMax = value;
    }
  }

  let buyQuote = 0n;
  let launchBuyQuote = 0n;
  for (const trade of replay.trades) {
    if (!trade.isBuy) continue;
    buyQuote += trade.netQuote;
    const launchBlock = marketsByToken.get(trade.token)?.launchBlock;
    const inWindow =
      launchBlock !== null &&
      launchBlock !== undefined &&
      trade.blockNumber <= launchBlock + BigInt(rules.launchWindowBlocks);
    if (inWindow || trade.antiSnipeTax > 0n) launchBuyQuote += trade.netQuote;
  }

  const firstQualifyingAt = qualifying.length ? qualifying[0].at : null;
  const activeDays = new Set(
    qualifying.map((trade) => Math.floor((trade.at - firstQualifyingAt) / 86400)),
  );
  const firstTradeAt = replay.trades.length ? replay.trades[0].at : null;
  const lastTradeAt = replay.trades.length ? replay.trades.at(-1).at : null;
  const lastQualifyingAt = qualifying.length ? qualifying.at(-1).at : null;
  const absRealized = realized < 0n ? -realized : realized;
  const staleMarkCount = perMarket.filter((row) => row.staleMark).length;
  const transferOutCount = perMarket.reduce((sum, row) => sum + row.transferOutCount, 0);
  const n = qualifying.length;
  const returnValue = returnBps(net, peak);

  return {
    address: wallet,
    entityId: replay.entityId,
    replay,
    qualifying,
    score: shrunkScore(scored, BigInt(n), BigInt(rules.shrinkageK)),
    realizedPnl: realized,
    scoredPnl: scored,
    peakCapital: peak,
    qualifyingTradeCount: n,
    firstTradeAt,
    lastTradeAt,
    lastQualifyingAt,
    perMarket,
    metrics: {
      methodologyVersion: rules.methodologyVersion,
      entityId: replay.entityId,
      realizedPnlWei: realized.toString(),
      openValueWei: openValue.toString(),
      unrealizedPnlWei: unrealized.toString(),
      netPnlWei: net.toString(),
      scoredPnlWei: scored.toString(),
      peakCapitalWei: peak.toString(),
      returnBps: returnValue === null ? null : Number(returnValue),
      qualifyingTradeCount: n,
      tradeCount: replay.trades.length,
      marketCount: new Set(qualifying.map((trade) => trade.token)).size,
      activeDayCount: activeDays.size,
      staleMarkCount,
      thinMarketCount: perMarket.filter((row) => row.thinMarket).length,
      transferOutCount,
      excludedCreatorTradeCount: replay.excludedCreatorTrades,
      exitMarkShareBps:
        absRealized + openValue > 0n ? bpsShare(openValue, absRealized + openValue) : null,
      singleMarketShareBps: positiveTotal > 0n ? bpsShare(positiveMax, positiveTotal) : 0,
      launchWindowShareBps: bpsShare(launchBuyQuote, buyQuote),
      confidence: confidenceLabel(n, rules),
      firstTradeAt: isoTime(firstTradeAt),
      lastTradeAt: isoTime(lastTradeAt),
    },
  };
}

const daysAgo = (asOfTime, seconds, days) =>
  seconds !== null && asOfTime - seconds >= days * 86400;

// Ordered requirement checks per category. The first entries mirror the public checklist;
// `profit` and similar are listed so "Meets N of M" never reads as complete while unranked.
function requirementChecks(category, evaluation, ctx) {
  const { rules, asOfTime } = ctx;
  const gates = rules.categories[category];
  const m = evaluation.metrics;
  const peak = evaluation.peakCapital;
  const profitable = evaluation.scoredPnl > 0n;
  switch (category) {
    case "consistent":
      return [
        m.qualifyingTradeCount >= gates.minQualifyingTrades,
        m.marketCount >= gates.minMarkets,
        m.activeDayCount >= gates.minActiveDays,
        peak >= BigInt(gates.minPeakCapitalWei),
        daysAgo(asOfTime, evaluation.firstTradeAt, gates.minFirstTradeAgeDays),
        evaluation.lastQualifyingAt !== null &&
          asOfTime - evaluation.lastQualifyingAt <= gates.maxLastTradeAgeDays * 86400,
        profitable && m.singleMarketShareBps <= gates.maxSingleMarketShareBps,
      ];
    case "new":
      return [
        m.qualifyingTradeCount >= gates.minQualifyingTrades,
        m.marketCount >= gates.minMarkets,
        m.activeDayCount >= gates.minActiveDays,
        peak >= BigInt(gates.minPeakCapitalWei),
        evaluation.firstTradeAt !== null &&
          asOfTime - evaluation.firstTradeAt < gates.maxFirstTradeAgeDays * 86400,
        profitable,
      ];
    case "trending":
      return [
        m.qualifyingTradeCount >= gates.minQualifyingTrades,
        m.marketCount >= gates.minMarkets,
        m.activeDayCount >= gates.minActiveDays,
        peak >= BigInt(gates.minPeakCapitalWei),
        m.staleMarkCount === 0,
        profitable,
      ];
    case "followers": {
      const window = evaluation.followerWindow;
      return [
        window.qualifyingTradeCount >= gates.minQualifyingTrades,
        window.activeDayCount >= gates.minActiveDays,
        evaluation.eligibleFollowerCount > 0,
      ];
    }
    default:
      throw new Error(`unknown leaderboard category ${category}`);
  }
}

// Hidden gates (spec section 9): enforced, never listed in the public checklist.
function hiddenGatesPass(category, evaluation, ctx) {
  if (category !== "consistent") return true;
  const gates = ctx.rules.categories.consistent;
  return evaluation.metrics.launchWindowShareBps <= gates.maxLaunchWindowShareBps;
}

function windowActivity(qualifying, fromTime) {
  const inWindow = qualifying.filter((trade) => trade.at >= fromTime);
  const first = inWindow.length ? inWindow[0].at : null;
  return {
    qualifyingTradeCount: inWindow.length,
    activeDayCount: new Set(inWindow.map((trade) => Math.floor((trade.at - first) / 86400))).size,
  };
}

function buildCategory(category, evaluations, ctx) {
  const rules = ctx.rules;
  const ranked = [];
  const candidates = [];
  for (const evaluation of evaluations) {
    if (evaluation.qualifyingTradeCount === 0) continue;
    const checks = requirementChecks(category, evaluation, ctx);
    const met = checks.filter(Boolean).length;
    candidates.push({ evaluation, met, total: checks.length });
    if (met === checks.length && hiddenGatesPass(category, evaluation, ctx)) {
      ranked.push(evaluation);
    }
  }

  const scoreOf = (evaluation) =>
    category === "followers" ? BigInt(evaluation.eligibleFollowerCount) : evaluation.score;
  const sorted = ranked
    .map((evaluation) => ({
      evaluation,
      address: evaluation.address,
      entityId: evaluation.entityId,
      score: scoreOf(evaluation),
      realizedPnl: PNL_CATEGORIES.has(category) ? evaluation.realizedPnl : 0n,
      qualifyingTradeCount: evaluation.qualifyingTradeCount,
      firstTradeAt: evaluation.firstTradeAt ?? 0,
    }))
    .sort(compareEntities);
  const seenEntities = new Set();
  const items = [];
  for (const entry of sorted) {
    if (seenEntities.has(entry.entityId)) continue;
    seenEntities.add(entry.entityId);
    if (items.length >= rules.maxRankedRows) break;
    const metrics = { ...entry.evaluation.metrics };
    if (category === "followers") metrics.eligibleFollowerCount = entry.evaluation.eligibleFollowerCount;
    items.push({
      address: entry.address,
      entityId: entry.entityId,
      rank: items.length + 1,
      score: entry.score,
      metrics,
    });
  }

  if (items.length) {
    return { status: "ranked", items, watching: [], progress: [], rules: publicRules(category, rules) };
  }

  const watching = [...candidates]
    .sort(
      (a, b) =>
        b.evaluation.qualifyingTradeCount - a.evaluation.qualifyingTradeCount ||
        (b.evaluation.lastTradeAt ?? 0) - (a.evaluation.lastTradeAt ?? 0) ||
        (a.evaluation.address < b.evaluation.address ? -1 : 1),
    )
    .slice(0, rules.maxWatchingRows)
    .map(({ evaluation, met, total }) => ({
      address: evaluation.address,
      rank: null,
      provisional: true,
      qualifyingTradeCount: evaluation.metrics.qualifyingTradeCount,
      marketCount: evaluation.metrics.marketCount,
      activeDayCount: evaluation.metrics.activeDayCount,
      requirementsMet: met,
      requirementsTotal: total,
      lastTradeAt: evaluation.metrics.lastTradeAt,
    }));
  const groups = new Map();
  for (const { met, total } of candidates) {
    const key = `${met}/${total}`;
    const group = groups.get(key) ?? { requirementsMet: met, requirementsTotal: total, walletCount: 0 };
    group.walletCount += 1;
    groups.set(key, group);
  }
  const progress = [...groups.values()].sort((a, b) => b.requirementsMet - a.requirementsMet);
  return {
    status: "no_qualifiers",
    items: [],
    watching,
    progress,
    rules: publicRules(category, rules),
  };
}

export function evaluateLeaderboards({
  asOfBlock,
  asOfTime,
  markets,
  statesByToken = new Map(),
  trades,
  transfers,
  protocolAccounts = [],
  follows = [],
  rules = LEADERBOARD_RULES_V3,
}) {
  const excluded = new Set(protocolAccounts.map(lower));
  const marketsByToken = new Map(markets.map((raw) => {
    const market = normalizeMarket(raw);
    return [market.token, market];
  }));
  const launchpads = new Set(
    [...marketsByToken.values()].map((market) => market.launchpad).filter(Boolean),
  );
  for (const address of launchpads) excluded.add(address);
  const creatorByToken = new Map(
    [...marketsByToken.values()].map((market) => [market.token, market.creator]),
  );

  const byWallet = new Map();
  const add = (wallet, event) => {
    if (!byWallet.has(wallet)) byWallet.set(wallet, []);
    byWallet.get(wallet).push(event);
  };
  const tradersByToken = new Map();
  const traders = new Set();
  for (const raw of trades) {
    const event = { ...raw, kind: "trade", token: lower(raw.token), trader: lower(raw.trader) };
    if (!marketsByToken.has(event.token) || excluded.has(event.trader)) continue;
    traders.add(event.trader);
    add(event.trader, event);
    if (creatorByToken.get(event.token) !== event.trader) {
      if (!tradersByToken.has(event.token)) tradersByToken.set(event.token, new Set());
      tradersByToken.get(event.token).add(event.trader);
    }
  }
  for (const raw of transfers) {
    const event = {
      ...raw,
      kind: "transfer",
      token: lower(raw.token),
      from: lower(raw.from),
      to: lower(raw.to),
    };
    if (!marketsByToken.has(event.token)) continue;
    if (traders.has(event.from)) add(event.from, event);
    if (event.to !== event.from && traders.has(event.to)) add(event.to, event);
  }

  const ctx = {
    rules,
    asOfBlock: BigInt(asOfBlock),
    asOfTime: Number(asOfTime),
    marketsByToken,
    statesByToken,
    tradersByToken,
    launchpads,
    creatorByToken,
  };
  const evaluations = [...traders]
    .sort()
    .map((wallet) => evaluateWallet({ wallet, events: byWallet.get(wallet), ctx }));

  // Followers: a social metric, never a performance ranking.
  const followerGates = rules.categories.followers;
  const followerWindowStart = ctx.asOfTime - followerGates.windowDays * 86400;
  const byAddress = new Map(evaluations.map((evaluation) => [evaluation.address, evaluation]));
  const eligibleFollower = (address) => {
    const follower = byAddress.get(address);
    if (!follower) return false;
    const volume = follower.qualifying.reduce((sum, trade) => sum + trade.netQuote, 0n);
    return (
      volume >= BigInt(followerGates.minFollowerVolumeWei) &&
      daysAgo(ctx.asOfTime, follower.firstTradeAt, followerGates.minFollowerAccountAgeDays)
    );
  };
  const followerCounts = new Map();
  for (const follow of follows) {
    const follower = lower(follow.follower);
    const followed = lower(follow.followed);
    if (follower === followed || !eligibleFollower(follower)) continue;
    followerCounts.set(followed, (followerCounts.get(followed) ?? 0) + 1);
  }
  for (const evaluation of evaluations) {
    evaluation.eligibleFollowerCount = followerCounts.get(evaluation.address) ?? 0;
    evaluation.followerWindow = windowActivity(evaluation.qualifying, followerWindowStart);
  }

  const categories = {};
  for (const category of RANKED_CATEGORIES) {
    categories[category] = buildCategory(category, evaluations, ctx);
  }
  return { categories, evaluations };
}
