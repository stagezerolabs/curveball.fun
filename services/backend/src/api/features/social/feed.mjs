import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";
import { addressParam, boundedLimit, decodeCursor, encodeCursor } from "../../transport/params.mjs";

export async function feed(url, viewer) {
  const limit = boundedLimit(url);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const legacyBefore = url.searchParams.get("before");
  const beforeAt = typeof cursor?.at === "string" ? cursor.at : legacyBefore;
  const beforeId = typeof cursor?.id === "string" ? cursor.id : null;
  const scope = url.searchParams.get("scope") || "global";
  const trader = url.searchParams.get("trader")
    ? addressParam(url.searchParams.get("trader"))
    : null;
  if (scope === "following" && !viewer)
    throw Object.assign(new Error("Sign in to view followed traders."), {
      status: 401,
    });
  const values = [
    config.chainId,
    limit,
    beforeAt || null,
    viewer || null,
    scope,
    trader,
    beforeId,
  ];
  const result = await pool.query(
    `SELECT t.logical_id AS id, t.trader_address, t.is_buy, t.net_trader_quote AS quote_amount_wei,
       t.token_amount AS token_amount_wei, t.virtual_quote_after, t.virtual_token_after,
       t.transaction_hash, t.log_index, t.block_timestamp, m.token_address, m.name AS token_name,
       m.symbol AS token_symbol, m.launchpad_address, n.note,
       (SELECT COUNT(*) FROM trade_reactions rx WHERE rx.logical_trade_id=t.logical_id) AS reaction_count,
       EXISTS(SELECT 1 FROM trade_reactions rx WHERE rx.logical_trade_id=t.logical_id AND rx.reactor_address=$4) AS reacted,
       EXISTS(SELECT 1 FROM follows fv WHERE fv.chain_id=t.chain_id AND fv.follower_address=$4 AND fv.followed_address=t.trader_address) AS is_followed,
       (SELECT COUNT(*) FROM follows f2 WHERE f2.chain_id = t.chain_id AND f2.followed_address = t.trader_address) AS follower_count
     FROM trades t
     JOIN markets m ON m.chain_id = t.chain_id AND m.token_address = t.token_address AND m.orphaned = false
     LEFT JOIN trade_notes n ON n.logical_trade_id = t.logical_id AND NOT EXISTS (
       SELECT 1 FROM reports r
       WHERE r.chain_id=t.chain_id AND r.subject_trade_id=t.logical_id AND r.status='actioned'
     )
     WHERE t.chain_id = $1 AND t.orphaned = false
       AND ($3::timestamptz IS NULL OR t.block_timestamp < $3::timestamptz
         OR (t.block_timestamp=$3::timestamptz AND $7::text IS NOT NULL AND t.logical_id < $7))
       AND ($4::text IS NULL OR $5::text <> 'following' OR EXISTS (
         SELECT 1 FROM follows f WHERE f.chain_id = t.chain_id AND f.follower_address = $4 AND f.followed_address = t.trader_address
       ))
       AND ($6::text IS NULL OR t.trader_address = $6)
       AND ($4::text IS NULL OR NOT EXISTS (
         SELECT 1 FROM blocks b WHERE b.chain_id=t.chain_id AND (
           (b.blocker_address=$4 AND b.blocked_address=t.trader_address)
           OR (b.blocker_address=t.trader_address AND b.blocked_address=$4)
         )
       ))
     ORDER BY t.block_timestamp DESC, t.logical_id DESC LIMIT $2`,
    values,
  );
  const last = result.rows.at(-1);
  return {
    items: result.rows,
    nextCursor:
      last && result.rows.length === limit
        ? encodeCursor({ at: last.block_timestamp, id: last.id })
        : null,
  };
}
