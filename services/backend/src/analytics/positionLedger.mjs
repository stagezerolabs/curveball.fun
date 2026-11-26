// Pure per-wallet replay of curve trades and token transfers for the v3 leaderboard.
// Average-cost basis as in the indexer's rebuildCurvePosition, with the v3 changes:
// creator-own tokens excluded, removed cost rounded up, and outbound transfers realized
// as sales at zero proceeds. Wei values are BigInt throughout.
import { ceilDiv } from "./curveExit.mjs";

const NO_INDEX = Number.MAX_SAFE_INTEGER;

export function compareEvents(a, b) {
  const blockA = BigInt(a.blockNumber);
  const blockB = BigInt(b.blockNumber);
  if (blockA !== blockB) return blockA < blockB ? -1 : 1;
  const txA = a.txIndex ?? NO_INDEX;
  const txB = b.txIndex ?? NO_INDEX;
  if (txA !== txB) return txA - txB;
  return a.logIndex - b.logIndex;
}

function emptyPosition() {
  return {
    knownBalance: 0n,
    onchainBalance: 0n,
    markableBalance: 0n,
    remainingCost: 0n,
    realizedPnl: 0n,
    realizedCost: 0n,
    invested: 0n,
    proceeds: 0n,
    unknownSold: 0n,
    tradeCount: 0,
    transferOutCount: 0,
  };
}

function minimum(left, right) {
  return left < right ? left : right;
}

// Removes `amount` known-basis tokens and returns the cost leaving with them (rounded up).
function removeBasis(position, amount) {
  const known = minimum(amount, position.knownBalance);
  if (known <= 0n || position.knownBalance <= 0n) return { known: 0n, cost: 0n };
  const cost = minimum(
    position.remainingCost,
    ceilDiv(position.remainingCost * known, position.knownBalance),
  );
  position.remainingCost -= cost;
  position.realizedCost += cost;
  position.knownBalance -= known;
  return { known, cost };
}

export function replayWallet({
  wallet,
  events,
  launchpadAddress,
  creatorByToken = new Map(),
  windowStart = null,
  rebase = null,
}) {
  const isLaunchpad =
    launchpadAddress instanceof Set
      ? (address) => launchpadAddress.has(address)
      : (address) => address === launchpadAddress;
  const perToken = new Map();
  const trades = [];
  let excludedCreatorTrades = 0;
  let deployed = 0n;
  let peakCapital = 0n;
  // Windowed replay (spec 5.5): state at the window start is carried forward with realized
  // P&L and capital reset, and each open known-basis position re-based at `rebase(token,
  // markable)`, its exit value at the window start, as a synthetic opening buy. A null
  // re-base value (unpriceable at the start) keeps the original cost, so pre-window gains
  // are never credited as in-window profit.
  let rebased = windowStart === null;
  const rebaseAtWindowStart = () => {
    rebased = true;
    trades.length = 0;
    excludedCreatorTrades = 0;
    deployed = 0n;
    for (const [token, current] of perToken) {
      const onchain = current.onchainBalance > 0n ? current.onchainBalance : 0n;
      const markable = minimum(current.knownBalance, onchain);
      let basis = 0n;
      if (markable > 0n) {
        const value = rebase ? rebase(token, markable) : null;
        basis =
          value === null || value === undefined
            ? minimum(
                current.remainingCost,
                ceilDiv(current.remainingCost * markable, current.knownBalance),
              )
            : BigInt(value);
      }
      Object.assign(current, emptyPosition(), {
        onchainBalance: current.onchainBalance,
        knownBalance: markable,
        remainingCost: basis,
        invested: basis,
      });
      deployed += basis;
    }
    peakCapital = deployed;
  };
  const position = (token) => {
    let current = perToken.get(token);
    if (!current) {
      current = emptyPosition();
      perToken.set(token, current);
    }
    return current;
  };

  for (const event of [...events].sort(compareEvents)) {
    if (!rebased && event.at >= windowStart) rebaseAtWindowStart();
    const token = event.token;
    if (creatorByToken.get(token) === wallet) {
      if (event.kind === "trade") excludedCreatorTrades += 1;
      continue;
    }

    if (event.kind === "transfer") {
      const amount = BigInt(event.amount);
      if (event.from === event.to) continue;
      const outbound = event.from === wallet;
      const current = position(token);
      current.onchainBalance += outbound ? -amount : amount;
      // Curve legs are accounted for by their trade rows.
      if (isLaunchpad(event.from) || isLaunchpad(event.to)) continue;
      if (!outbound) continue; // inbound: no basis, no value
      const removed = removeBasis(current, amount);
      if (removed.known > 0n) {
        current.realizedPnl -= removed.cost;
        current.transferOutCount += 1;
        deployed -= removed.cost;
      }
      continue;
    }

    const current = position(token);
    const tokens = BigInt(event.tokenAmount);
    const quote = BigInt(event.netQuote);
    current.tradeCount += 1;
    const record = {
      token,
      isBuy: event.isBuy,
      tokenAmount: tokens,
      netQuote: quote,
      antiSnipeTax: BigInt(event.antiSnipeTax ?? 0n),
      blockNumber: BigInt(event.blockNumber),
      at: event.at,
      removedCost: 0n,
      realizedPnl: 0n,
    };
    if (event.isBuy) {
      current.knownBalance += tokens;
      current.invested += quote;
      current.remainingCost += quote;
      deployed += quote;
      if (deployed > peakCapital) peakCapital = deployed;
    } else {
      current.proceeds += quote;
      const removed = removeBasis(current, tokens);
      current.unknownSold += tokens - removed.known;
      if (removed.known > 0n) {
        const knownProceeds = (quote * removed.known) / tokens;
        record.removedCost = removed.cost;
        record.realizedPnl = knownProceeds - removed.cost;
        current.realizedPnl += record.realizedPnl;
        deployed -= removed.cost;
      }
    }
    trades.push(record);
  }

  if (!rebased) rebaseAtWindowStart();
  let realizedPnl = 0n;
  for (const current of perToken.values()) {
    const onchain = current.onchainBalance > 0n ? current.onchainBalance : 0n;
    current.markableBalance = minimum(current.knownBalance, onchain);
    realizedPnl += current.realizedPnl;
  }

  return {
    entityId: wallet,
    wallet,
    perToken,
    peakCapital,
    realizedPnl,
    trades,
    excludedCreatorTrades,
  };
}
