// Verify the three cross-check claims empirically against real Postgres.
//
//  (A) Does a unique-index conflict (not the logical_id PK) abort the range transaction?
//      Schema: trades_chain_log_uidx on (chain_id, transaction_hash, log_index)
//              trades PK on logical_id  = chain:txHash:logIndex:address:topic0
//  (B) indexFactoryRange: a market orphaned in a reorg and NOT re-found stays orphaned,
//      while the trade rows for it stay live.
//  (C) indexLedgerRange rebuilds neither curve_positions nor market_stats.

import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: process.env.REVIEW_DATABASE_URL || "postgres://postgres:postgres@127.0.0.1:55432/curveball" });
const q = (t, v) => pool.query(t, v);
const CHAIN = "4153";
const LP = "0xb749ac30346fa7eb30651091993fbddf243259d2";
const TOKEN = "0x" + "9".repeat(40);
const TRADER = "0x" + "8".repeat(40);
const TX = "0x" + "a".repeat(64);
const TRADE_TOPIC = "0x" + "2".repeat(64);
const OTHER_TOPIC = "0x" + "3".repeat(64);

const logicalId = (addr, topic0) => `${CHAIN}:${TX}:7:${addr}:${topic0}`;

async function insertTrade(logical, addr, topic0, blockHash, orphaned = false) {
  await q(`INSERT INTO curveball.trades
      (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,log_index,launchpad_address,
       token_address,trader_address,is_buy,token_amount,net_trader_quote,gross_curve_quote,fee_quote,creator_tax_quote,
       virtual_quote_after,virtual_token_after,sold_after,block_timestamp,orphaned,finalized)
     VALUES ($1,$2,$3,'100',$4,0,7,$5,$6,$6,true,'1','1','1','0','0','1','1','1',now(),$7,true)
     ON CONFLICT (logical_id) DO UPDATE SET orphaned=false,block_hash=EXCLUDED.block_hash`,
  [logical, CHAIN, blockHash, TX, addr, TOKEN, orphaned]);
}

async function testA() {
  await q("DELETE FROM curveball.trades");
  console.log("=== (A) unique-index conflict on trades_chain_log_uidx ===");
  // Branch A: tx emits Trade at logIndex 7 from the launchpad.
  await insertTrade(logicalId(LP, TRADE_TOPIC), LP, TRADE_TOPIC, "0x" + "d".repeat(64));
  console.log("branch A inserted: 1 row");

  // Branch B: same tx re-included at the same height, but this time logIndex 7 is a
  // DIFFERENT event (different address/topic0) -> different logical_id, same (tx, logIndex).
  try {
    await insertTrade(logicalId(TOKEN, OTHER_TOPIC), TOKEN, OTHER_TOPIC, "0x" + "e".repeat(64));
    console.log("branch B insert: SUCCEEDED (no collision)");
  } catch (e) {
    console.log("branch B insert: FAILED ->", e.code, e.constraint || "");
    console.log("  This is the claim: the unique index fires and `ON CONFLICT (logical_id)`");
    console.log("  does not arbitrate it, so the whole range transaction would abort.");
  }
  const n = await q("SELECT count(*)::int AS n FROM curveball.trades");
  console.log("trades rows now:", n.rows[0].n);

  console.log("\n  Reachability check: logIndex is unique per block, and a tx's logs are");
  console.log("  ordered deterministically. A collision needs the SAME (tx, logIndex) to");
  console.log("  be a different event on the two branches - i.e. the tx moved position in");
  console.log("  the block so its logs shifted onto indexes another log used. Possible,");
  console.log("  narrow. Recording it as a robustness gap, not a live bug.\n");
}

async function testB() {
  await q("DELETE FROM curveball.markets");
  await q("DELETE FROM curveball.trades");
  await q("DELETE FROM curveball.chain_logs");
  console.log("=== (B) market orphaned but not re-found, trades stay live ===");

  // Market launched at block 100 on branch A.
  await q(`INSERT INTO curveball.markets
      (chain_id,token_address,launchpad_address,creator_address,name,symbol,metadata_uri,launch_tx_hash,
       launch_log_index,launch_block,launched_at,total_supply,curve_supply,reserve_amount,reserve_bps,
       initial_virtual_quote,graduation_target_quote,fee_bps,creator_fee_share_bps,buyback_fee_share_bps,
       creator_tax_bps,state,ready_at,orphaned)
     VALUES ($1,$2,$3,$4,'T','T','ipfs://t',$5,3,'100',now(),'1000','800','0',0,'20','40',75,5000,2500,0,'trading',NULL,false)`,
  [CHAIN, TOKEN, LP, "0x" + "7".repeat(40), TX]);

  // A trade on the same market, indexed by the trades stream (which owns the trade topic).
  await insertTrade(logicalId(TOKEN, TRADE_TOPIC), TOKEN, TRADE_TOPIC, "0x" + "d".repeat(64));

  // ---- factory orphan pass (indexer.mjs:356-363): launchpad + lifecycle topics only ----
  await q(`UPDATE curveball.chain_logs SET orphaned = true
           WHERE chain_id=$1 AND block_number BETWEEN '100' AND '100' AND address=$2 AND topic0 = ANY($3::text[])`,
  [CHAIN, LP, ["0x" + "1".repeat(64)]]);
  await q("UPDATE curveball.markets SET orphaned=true WHERE chain_id=$1 AND launch_block BETWEEN '100' AND '100'", [CHAIN]);

  // The launch is NOT re-found on the new branch, so the launch loop does nothing.
  // The trades stream DOES own its own topic, and it re-reads/re-orphans independently.

  const m = await q("SELECT orphaned FROM curveball.markets WHERE chain_id=$1 AND token_address=$2", [CHAIN, TOKEN]);
  const t = await q("SELECT orphaned,count(*)::int AS n FROM curveball.trades WHERE chain_id=$1 GROUP BY orphaned", [CHAIN]);

  console.log("markets.orphaned            =", m.rows[0].orphaned, " (market hidden)");
  console.log("trades rows by orphaned flag =", JSON.stringify(t.rows));

  // What the API does: markets filtered on m.orphaned=false, trades on t.orphaned=false
  const listed = await q("SELECT count(*)::int AS n FROM curveball.markets WHERE chain_id=$1 AND orphaned=false", [CHAIN]);
  const countedTrades = await q("SELECT count(*)::int AS n FROM curveball.trades WHERE chain_id=$1 AND orphaned=false", [CHAIN]);
  console.log("\nAPI view:");
  console.log("  markets in listings (orphaned=false):", listed.rows[0].n);
  console.log("  trades still counted in wallet stats :", countedTrades.rows[0].n);
  console.log("  => a trade contributes to a wallet's volume for a market that no longer exists.\n");
}

async function testC() {
  await q("DELETE FROM curveball.asset_transfers");
  await q("DELETE FROM curveball.curve_positions");
  console.log("=== (C) indexLedgerRange rebuilds neither curve_positions nor market_stats ===");

  await q(`INSERT INTO curveball.asset_transfers
      (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,log_index,
       token_address,from_address,to_address,amount,block_timestamp,orphaned,finalized)
     VALUES ('t1',$1,$2,'100',$3,0,1,$4,$5,$5,'10',now(),false,true)`,
  [CHAIN, "0x" + "d".repeat(64), TX, TOKEN, TRADER]);
  await q(`INSERT INTO curveball.curve_positions
      (chain_id,trader_address,token_address,known_basis_token_balance,total_tokens_bought,total_tokens_sold,
       unknown_basis_tokens_sold,total_invested_quote,total_proceeds_quote,remaining_cost_basis_quote,
       realized_cost_basis_quote,known_basis_proceeds_quote,realized_pnl_quote,trade_count,first_trade_at,last_trade_at,latest_trade_id,methodology_version)
     VALUES ($1,$2,$3,'10','10','0','0','5','0','5','0','0','0',1,now(),now(),'t1','v1')`,
  [CHAIN, TRADER, TOKEN]);

  // The ledger range orphans transfers (indexer.mjs:677) and rebuilds NOTHING derived.
  await q("UPDATE curveball.asset_transfers SET orphaned=true WHERE chain_id=$1 AND block_number BETWEEN '100' AND '100'", [CHAIN]);

  const live = await q("SELECT count(*)::int AS n FROM curveball.asset_transfers WHERE chain_id=$1 AND orphaned=false", [CHAIN]);
  const pos = await q("SELECT known_basis_token_balance FROM curveball.curve_positions WHERE chain_id=$1 AND trader_address=$2", [CHAIN, TRADER]);
  console.log("live asset_transfers after orphaning:", live.rows[0].n);
  console.log("curve_positions.known_basis_token_balance still:", pos.rows[0]?.known_basis_token_balance, "(stale)");

  // The profile query (server.mjs:308-325) COALESCEs the transfer-derived balance over curve_positions.
  const view = await q(`WITH transfer_balances AS (
      SELECT token_address,SUM(CASE WHEN to_address=$2 THEN amount ELSE 0 END)-SUM(CASE WHEN from_address=$2 THEN amount ELSE 0 END) AS balance
      FROM curveball.asset_transfers WHERE chain_id=$1 AND orphaned=false AND (to_address=$2 OR from_address=$2) GROUP BY token_address
    ) SELECT COALESCE((SELECT balance FROM transfer_balances)::text,'MISSING') AS tb,
             (SELECT known_basis_token_balance FROM curveball.curve_positions WHERE chain_id=$1 AND trader_address=$2) AS cp`,
  [CHAIN, TRADER]);
  console.log("transfer-derived balance:", view.rows[0].tb, "-> COALESCEs to curve_positions:", view.rows[0].cp);
  console.log("=> the endpoint returns a stale-but-plausible number rather than erroring.\n");
}

async function main() {
  await q("SELECT 1");
  await testA();
  await testB();
  await testC();
  await q("DELETE FROM curveball.trades");
  await q("DELETE FROM curveball.markets");
  await q("DELETE FROM curveball.asset_transfers");
  await q("DELETE FROM curveball.curve_positions");
  await pool.end();
}
main().catch(async (e) => { console.error(e.message); await pool.end(); process.exit(1); });
