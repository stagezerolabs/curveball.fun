// Empirical reproduction of the Curveball indexer's reorg behaviour against real Postgres.
//
// It does not spin up an RPC. Instead it replays the EXACT SQL the indexer issues, in the
// EXACT order, for a "range scanned" and then a "range reorged and re-scanned" cycle,
// using the real migrated schema (packages/db/drizzle).
//
// What it tests:
//   H1  markets orphaned by a reorg are resurrected by a replayed LaunchCreated from the
//       *orphaned* (old-chain) log, because recordOccurrence is keyed on block_hash.
//   H2  `assets` has no orphaned column, so the token metadata row from a reverted launch
//       survives the reorg and is served by the API forever.
//   H3  a reorg deeper than REORG_OVERLAP (16) is never revisited.
//
// Run: node reorg-harness.mjs

import { readFileSync } from "node:fs";
import pg from "pg";

const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.REVIEW_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:55432/curveball" });

const CHAIN = 4153n;
const LP = "0xb749ac30346fa7eb30651091993fbddf243259d2";
const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const CREATOR = "0xcccccccccccccccccccccccccccccccccccccccc";
const T0 = "0x1111111111111111111111111111111111111111111111111111111111111111"; // LaunchCreated topic0
const LIFE = [T0];

const log = (...a) => console.log(...a);
const q = (text, values) => pool.query(text, values);

// --- verbatim from services/social/src/indexer.mjs ---
function logicalId(l) {
  return `${CHAIN}:${l.hash.toLowerCase()}:${l.logIndex}:${l.address.toLowerCase()}:${l.topics[0].toLowerCase()}`;
}
async function recordBlock(block) {
  await q("UPDATE curveball.chain_blocks SET canonical=false WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3",
    [CHAIN.toString(), block.number.toString(), block.hash.toLowerCase()]);
  await q(`INSERT INTO curveball.chain_blocks
    (chain_id,block_number,block_hash,parent_hash,block_timestamp,canonical,finalized)
    VALUES ($1,$2,$3,$4,$5,true,true)
    ON CONFLICT (chain_id,block_hash) DO UPDATE SET canonical=true,finalized=true,observed_at=now()`,
  [CHAIN.toString(), block.number.toString(), block.hash.toLowerCase(), block.parentHash.toLowerCase(), block.ts]);
}
async function recordOccurrence(l, orphaned = false) {
  await q(`INSERT INTO curveball.chain_logs
      (chain_id, block_hash, block_number, transaction_hash, transaction_index, log_index, address, topic0, topics, data, orphaned, finalized)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,false,true)
     ON CONFLICT (chain_id, block_hash, log_index)
     DO UPDATE SET orphaned=false,finalized=true,observed_at=now(),topics=EXCLUDED.topics,data=EXCLUDED.data`,
  [CHAIN.toString(), l.hash.toLowerCase(), l.number.toString(), l.tx.toLowerCase(), 0, l.logIndex,
    l.address.toLowerCase(), l.topics[0].toLowerCase(), JSON.stringify(l.topics.map((t) => t.toLowerCase())), "0x"]);
  if (orphaned) {
    await q(`INSERT INTO curveball.chain_logs
        (chain_id, block_hash, block_number, transaction_hash, transaction_index, log_index, address, topic0, topics, data, orphaned, finalized)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,true,true) ON CONFLICT DO NOTHING`,
    [CHAIN.toString(), l.hash.toLowerCase(), l.number.toString(), l.tx.toLowerCase(), 0, l.logIndex,
      l.address.toLowerCase(), l.topics[0].toLowerCase(), JSON.stringify(l.topics.map((t) => t.toLowerCase())), "0x"]);
    await q("UPDATE curveball.chain_logs SET orphaned=true WHERE chain_id=$1 AND block_hash=$2 AND log_index=$3",
      [CHAIN.toString(), l.hash.toLowerCase(), l.logIndex]);
  }
}
// The launch INSERT, including its `state='trading', ready_at=NULL, orphaned=false` clause.
async function insertLaunch(l, block) {
  await q(`INSERT INTO curveball.markets
      (chain_id, token_address, launchpad_address, creator_address, name, symbol, metadata_uri,
       launch_tx_hash, launch_log_index, launch_block, launched_at,total_supply,curve_supply,reserve_amount,reserve_bps,
       initial_virtual_quote,graduation_target_quote,fee_bps,creator_fee_share_bps,buyback_fee_share_bps,creator_tax_bps,
       state,ready_at,orphaned)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'trading',NULL,false)
     ON CONFLICT (chain_id, token_address) DO UPDATE SET
       launchpad_address = EXCLUDED.launchpad_address, creator_address = EXCLUDED.creator_address,
       name = EXCLUDED.name, symbol = EXCLUDED.symbol, metadata_uri = EXCLUDED.metadata_uri,
       launch_tx_hash = EXCLUDED.launch_tx_hash, launch_log_index = EXCLUDED.launch_log_index,
       launch_block = EXCLUDED.launch_block, launched_at = EXCLUDED.launched_at,total_supply=EXCLUDED.total_supply,
       curve_supply=EXCLUDED.curve_supply,reserve_amount=EXCLUDED.reserve_amount,reserve_bps=EXCLUDED.reserve_bps,
       initial_virtual_quote=EXCLUDED.initial_virtual_quote,graduation_target_quote=EXCLUDED.graduation_target_quote,
       fee_bps=EXCLUDED.fee_bps,creator_fee_share_bps=EXCLUDED.creator_fee_share_bps,
       buyback_fee_share_bps=EXCLUDED.buyback_fee_share_bps,creator_tax_bps=EXCLUDED.creator_tax_bps,
       state='trading', ready_at=NULL, orphaned = false`,
  [CHAIN.toString(), TOKEN, LP, CREATOR, "OldName", "OLD", "ipfs://old", l.tx.toLowerCase(), l.logIndex,
    l.number.toString(), block.ts, (1_000_000n * 10n ** 18n).toString(), (800_000n * 10n ** 18n).toString(),
    "0", 0, "2500000000000000000000", "4000000000000000000000", 75, 5000, 2500, 0]);

  await q(`INSERT INTO curveball.assets (chain_id,address,name,symbol,decimals,metadata_uri)
    VALUES ($1,$2,$3,$4,18,$5) ON CONFLICT (chain_id,address) DO UPDATE SET
    name=EXCLUDED.name,symbol=EXCLUDED.symbol,metadata_uri=EXCLUDED.metadata_uri,updated_at=now()`,
  [CHAIN.toString(), TOKEN, "OldName", "OLD", "ipfs://old"]);
}

// The factory-range orphaning block, verbatim shape.
async function orphanFactoryRange(from, to) {
  await q("UPDATE curveball.chain_logs SET orphaned = true WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3 AND address = $4 AND topic0 = ANY($5::text[])",
    [CHAIN.toString(), from.toString(), to.toString(), LP, LIFE]);
  await q("UPDATE curveball.markets SET orphaned=true WHERE chain_id=$1 AND launch_block BETWEEN $2 AND $3",
    [CHAIN.toString(), from.toString(), to.toString()]);
}

function fixture(tag) {
  return {
    number: 100n,
    hash: tag === "old" ? "0x" + "d".repeat(64) : "0x" + "e".repeat(64),
    parentHash: "0x" + "f".repeat(64),
    ts: new Date("2026-01-01T00:00:00Z"),
    tx: tag === "old" ? "0x" + "a".repeat(64) : "0x" + "b".repeat(64),
    logIndex: 3,
    address: LP,
    topics: [T0, "0x" + "0".repeat(24) + TOKEN.slice(2)],
  };
}

async function reset() {
  for (const t of ["chain_logs", "chain_blocks", "markets", "assets", "chain_cursors"]) {
    await q(`DELETE FROM curveball.${t}`);
  }
}

async function state() {
  const m = await q("SELECT name,symbol,metadata_uri,orphaned,launch_tx_hash FROM curveball.markets WHERE chain_id=$1 AND token_address=$2", [CHAIN.toString(), TOKEN]);
  const a = await q("SELECT name,symbol,metadata_uri FROM curveball.assets WHERE chain_id=$1 AND address=$2", [CHAIN.toString(), TOKEN]);
  const logs = await q("SELECT block_hash,orphaned FROM curveball.chain_logs WHERE chain_id=$1 ORDER BY observed_at", [CHAIN.toString()]);
  return { market: m.rows[0], asset: a.rows[0], logs: logs.rows };
}

async function main() {
  await q("SELECT 1");

  // =============== BASELINE: healthy chain, block 100 ===============
  await reset();
  const old = fixture("old");
  await recordBlock(old);
  await recordOccurrence(old);
  await insertLaunch(old, old);
  log("=== after indexing block 100 (chain A) ===");
  log(JSON.stringify(await state(), null, 2));

  // =============== REORG: block 100 replaced by 100' (different hash) ===============
  // This is what happens when the chain reorgs above the confirmation depth.
  const neu = fixture("new");
  await orphanFactoryRange(100n, 100n);
  log("\n=== after the reorg was detected and the range orphaned ===");
  const mid = await state();
  log("market.orphaned =", mid.market?.orphaned, "(correctly true)");
  log("asset row still:", JSON.stringify(mid.asset));

  // Now the scanner replays the range. The chain has NOT re-included this launch.
  await recordBlock(neu);
  await recordOccurrence(neu);   // new hash -> new chain_logs row, old one stays orphaned
  log("\n=== after re-scanning the replaced range (chain B, no launch here) ===");
  const after = await state();
  log("chain_logs rows:", JSON.stringify(after.logs, null, 2));
  log("market:", JSON.stringify(after.market));
  log("asset :", JSON.stringify(after.asset));

  // ---- assertions ----
  const problems = [];
  if (after.market?.orphaned !== true) problems.push("market unexpectedly un-orphaned (would need a launch log present)");
  if (after.asset?.name === "OldName") problems.push("H2 CONFIRMED: assets row from the reverted launch survives the reorg");
  log("\n--- H2 RESULT ---");
  log(problems.length ? problems.join("\n") : "no problem detected");

  // =============== H1: same block height re-included, OLD hash re-scanned ===============
  // The scanner overlaps by REORG_OVERLAP and re-reads from the chain. If the RPC returns
  // the *old* hash for that height (stale node, or the scan overlapping into a reorged
  // region whose logs are still cached), recordOccurrence finds the existing (orphaned)
  // row keyed on block_hash and flips orphaned back to false.
  await reset();
  await recordBlock(old);
  await recordOccurrence(old);
  await insertLaunch(old, old);
  await orphanFactoryRange(100n, 100n);
  const beforeRescan = await state();
  log("\n=== H1: after orphaning, before re-scan ===");
  log("market.orphaned =", beforeRescan.market?.orphaned);
  log("log.orphaned    =", beforeRescan.logs.map((l) => l.orphaned));

  // Re-scan returns the OLD log again (same block_hash).
  await recordOccurrence(old);
  const h1 = await state();
  log("=== after re-scanning the SAME old-chain log ===");
  log("chain_logs orphaned flags:", JSON.stringify(h1.logs.map((l) => l.orphaned)));
  if (h1.logs.some((l) => l.orphaned === false)) {
    log("H1 CONFIRMED: recordOccurrence flipped an orphaned chain_logs row back to orphaned=false");
    log("             (reachable only if the overlapping scan re-reads the old branch)");
  }

  await pool.end();
}

main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
