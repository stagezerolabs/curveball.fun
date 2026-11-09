import { config } from "../../../platform/config.mjs";
import { pool } from "../../../platform/db.mjs";
import { boundedLimit } from "../../transport/params.mjs";

export function createNotifications({ query = (...args) => pool.query(...args), chainId = config.chainId } = {}) {
  return {
    async list(address, url) {
      const [result, unread] = await Promise.all([
        query(
          `SELECT n.id,n.kind,n.actor_address,
            n.payload || jsonb_strip_nulls(jsonb_build_object(
              'tokenName',m.name,'tokenSymbol',m.symbol
            )) AS payload,n.read_at,n.created_at
            FROM notifications n
            LEFT JOIN markets m ON m.chain_id=n.chain_id AND m.token_address=n.payload->>'tokenAddress'
            WHERE n.chain_id=$1 AND n.recipient_address=$2
              AND ($3::text[] IS NULL OR n.kind=ANY($3::text[]))
            ORDER BY n.created_at DESC LIMIT $4`,
          [chainId, address, url.searchParams.getAll("kind").length ? url.searchParams.getAll("kind") : null, boundedLimit(url, 30, 100)],
        ),
        query(
          "SELECT COUNT(*) AS unread FROM notifications WHERE chain_id=$1 AND recipient_address=$2 AND read_at IS NULL",
          [chainId, address],
        ),
      ]);
      return { items: result.rows, unreadCount: Number(unread.rows[0]?.unread || 0) };
    },
    async preferences(address) {
      const result = await query(
        "SELECT in_app,trade_buys,trade_sells,launches,graduations,new_followers FROM notification_preferences WHERE chain_id=$1 AND address=$2",
        [chainId, address],
      );
      return result.rows[0] || {
        in_app: true, trade_buys: true, trade_sells: true,
        launches: true, graduations: true, new_followers: true,
      };
    },
    async updatePreferences(address, body) {
      const values = ["inApp", "tradeBuys", "tradeSells", "launches", "graduations", "newFollowers"]
        .map((key) => body[key] !== false);
      const result = await query(
        `INSERT INTO notification_preferences (chain_id,address,in_app,trade_buys,trade_sells,launches,graduations,new_followers)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (chain_id,address) DO UPDATE SET
          in_app=EXCLUDED.in_app,trade_buys=EXCLUDED.trade_buys,trade_sells=EXCLUDED.trade_sells,
          launches=EXCLUDED.launches,graduations=EXCLUDED.graduations,new_followers=EXCLUDED.new_followers
          RETURNING in_app,trade_buys,trade_sells,launches,graduations,new_followers`,
        [chainId, address, ...values],
      );
      return result.rows[0];
    },
    async markRead(address, body) {
      const ids = Array.isArray(body.ids)
        ? body.ids.filter((id) => (Number.isInteger(id) && id >= 0) || (typeof id === "string" && /^\d+$/.test(id))).slice(0, 100)
        : [];
      await query(
        "UPDATE notifications SET read_at=now() WHERE chain_id=$1 AND recipient_address=$2 AND id=ANY($3::bigint[])",
        [chainId, address, ids],
      );
      return { ok: true };
    },
  };
}

export const notifications = createNotifications();
