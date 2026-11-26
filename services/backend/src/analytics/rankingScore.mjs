// Pure BigInt scoring for the v3 leaderboard: absolute profit, shrunk by sample size.
import { LEADERBOARD_RULES_V3 } from "./leaderboardRules.mjs";

// Floor toward negative infinity (BigInt `/` truncates toward zero).
export function floorDiv(a, b) {
  const q = a / b;
  return (a % b !== 0n && (a < 0n) !== (b < 0n)) ? q - 1n : q;
}

export function shrunkScore(pnl, n, k = BigInt(LEADERBOARD_RULES_V3.shrinkageK)) {
  const samples = BigInt(n);
  if (samples <= 0n) return 0n;
  return floorDiv(pnl * samples, samples + k);
}

// Open positions supply at most 50% of P: positive unrealized counts only up to realized
// profit. Negative unrealized always counts in full.
export function scoredPnl(realized, unrealized) {
  if (unrealized <= 0n) return realized + unrealized;
  const cap = realized > 0n ? realized : 0n;
  return realized + (unrealized < cap ? unrealized : cap);
}

export function returnBps(pnl, capital) {
  if (capital === 0n) return null;
  return floorDiv(pnl * 10000n, capital);
}

export function confidenceLabel(n, rules = LEADERBOARD_RULES_V3) {
  if (n >= rules.confidence.established) return "established";
  if (n >= rules.confidence.developing) return "developing";
  return "new";
}

const cmpDesc = (a, b) => (a === b ? 0 : a > b ? -1 : 1);

// Score desc, realized P&L desc, qualifying trades desc, earlier first trade, address asc.
export function compareEntities(a, b) {
  return (
    cmpDesc(a.score, b.score) ||
    cmpDesc(a.realizedPnl, b.realizedPnl) ||
    cmpDesc(a.qualifyingTradeCount, b.qualifyingTradeCount) ||
    a.firstTradeAt - b.firstTradeAt ||
    (a.address < b.address ? -1 : a.address > b.address ? 1 : 0)
  );
}
