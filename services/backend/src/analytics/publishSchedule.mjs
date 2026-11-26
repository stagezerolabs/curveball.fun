// Pure timing rules for leaderboard publishes: after indexed activity (coalesced to at most
// once per publishIntervalSec) plus a publishCronSec heartbeat so marks decay and staleness
// gates trip without activity.
import { LEADERBOARD_RULES_V3 } from "./leaderboardRules.mjs";

export function shouldPublish({ dirty, lastPublishedAt, now, rules = LEADERBOARD_RULES_V3 }) {
  if (lastPublishedAt === null || lastPublishedAt === undefined) return true;
  const elapsed = now - lastPublishedAt;
  if (elapsed >= rules.publishCronSec * 1000) return true;
  return Boolean(dirty) && elapsed >= rules.publishIntervalSec * 1000;
}

// Cursors hold the next block each stream will read, so `cursor - 1` is fully indexed.
// Returns null until there is an indexed block to publish at.
export function publishAsOfBlock({ head, cursors, rules = LEADERBOARD_RULES_V3 }) {
  const candidates = [
    BigInt(cursors.trades) - 1n,
    BigInt(cursors.ledger) - 1n,
    BigInt(head) - BigInt(rules.publishDepthBlocks),
  ];
  const block = candidates.reduce((low, value) => (value < low ? value : low));
  return block > 0n ? block : null;
}
