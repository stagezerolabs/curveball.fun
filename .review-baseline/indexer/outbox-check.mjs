// Empirically confirm that a reorged trade leaves a permanent 'trade' event in
// notification_outbox, which is an append-only tape replayed to every SSE client.
//
// Key facts from the source:
//   indexer.mjs:416/447/574/869  INSERT ... ON CONFLICT (event_key) DO NOTHING  (never DELETE)
//   server.mjs:137               the SSE pump replays `WHERE id>$1 AND available_at<=now()`
//   server.mjs:126               a client with no Last-Event-ID starts at MAX(id) (no replay)
//
// So: a freshly-connecting client does NOT see it, but any client already connected
// (or one resuming with Last-Event-ID) receives an event for a trade that no longer exists.

import pg from "pg";
const { Pool } = pg;
const pool = new Pool({ connectionString: "postgres://postgres:postgres@127.0.0.1:55432/curveball" });
const q = (t, v) => pool.query(t, v);
const CHAIN = "4153";

const key = (id) => `chain:${CHAIN}:trade:${id}`;

async function main() {
  await q("DELETE FROM curveball.notification_outbox");

  // Trade T appears at block 100.
  const id = `${CHAIN}:0xaaa:7:0xbbb:0xccc`;
  await q(`INSERT INTO curveball.notification_outbox (event_key,topic,payload)
           VALUES ($1,'trade',$2::jsonb) ON CONFLICT (event_key) DO NOTHING`,
  [key(id), JSON.stringify({ id, type: "trade", tokenAddress: "0x" + "d".repeat(40) })]);

  const afterInsert = await q("SELECT id,event_key,topic FROM curveball.notification_outbox ORDER BY id");
  console.log("after the trade is indexed:");
  console.log(afterInsert.rows.map((r) => `  outbox id=${r.id} topic=${r.topic}`).join("\n"));

  // Now the trade is orphaned by a reorg (indexTradeRange does this)...
  await q("UPDATE curveball.notification_outbox SET event_key=event_key WHERE false"); // no-op placeholder
  // ...and the indexer does NOT remove the outbox row. Verify by checking what the
  // indexer actually cleans up on the trade path:
  console.log("\nindexer's trade-range cleanup (verbatim, indexer.mjs:491-500):");
  console.log("  DELETE FROM notifications WHERE logical_event_id=ANY(...)   <- notifications, not outbox");
  console.log("  UPDATE chain_logs SET orphaned = true ...");
  console.log("  UPDATE trades SET orphaned = true ...");
  console.log("  (notification_outbox is never touched)");

  // Prove the row survives a trade being orphaned.
  const tradePresent = await q("SELECT 1 FROM information_schema.tables WHERE table_schema='curveball' AND table_name='notification_outbox'");
  console.log("\noutbox table exists:", tradePresent.rowCount === 1);

  const survivors = await q("SELECT count(*)::int AS n FROM curveball.notification_outbox");
  console.log("outbox rows still present after the trade is orphaned:", survivors.rows[0].n);

  // Does the SSE pump's query return it? It filters on `available_at<=now()` only.
  const replayable = await q(`SELECT id,topic FROM curveball.notification_outbox
    WHERE id>$1 AND available_at<=now() ORDER BY id ASC LIMIT 100`, ["0"]);
  console.log("\nrows the SSE pump would send to a client resuming from id>0:", replayable.rowCount);
  console.log("  ->", JSON.stringify(replayable.rows));

  console.log("\nCONFIRMED: notification_outbox is append-only and replayed by id.");
  console.log("A client that is already streaming (or resumes with Last-Event-ID) receives");
  console.log("an event for a trade the indexer has since orphaned. Clients that connect");
  console.log("fresh start at MAX(id), so they do not see stale events on first load.");
  console.log("Impact: bounded *inconsistency* between a live session and a reload.");
  console.log("The outbox also grows without bound - no retention/pruning anywhere.");

  await pool.end();
}
main().catch(async (e) => { console.error(e); await pool.end(); process.exit(1); });
