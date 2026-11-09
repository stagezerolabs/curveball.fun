import { randomUUID } from "node:crypto";
import { config } from "../../../platform/config.mjs";
import { pool, transaction } from "../../../platform/db.mjs";
import { addressParam } from "../../transport/params.mjs";
import { invalidateBlock, invalidateFollow } from "../pulse/pulse.mjs";
import { invalidateLeaderboards } from "../pulse/leaderboards.mjs";

// Database dependencies are accepted here so write behavior can be tested without HTTP or Postgres.
export function createSocialActions({
  query = (...args) => pool.query(...args),
  runTransaction = transaction,
  chainId = config.chainId,
  onFollow = invalidateFollow,
  onBlock = invalidateBlock,
  onLeaderboardChange = invalidateLeaderboards,
  makeId = randomUUID,
} = {}) {
  return {
    async setFollow(follower, followedValue, active) {
      const followed = addressParam(followedValue);
      if (!followed || followed === follower)
        throw Object.assign(new Error("Choose another trader to follow."), { status: 400 });
      if (active) {
        await runTransaction(async (db) => {
          const blocked = await db.query(
            `SELECT 1 FROM blocks WHERE chain_id=$1 AND (
              (blocker_address=$2 AND blocked_address=$3) OR (blocker_address=$3 AND blocked_address=$2)
            )`,
            [chainId, follower, followed],
          );
          if (blocked.rowCount)
            throw Object.assign(new Error("This follow is unavailable because one wallet has blocked the other."), { status: 409 });
          const inserted = await db.query(
            "INSERT INTO follows (chain_id,follower_address,followed_address) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING followed_address",
            [chainId, follower, followed],
          );
          if (inserted.rowCount)
            await db.query(
              `INSERT INTO notifications (chain_id,recipient_address,kind,actor_address,logical_event_id,payload)
                SELECT $1,$2,'new_follower',$3,$4,'{}'
                WHERE COALESCE((SELECT in_app AND new_followers FROM notification_preferences WHERE chain_id=$1 AND address=$2),true)`,
              [chainId, followed, follower, makeId()],
            );
        });
      } else {
        await query(
          "DELETE FROM follows WHERE chain_id=$1 AND follower_address=$2 AND followed_address=$3",
          [chainId, follower, followed],
        );
      }
      onFollow(follower);
      onLeaderboardChange();
      return { following: active };
    },

    async setBlock(blocker, blockedValue, active) {
      const blocked = addressParam(blockedValue);
      if (!blocked || blocked === blocker)
        throw Object.assign(new Error("Choose another trader to block."), { status: 400 });
      if (active) {
        await runTransaction(async (db) => {
          await db.query(
            "INSERT INTO blocks (chain_id,blocker_address,blocked_address) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
            [chainId, blocker, blocked],
          );
          await db.query(
            `DELETE FROM follows WHERE chain_id=$1 AND (
              (follower_address=$2 AND followed_address=$3) OR (follower_address=$3 AND followed_address=$2)
            )`,
            [chainId, blocker, blocked],
          );
        });
      } else {
        await query(
          "DELETE FROM blocks WHERE chain_id=$1 AND blocker_address=$2 AND blocked_address=$3",
          [chainId, blocker, blocked],
        );
      }
      onBlock(blocker, blocked);
      return { blocked: active };
    },

    async report(reporter, body) {
      const subject = addressParam(body.subjectAddress);
      const allowed = new Set(["spam", "impersonation", "manipulation", "harmful_content", "other"]);
      const tradeId = body.tradeId == null
        ? null
        : typeof body.tradeId === "string" && body.tradeId.length <= 256 ? body.tradeId : "";
      if (!subject || subject === reporter || !allowed.has(body.reason) || (body.tradeId != null && !tradeId))
        throw Object.assign(new Error("Choose a valid report reason."), { status: 400 });
      if (tradeId) {
        const trade = await query(
          "SELECT trader_address FROM trades WHERE logical_id=$1 AND chain_id=$2 AND orphaned=false",
          [tradeId, chainId],
        );
        if (!trade.rows[0] || trade.rows[0].trader_address !== subject)
          throw Object.assign(new Error("The reported trade does not belong to that wallet."), { status: 400 });
      }
      await query(
        "INSERT INTO reports (chain_id,reporter_address,subject_address,subject_trade_id,reason,details) VALUES ($1,$2,$3,$4,$5,$6)",
        [chainId, reporter, subject, tradeId, body.reason, typeof body.details === "string" ? body.details.slice(0, 1000) : ""],
      );
      return { ok: true };
    },

    async setTradeNote(author, body) {
      const tradeId = typeof body.tradeId === "string" ? body.tradeId : "";
      const note = typeof body.note === "string" ? body.note.trim().slice(0, 240) : "";
      const trade = await query(
        "SELECT trader_address FROM trades WHERE logical_id=$1 AND chain_id=$2 AND orphaned=false",
        [tradeId, chainId],
      );
      if (!trade.rows[0] || trade.rows[0].trader_address !== author)
        throw Object.assign(new Error("Only the wallet that made this trade can attach a note."), { status: 403 });
      if (note) {
        await query(
          `INSERT INTO trade_notes (logical_trade_id,chain_id,author_address,note) VALUES ($1,$2,$3,$4)
            ON CONFLICT (logical_trade_id) DO UPDATE SET note=EXCLUDED.note,updated_at=now()`,
          [tradeId, chainId, author, note],
        );
      } else {
        await query("DELETE FROM trade_notes WHERE logical_trade_id=$1 AND author_address=$2", [tradeId, author]);
      }
      return { note: note || null };
    },

    async setTradeReaction(reactor, body) {
      const tradeId = typeof body.tradeId === "string" ? body.tradeId : "";
      const trade = await query(
        "SELECT trader_address,token_address FROM trades WHERE logical_id=$1 AND chain_id=$2 AND orphaned=false",
        [tradeId, chainId],
      );
      if (!trade.rows[0])
        throw Object.assign(new Error("Trade not found."), { status: 404 });
      if (body.active === false) {
        await query("DELETE FROM trade_reactions WHERE logical_trade_id=$1 AND reactor_address=$2", [tradeId, reactor]);
      } else {
        await query(
          "INSERT INTO trade_reactions (logical_trade_id,chain_id,reactor_address) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING",
          [tradeId, chainId, reactor],
        );
        if (trade.rows[0].trader_address !== reactor)
          await query(
            `INSERT INTO notifications (chain_id,recipient_address,kind,actor_address,logical_event_id,payload)
              SELECT $1,$2,'reaction',$3,$4,$5::jsonb
              WHERE COALESCE((SELECT in_app FROM notification_preferences WHERE chain_id=$1 AND address=$2),true)=true
              ON CONFLICT DO NOTHING`,
            [chainId, trade.rows[0].trader_address, reactor, `${tradeId}:reaction:${reactor}`,
              JSON.stringify({ tradeId, tokenAddress: trade.rows[0].token_address })],
          );
      }
      const count = await query("SELECT COUNT(*) AS count FROM trade_reactions WHERE logical_trade_id=$1", [tradeId]);
      return { active: body.active !== false, count: Number(count.rows[0].count) };
    },
  };
}

export const socialActions = createSocialActions();
