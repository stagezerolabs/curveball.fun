// Read-only manual verification of the v3 leaderboard engine.
//   bun services/backend/src/entrypoints/leaderboardReport.mjs <asOfBlock> [--at <ISO time>] <address...>
// Without --at, the as-of time of the published v3 snapshot at that block is used (so the
// output reproduces the published numbers), falling back to now.
import { evaluateLeaderboards } from "../analytics/leaderboardEngine.mjs";
import { LEADERBOARD_RULES_V3 } from "../analytics/leaderboardRules.mjs";
import {
  PERFORMANCE_METHODOLOGY,
  loadLeaderboardInputs,
} from "../analytics/performance.mjs";
import { config } from "../platform/config.mjs";
import { pool } from "../platform/db.mjs";

const args = process.argv.slice(2);
const atIndex = args.indexOf("--at");
const explicitAt = atIndex >= 0 ? args.splice(atIndex, 2)[1] : null;
const [blockArg, ...addressArgs] = args;
if (!blockArg || !/^\d+$/.test(blockArg)) {
  console.error(
    "usage: leaderboardReport.mjs <asOfBlock> [--at <ISO time>] <address...>",
  );
  process.exit(2);
}
const asOfBlock = BigInt(blockArg);
const addresses = addressArgs.map((address) => address.toLowerCase());

try {
  let asOfTime = explicitAt ? new Date(explicitAt) : null;
  if (!asOfTime) {
    const published = await pool.query(
      `SELECT max(as_of_time) AS as_of_time FROM leaderboard_snapshots
      WHERE chain_id=$1 AND methodology_version=$2 AND as_of_block=$3`,
      [config.chainId, PERFORMANCE_METHODOLOGY, asOfBlock.toString()],
    );
    asOfTime = published.rows[0]?.as_of_time ?? new Date();
  }
  const inputs = await loadLeaderboardInputs(pool, asOfBlock, asOfTime);
  const { categories, evaluations } = evaluateLeaderboards({
    ...inputs,
    rules: LEADERBOARD_RULES_V3,
  });
  const placement = (address) =>
    Object.fromEntries(
      Object.entries(categories).map(([category, board]) => {
        const ranked = board.items.find((item) => item.address === address);
        const watching = board.watching.find((row) => row.address === address);
        return [
          category,
          ranked
            ? { rank: ranked.rank, score: ranked.score }
            : watching
              ? {
                  watching: true,
                  requirementsMet: watching.requirementsMet,
                  requirementsTotal: watching.requirementsTotal,
                }
              : { status: board.status },
        ];
      }),
    );
  const report = {
    asOfBlock: asOfBlock.toString(),
    asOfTime: new Date(inputs.asOfTime * 1000).toISOString(),
    methodologyVersion: PERFORMANCE_METHODOLOGY,
    wallets: addresses.map((address) => {
      const evaluation = evaluations.find((item) => item.address === address);
      if (!evaluation) return { address, evaluated: false };
      return {
        address,
        metrics: evaluation.metrics,
        perMarket: evaluation.perMarket,
        qualifyingTrades: evaluation.qualifying.map((trade) => ({
          token: trade.token,
          isBuy: trade.isBuy,
          netQuote: trade.netQuote,
          blockNumber: trade.blockNumber,
          at: new Date(trade.at * 1000).toISOString(),
        })),
        placement: placement(address),
      };
    }),
  };
  console.log(
    JSON.stringify(
      report,
      (_key, value) => (typeof value === "bigint" ? value.toString() : value),
      2,
    ),
  );
} finally {
  await pool.end();
}
