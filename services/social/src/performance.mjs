import { config } from "./config.mjs";

export const PERFORMANCE_METHODOLOGY = "curve-known-basis-v1";

export async function refreshPerformanceSnapshot(db, address, asOfBlock) {
  await db.query(`WITH position_values AS (
      SELECT cp.realized_pnl_quote,cp.realized_cost_basis_quote,
        CASE WHEN cp.known_basis_token_balance>0 THEN floor(cp.remaining_cost_basis_quote*
          LEAST(cp.known_basis_token_balance,GREATEST(0,COALESCE(tb.balance,cp.known_basis_token_balance)))/cp.known_basis_token_balance) ELSE 0 END AS remaining_cost_basis_quote,
        cp.total_invested_quote,cp.token_address,
        floor(LEAST(cp.known_basis_token_balance,GREATEST(0,COALESCE(tb.balance,cp.known_basis_token_balance)))*
          COALESCE(ms.current_price_x18,0)/1000000000000000000) AS market_value
      FROM curve_positions cp
      LEFT JOIN market_stats ms ON ms.chain_id=cp.chain_id AND ms.token_address=cp.token_address
      LEFT JOIN LATERAL (
        SELECT SUM(CASE WHEN at.to_address=cp.trader_address THEN at.amount ELSE 0 END)-
          SUM(CASE WHEN at.from_address=cp.trader_address THEN at.amount ELSE 0 END) AS balance
        FROM asset_transfers at WHERE at.chain_id=cp.chain_id AND at.token_address=cp.token_address
          AND at.orphaned=false AND (at.to_address=cp.trader_address OR at.from_address=cp.trader_address)
      ) tb ON true
      WHERE cp.chain_id=$1 AND cp.trader_address=$2
    ), position_totals AS (
      SELECT COALESCE(SUM(realized_pnl_quote),0) AS realized_pnl,
        COALESCE(SUM(market_value-remaining_cost_basis_quote),0) AS unrealized_pnl,
        COALESCE(SUM(total_invested_quote),0) AS invested,
        COALESCE(SUM(market_value),0) AS portfolio_value,
        COALESCE(SUM(realized_cost_basis_quote+remaining_cost_basis_quote),0) AS accounted_cost,
        COUNT(*) AS market_count,
        COUNT(*) FILTER (WHERE realized_pnl_quote>0) AS profitable_market_count,
        COALESCE(MAX(market_value),0) AS largest_position
      FROM position_values
    ), trade_totals AS (
      SELECT COUNT(*) AS trade_count,COALESCE(SUM(gross_curve_quote),0) AS gross_volume,
        COALESCE(SUM(net_trader_quote),0) AS cash_turnover
      FROM trades WHERE chain_id=$1 AND trader_address=$2 AND orphaned=false
    )
    INSERT INTO trader_performance_snapshots
      (chain_id,address,period,as_of_block,realized_pnl_quote,unrealized_pnl_quote,invested_quote,
       portfolio_value_quote,gross_quote_volume,wallet_cash_turnover,return_bps,max_drawdown_bps,
       concentration_bps,trade_count,market_count,profitable_market_count,methodology_version)
    SELECT $1,$2,'all',$3,p.realized_pnl,p.unrealized_pnl,p.invested,p.portfolio_value,
      t.gross_volume,t.cash_turnover,
      CASE WHEN p.accounted_cost>0 THEN (p.realized_pnl+p.unrealized_pnl)*10000.0/p.accounted_cost END,
      NULL,CASE WHEN p.portfolio_value>0 THEN p.largest_position*10000.0/p.portfolio_value END,
      t.trade_count,p.market_count,p.profitable_market_count,$4
    FROM position_totals p CROSS JOIN trade_totals t
    ON CONFLICT (chain_id,address,period,as_of_block,methodology_version) DO UPDATE SET
      realized_pnl_quote=EXCLUDED.realized_pnl_quote,unrealized_pnl_quote=EXCLUDED.unrealized_pnl_quote,
      invested_quote=EXCLUDED.invested_quote,portfolio_value_quote=EXCLUDED.portfolio_value_quote,
      gross_quote_volume=EXCLUDED.gross_quote_volume,wallet_cash_turnover=EXCLUDED.wallet_cash_turnover,
      return_bps=EXCLUDED.return_bps,max_drawdown_bps=EXCLUDED.max_drawdown_bps,
      concentration_bps=EXCLUDED.concentration_bps,trade_count=EXCLUDED.trade_count,
      market_count=EXCLUDED.market_count,profitable_market_count=EXCLUDED.profitable_market_count,
      calculated_at=now()`, [config.chainId, address, asOfBlock.toString(), PERFORMANCE_METHODOLOGY]);
}

const scoreExpressions = {
  trending: "COALESCE((SELECT SUM(t.gross_curve_quote) FROM trades t WHERE t.chain_id=$1 AND t.trader_address=latest.address AND t.orphaned=false AND t.block_timestamp>now()-interval '7 days'),0)",
  consistent: "COALESCE(latest.return_bps,0)",
  followers: "(SELECT COUNT(*) FROM follows f WHERE f.chain_id=$1 AND f.followed_address=latest.address)",
  new: "COALESCE(EXTRACT(EPOCH FROM (SELECT MIN(t.block_timestamp) FROM trades t WHERE t.chain_id=$1 AND t.trader_address=latest.address AND t.orphaned=false)),0)",
};

export async function publishLeaderboards(db, asOfBlock) {
  for (const category of Object.keys(scoreExpressions)) {
    const snapshot = await db.query(`INSERT INTO leaderboard_snapshots
      (chain_id,category,period,methodology_version,as_of_block,published_at)
      VALUES ($1,$2,'all',$3,$4,now())
      ON CONFLICT (chain_id,category,period,as_of_block,methodology_version) DO UPDATE SET
        calculated_at=now(),published_at=now() RETURNING id`,
    [config.chainId, category, PERFORMANCE_METHODOLOGY, asOfBlock.toString()]);
    const snapshotId = snapshot.rows[0].id;
    await db.query("DELETE FROM leaderboard_rows WHERE snapshot_id=$1", [snapshotId]);
    await db.query(`WITH latest AS (
        SELECT DISTINCT ON (address) * FROM trader_performance_snapshots
        WHERE chain_id=$1 AND period='all' AND methodology_version=$3 AND as_of_block<=$4
        ORDER BY address,as_of_block DESC
      ), scored AS (
        SELECT latest.address,${scoreExpressions[category]} AS score,
          jsonb_build_object('realizedPnlWei',latest.realized_pnl_quote,'unrealizedPnlWei',latest.unrealized_pnl_quote,
            'returnBps',latest.return_bps,'tradeCount',latest.trade_count,'marketCount',latest.market_count,
            'portfolioValueWei',latest.portfolio_value_quote,'concentrationBps',latest.concentration_bps) AS metrics
        FROM latest JOIN profiles p ON p.chain_id=$1 AND p.address=latest.address AND p.discoverable=true
        WHERE NOT EXISTS (SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=$1 AND pa.address=latest.address AND pa.is_user_attributable=false)
          AND ($2<>'consistent' OR latest.trade_count>=3)
      ), ranked AS (
        SELECT address,score,metrics,row_number() OVER (ORDER BY score DESC,address ASC) AS rank FROM scored
      )
      INSERT INTO leaderboard_rows (snapshot_id,address,rank,score,metrics)
      SELECT $5,address,rank,score,metrics FROM ranked WHERE rank<=100`,
    [config.chainId, category, PERFORMANCE_METHODOLOGY, asOfBlock.toString(), snapshotId]);
  }
}
