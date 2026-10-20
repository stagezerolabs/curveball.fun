// Quantify the indexer's reorg window vs. its finality marking.
//
// Three numbers interact, all from services/social/src/:
//   indexer.mjs:46   const REORG_OVERLAP = 16n;
//   indexer.mjs:928  const safeHead = head > config.confirmations ? head - config.confirmations : 0n;
//   config.mjs:68    confirmations: BigInt(positiveInteger("SOCIAL_CONFIRMATIONS", 2));
//   .env.example     SOCIAL_CONFIRMATIONS=2
//
// scanStream rewinds only REORG_OVERLAP blocks from the stored cursor.

const REORG_OVERLAP = 16n;
const CONFIRMATIONS = 2n;

console.log("=== rewind window ===");
console.log(`REORG_OVERLAP        = ${REORG_OVERLAP}`);
console.log(`SOCIAL_CONFIRMATIONS = ${CONFIRMATIONS} (default and shipped example value)`);
console.log();

console.log("The scanner rewinds `stored - REORG_OVERLAP` and re-reads to safeHead.");
console.log("So the deepest reorg it can ever revisit is REORG_OVERLAP blocks.\n");

for (const head of [1_000_000n]) {
  const safeHead = head - CONFIRMATIONS;
  const stored = head;
  const rewindTo = stored - REORG_OVERLAP;
  console.log(`head              = ${head}`);
  console.log(`safeHead          = ${safeHead}   (head - ${CONFIRMATIONS})`);
  console.log(`rewindTo          = ${rewindTo}   (stored - ${REORG_OVERLAP})`);
  console.log(`blocks indexed    = ${safeHead - rewindTo + 1n}`);
  console.log();
  console.log(`Deepest *revisitable* reorg fork point = block ${rewindTo}`);
  console.log(`Blocks already written as finalized=true and never revisited: `);
  console.log(`  ${rewindTo - 1n} and below -> a fork at or below ${rewindTo - 1n} is permanent divergence.`);
  console.log();
  console.log("Meanwhile recordBlock/recordOccurrence write finalized=true unconditionally,");
  console.log(`so blocks at depth ${CONFIRMATIONS} are stored as "finalized" while only`);
  console.log(`${String(CONFIRMATIONS)} confirmations deep. A reorg of depth ${REORG_OVERLAP}-${rewindTo - 1n}`.replace(/.*/, `^`) || "");
  console.log();
}

console.log("Conclusion:");
console.log(`  min revisitable depth = ${REORG_OVERLAP} blocks`);
console.log(`  depth at which rows are marked finalized = ${CONFIRMATIONS} blocks`);
console.log(`  => a reorg deeper than ${REORG_OVERLAP} blocks is silently unrecoverable.`);
console.log();
console.log("On RISE/OP-Stack, sequencer-side reorganizations are normally shallow, but the");
console.log("config permits CONFIRMATIONS=2 while claiming finality at that depth. The two");
console.log("constants should be reconciled (require CONFIRMATIONS >= REORG_OVERLAP, or");
console.log("derive the rewind from the deepest snapshot taken).");
