import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";

const statsSql = `
  WITH activity AS (
    SELECT t.trader_address,
      COUNT(*) AS trade_count,
      COUNT(*) FILTER (WHERE t.is_buy) AS buy_count,
      COUNT(*) FILTER (WHERE NOT t.is_buy) AS sell_count,
      SUM(t.net_trader_quote) AS volume_wei,
      COUNT(DISTINCT t.token_address) AS markets_traded,
      MIN(t.block_timestamp) AS first_trade,
      MAX(t.block_timestamp) AS last_trade
    FROM trades t WHERE t.chain_id = $1 AND t.orphaned = false
      AND NOT EXISTS (
        SELECT 1 FROM protocol_accounts pa
        WHERE pa.chain_id=t.chain_id AND pa.address=t.trader_address AND pa.is_user_attributable=false
      )
    GROUP BY t.trader_address
  ), performance AS (
    SELECT trader_address,
      SUM(realized_pnl_quote) AS realized_pnl_wei,
      SUM(realized_cost_basis_quote) AS realized_cost_wei
    FROM curve_positions WHERE chain_id=$1 GROUP BY trader_address
  ), wallet AS (
    SELECT a.*,COALESCE(p.realized_pnl_wei,0) AS realized_pnl_wei,
      COALESCE(p.realized_cost_wei,0) AS realized_cost_wei
    FROM activity a LEFT JOIN performance p USING (trader_address)
  )
`;

function shapeStats(row) {
  if (!row)
    return {
      tradeCount: 0,
      buyCount: 0,
      sellCount: 0,
      volumeWei: "0",
      realizedPnlWei: "0",
      realizedReturnPct: null,
      marketsTraded: 0,
      firstTrade: null,
      lastTrade: null,
    };
  const cost = Number(row.realized_cost_wei || 0);
  const pnl = Number(row.realized_pnl_wei || 0);
  return {
    tradeCount: Number(row.trade_count || 0),
    buyCount: Number(row.buy_count || 0),
    sellCount: Number(row.sell_count || 0),
    volumeWei: String(row.volume_wei || 0),
    realizedPnlWei: String(row.realized_pnl_wei || 0),
    realizedReturnPct: cost > 0 ? (pnl / cost) * 100 : null,
    marketsTraded: Number(row.markets_traded || 0),
    firstTrade: row.first_trade,
    lastTrade: row.last_trade,
  };
}

export async function profile(address, viewer) {
  const [profileResult, statsResult, countsResult, positionsResult] =
    await Promise.all([
      pool.query(
        "SELECT claimed_at, updated_at FROM profiles WHERE chain_id = $1 AND address = $2",
        [config.chainId, address],
      ),
      pool.query(`${statsSql} SELECT * FROM wallet WHERE trader_address = $2`, [
        config.chainId,
        address,
      ]),
      pool.query(
        `SELECT
      (SELECT COUNT(*) FROM follows WHERE chain_id = $1 AND followed_address = $2) AS followers,
      (SELECT COUNT(*) FROM follows WHERE chain_id = $1 AND follower_address = $2) AS following,
      EXISTS(SELECT 1 FROM follows WHERE chain_id = $1 AND follower_address = $3 AND followed_address = $2) AS is_followed,
      EXISTS(SELECT 1 FROM blocks WHERE chain_id = $1 AND blocker_address = $3 AND blocked_address = $2) AS is_blocked`,
        [config.chainId, address, viewer || ""],
      ),
      pool.query(
        `WITH transfer_balances AS (
        SELECT token_address,SUM(CASE WHEN to_address=$2 THEN amount ELSE 0 END)-SUM(CASE WHEN from_address=$2 THEN amount ELSE 0 END) AS balance
        FROM asset_transfers WHERE chain_id=$1 AND orphaned=false AND (to_address=$2 OR from_address=$2) GROUP BY token_address
      ), position_tokens AS (
        SELECT token_address FROM curve_positions WHERE chain_id=$1 AND trader_address=$2
        UNION SELECT token_address FROM transfer_balances WHERE balance>0
      ), priced_trades AS (
        SELECT t.token_address,t.is_buy,t.net_trader_quote,
          CASE WHEN m.total_supply>0 AND t.virtual_quote_after>0 AND t.virtual_token_after>0
            THEN floor(t.virtual_quote_after*m.total_supply/t.virtual_token_after)
          END AS market_cap_wei
        FROM trades t JOIN markets m ON m.chain_id=t.chain_id AND m.token_address=t.token_address
        WHERE t.chain_id=$1 AND t.trader_address=$2 AND t.orphaned=false
      ), trade_averages AS (
        SELECT token_address,
          floor(SUM(market_cap_wei*net_trader_quote) FILTER (WHERE is_buy)
            / NULLIF(SUM(net_trader_quote) FILTER (WHERE is_buy AND market_cap_wei IS NOT NULL),0))::text
            AS average_entry_market_cap_wei,
          floor(SUM(market_cap_wei*net_trader_quote) FILTER (WHERE NOT is_buy)
            / NULLIF(SUM(net_trader_quote) FILTER (WHERE NOT is_buy AND market_cap_wei IS NOT NULL),0))::text
            AS average_exit_market_cap_wei
        FROM priced_trades GROUP BY token_address
      ) SELECT pt.token_address,m.name AS token_name,m.symbol AS token_symbol,
        COALESCE(tb.balance,cp.known_basis_token_balance,0) AS balance_wei,
        COALESCE(cp.known_basis_token_balance,0) AS known_basis_balance_wei,
        (tb.token_address IS NOT NULL) AS exact_balance_indexed,
        COALESCE(cp.total_invested_quote,0) AS invested_wei,COALESCE(cp.total_proceeds_quote,0) AS proceeds_wei,
        ta.average_entry_market_cap_wei,ta.average_exit_market_cap_wei,
        ms.virtual_quote AS virtual_quote_after,ms.virtual_token AS virtual_token_after
      FROM position_tokens pt JOIN markets m ON m.chain_id=$1 AND m.token_address=pt.token_address
      LEFT JOIN transfer_balances tb ON tb.token_address=pt.token_address
      LEFT JOIN curve_positions cp ON cp.chain_id=$1 AND cp.trader_address=$2 AND cp.token_address=pt.token_address
      LEFT JOIN trade_averages ta ON ta.token_address=pt.token_address
      JOIN market_stats ms ON ms.chain_id=$1 AND ms.token_address=pt.token_address
      WHERE COALESCE(tb.balance,cp.known_basis_token_balance,0)>0
      ORDER BY COALESCE(cp.total_invested_quote,0) DESC`,
        [config.chainId, address],
      ),
    ]);
  const claimed = profileResult.rows[0] || null;
  return {
    address,
    claimed: Boolean(claimed),
    claimedAt: claimed?.claimed_at || null,
    stats: shapeStats(statsResult.rows[0]),
    followers: Number(countsResult.rows[0]?.followers || 0),
    following: Number(countsResult.rows[0]?.following || 0),
    isFollowed: Boolean(countsResult.rows[0]?.is_followed),
    isBlocked: Boolean(countsResult.rows[0]?.is_blocked),
    positions: positionsResult.rows,
  };
}
