// Cross-check (A): can two distinct chain logs map to one logicalId, and what breaks?
//
//   logicalId      = `${chainId}:${txHash}:${logIndex}:${address}:${topic0}`   (indexer.mjs:55-57)
//   chain_logs PK  = (chain_id, block_hash, log_index)                        (schema.ts:107)
//   trades PK      = logical_id                                               (schema.ts:168)
//
// Note the asymmetry: chain_logs keys on block_hash, derived tables key on logicalId.
// A transaction re-included at the same height after a reorg has the SAME txHash and the
// SAME logIndex but a DIFFERENT block_hash. So it produces:
//    - chain_logs:  TWO rows (old hash orphaned, new hash live)
//    - trades:      ONE row  (un-orphaned by the second insert)
//
// The consequence: `orphaned = true` in chain_logs does NOT mean "this event did not
// happen" - it means "this branch is gone". The event may be alive on the new branch.

import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.REVIEW_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:55432/curveball" });
const q = (t, v) => pool.query(t, v);
const CHAIN = "4153";
const LP = "0xb749ac30346fa7eb30651091993fbddf243259d2";
const HASH_A = "0x" + "d".repeat(64);
const HASH_B = "0x" + "e".repeat(64);
const TX = "0x" + "a".repeat(64);
const TOPIC0 = "0x" + "1".repeat(64);
const LOG_INDEX = 3;

const logicalId = (blockHash) => `${CHAIN}:${TX}:${LOG_INDEX}:${LP}:${TOPIC0}`;

async function recordOccurrence(blockHash) {
  await q(`INSERT INTO curveball.chain_logs
      (chain_id, block_hash, block_number, transaction_hash, transaction_index, log_index, address, topic0, topics, data, orphaned, finalized)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,false,true)
     ON CONFLICT (chain_id, block_hash, log_index)
     DO UPDATE SET orphaned=false,finalized=true,observed_at=now(),topics=EXCLUDED.topics,data=EXCLUDED.data`,
  [CHAIN, blockHash, "100", TX, 0, LOG_INDEX, LP, TOPIC0, JSON.stringify([TOPIC0]), "0x"]);
}

async function main() {
  await q("DELETE FROM curveball.chain_logs");
  await q("DELETE FROM curveball.trades");

  // ---- branch A: the trade lands at block 100 with hash A ----
  await recordOccurrence(HASH_A);
  // the trade row, keyed on logical_id
  const id = logicalId(HASH_A);
  await q(`INSERT INTO curveball.trades
      (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,log_index,launchpad_address,
       token_address,trader_address,is_buy,token_amount,net_trader_quote,gross_curve_quote,fee_quote,creator_tax_quote,
       virtual_quote_after,virtual_token_after,sold_after,block_timestamp,orphaned,finalized)
     VALUES ($1,$2,$3,'100',$4,0,$5,$6,$7,$8,true,'1','1','1','0','0','1','1','1',now(),false,true)`,
  [id, CHAIN, HASH_A, TX, LOG_INDEX, LP, "0x" + "9".repeat(40), "0x" + "8".repeat(40)]);

  // ---- reorg: the range is orphaned (this is what indexTradeRange does) ----
  await q("UPDATE curveball.chain_logs SET orphaned=true WHERE chain_id=$1 AND block_number BETWEEN '100' AND '100'", [CHAIN]);
  await q("UPDATE curveball.trades SET orphaned=true WHERE chain_id=$1 AND block_number BETWEEN '100' AND '100'", [CHAIN]);

  // ---- the tx is RE-INCLUDED at the same height on the new branch (hash B) ----
  await recordOccurrence(HASH_B);
  await q(`INSERT INTO curveball.trades
      (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,log_index,launchpad_address,
       token_address,trader_address,is_buy,token_amount,net_trader_quote,gross_curve_quote,fee_quote,creator_tax_quote,
       virtual_quote_after,virtual_token_after,sold_after,block_timestamp,orphaned,finalized)
     VALUES ($1,$2,$3,'100',$4,0,$5,$6,$7,$8,true,'1','1','1','0','0','1','1','1',now(),false,true)
     ON CONFLICT (logical_id) DO UPDATE SET orphaned=false,block_hash=EXCLUDED.block_hash`,
  [id, CHAIN, HASH_B, TX, LOG_INDEX, LP, "0x" + "9".repeat(40), "0x" + "8".repeat(40)]);

  const logs = await q("SELECT block_hash,orphaned,finalized FROM curveball.chain_logs ORDER BY block_hash");
  const trades = await q("SELECT logical_id,block_hash,orphaned FROM curveball.trades");

  console.log("chain_logs rows:", logs.rowCount);
  for (const r of logs.rows) console.log(`   hash=${r.block_hash.slice(0, 10)}… orphaned=${r.orphaned} finalized=${r.finalized}`);
  console.log("\ntrades rows:", trades.rowCount);
  for (const r of trades.rows) console.log(`   logical_id=…${r.logical_id.slice(-12)} block_hash=${r.block_hash.slice(0, 10)}… orphaned=${r.orphaned}`);

  console.log("\n=== RESULT (A) ===");
  console.log("The trade was re-included, so it is correctly live (orphaned=false).");
  console.log(`But chain_logs now holds ${logs.rowCount} rows for it: one orphaned, one live.`);
  const orphanedLogs = logs.rows.filter((r) => r.orphaned === true).length;
  console.log(`Orphaned chain_logs rows that describe an event which DID happen: ${orphanedLogs}`);
  console.log("");
  console.log("=> In chain_logs, `orphaned=true` means 'this BRANCH is gone', not");
  console.log("   'this event did not happen'. Any audit or reconciliation query over");
  console.log("   chain_logs that counts rows, rather than filtering orphaned=false, will");
  console.log("   double-count re-included transactions.");
  console.log("");
  console.log("The derived tables are NOT affected - they key on logical_id and correctly");
  console.log("collapse both branches to one live row. `chain_logs` accumulates the duplicate");

  // does anything read chain_logs without the orphaned filter?
  await pool.end();
}
main().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
