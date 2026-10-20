import { config } from "./config.mjs";

export const PERFORMANCE_METHODOLOGY = "curve-known-basis-v2";

// Quote amounts use the chain's 18-decimal WETH. These are sample floors, not
// claims that a ranked wallet is safe to follow or that its trades were human.
// Trading-day counts bucket each wallet's trades into 24-hour windows anchored at that wallet's
// first trade, so a session crossing a global midnight counts once instead of twice.
export const LEADERBOARD_RULES = Object.freeze({
  minimumInvestedWei: "10000000000000000", // 0.01 WETH in cumulative curve buys
  minimumFollowerInvestedWei: "5000000000000000", // 0.005 WETH
  establishedTrades: 6,
  establishedTradingDays: 3,
  establishedMarkets: 2,
  emergingTrades: 4,
  emergingTradingDays: 2,
  emergingMarkets: 2,
  emergingWindowDays: 14,
  activeTradingDays: 2,
  activeMarkets: 2,
  activeWindowDays: 7,
  followerWindowDays: 30,
  openPriceMaxAgeDays: 7,
});

const methodologyCaveat = "Estimated from known-basis curve trades and last curve prices; transfers and other venues can make wallet PnL incomplete. Open positions and future outcomes may differ.";

export async function refreshPerformanceSnapshot(db, address, asOfBlock) {
  await db.query(`WITH position_values AS (
      SELECT cp.realized_pnl_quote,
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
      CASE WHEN p.invested>0 THEN (p.realized_pnl+p.unrealized_pnl)*10000.0/p.invested END,
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
  // Bounded breadth favors repeated participation across days and markets,
  // without paying a rank bonus for every bot-generated swap or gross volume.
  trending: "LEAST(activity.recent_trading_day_count,7)*8+LEAST(activity.recent_market_count,4)",
  consistent: "(latest.realized_pnl_quote+pricing.marked_unrealized_pnl_quote)*10000.0/NULLIF(latest.invested_quote,0)",
  // Only followers with a recorded curve trade count toward this social signal.
  followers: "(SELECT COUNT(*) FROM follows f WHERE f.chain_id=$1 AND f.followed_address=latest.address AND EXISTS (SELECT 1 FROM trades ft WHERE ft.chain_id=$1 AND ft.trader_address=f.follower_address AND ft.orphaned=false))",
  new: "(latest.realized_pnl_quote+pricing.marked_unrealized_pnl_quote)/1000000000000000000.0",
};

const eligibleExpressions = {
  trending: `activity.recent_trading_day_count>=${LEADERBOARD_RULES.activeTradingDays}
    AND activity.recent_market_count>=${LEADERBOARD_RULES.activeMarkets}
    AND activity.recent_invested_quote>=${LEADERBOARD_RULES.minimumInvestedWei}
    AND latest.realized_pnl_quote+pricing.marked_unrealized_pnl_quote>0
    AND pricing.stale_open_market_count=0 AND pricing.external_outbound_count=0`,
  consistent: `latest.trade_count>=${LEADERBOARD_RULES.establishedTrades}
    AND activity.trading_day_count>=${LEADERBOARD_RULES.establishedTradingDays}
    AND latest.market_count>=${LEADERBOARD_RULES.establishedMarkets}
    AND latest.invested_quote>=${LEADERBOARD_RULES.minimumInvestedWei}
    AND latest.realized_pnl_quote+pricing.marked_unrealized_pnl_quote>0
    AND pricing.stale_open_market_count=0 AND pricing.external_outbound_count=0`,
  followers: `latest.trade_count>=2
    AND activity.trading_day_count>=2
    AND latest.invested_quote>=${LEADERBOARD_RULES.minimumFollowerInvestedWei}
    AND activity.last_trade_at>now()-interval '${LEADERBOARD_RULES.followerWindowDays} days'`,
  new: `latest.trade_count>=${LEADERBOARD_RULES.emergingTrades}
    AND activity.trading_day_count>=${LEADERBOARD_RULES.emergingTradingDays}
    AND latest.market_count>=${LEADERBOARD_RULES.emergingMarkets}
    AND latest.invested_quote>=${LEADERBOARD_RULES.minimumInvestedWei}
    AND activity.first_trade_at>now()-interval '${LEADERBOARD_RULES.emergingWindowDays} days'
    AND latest.realized_pnl_quote+pricing.marked_unrealized_pnl_quote>0
    AND pricing.stale_open_market_count=0 AND pricing.external_outbound_count=0`,
};

export async function publishLeaderboards(db, asOfBlock) {
  const categories = Object.keys(scoreExpressions);
  const snapshotIds = [];
  for (const category of categories) {
    const snapshot = await db.query(`INSERT INTO leaderboard_snapshots
      (chain_id,category,period,methodology_version,as_of_block,published_at)
      VALUES ($1,$2,'all',$3,$4,now())
      ON CONFLICT (chain_id,category,period,as_of_block,methodology_version) DO UPDATE SET
        calculated_at=now(),published_at=now() RETURNING id`,
    [config.chainId, category, PERFORMANCE_METHODOLOGY, asOfBlock.toString()]);
    const snapshotId = snapshot.rows[0].id;
    await db.query("DELETE FROM leaderboard_rows WHERE snapshot_id=$1", [snapshotId]);
    snapshotIds.push(snapshotId);
  }

  const candidateExpression = (expression) => expression.replace(/\b(?:latest|activity|pricing)\./g, "candidate.");
  const categoryRows = categories.map((category, index) => `('${category}',$${index + 5}::uuid)`).join(",");
  const scores = categories.map((category) =>
    `WHEN categories.category='${category}' THEN ${candidateExpression(scoreExpressions[category])}`).join(" ");
  const eligibility = categories.map((category) =>
    `(categories.category='${category}' AND ${candidateExpression(eligibleExpressions[category])})`).join(" OR ");

  // MATERIALIZED makes the wallet activity/price work happen once per publish,
  // even though the same candidates appear in four category rankings.
  await db.query(`WITH latest AS (
      SELECT DISTINCT ON (address) * FROM trader_performance_snapshots
      WHERE chain_id=$1 AND period='all' AND methodology_version IN ('curve-known-basis-v1',$2) AND as_of_block<=$3
      ORDER BY address,as_of_block DESC,methodology_version DESC
    ), candidate AS MATERIALIZED (
      SELECT latest.*,activity.*,pricing.*,
        (SELECT COALESCE(SUM(cost.realized_cost_basis_quote),0)::text FROM curve_positions cost
          WHERE cost.chain_id=$1 AND cost.trader_address=latest.address) AS realized_cost_wei
      FROM latest
      CROSS JOIN LATERAL (
        SELECT (EXTRACT(EPOCH FROM MIN(t.block_timestamp)))::bigint AS day0_epoch
        FROM trades t WHERE t.chain_id=$1 AND t.trader_address=latest.address AND t.orphaned=false
      ) activity_window
      CROSS JOIN LATERAL (
        SELECT COUNT(DISTINCT (EXTRACT(EPOCH FROM t.block_timestamp)::bigint-activity_window.day0_epoch)/86400) AS trading_day_count,
          MIN(t.block_timestamp) AS first_trade_at,MAX(t.block_timestamp) AS last_trade_at,
          COUNT(DISTINCT (EXTRACT(EPOCH FROM t.block_timestamp)::bigint-activity_window.day0_epoch)/86400)
            FILTER (WHERE t.block_timestamp>now()-interval '${LEADERBOARD_RULES.activeWindowDays} days') AS recent_trading_day_count,
          COUNT(DISTINCT t.token_address)
            FILTER (WHERE t.block_timestamp>now()-interval '${LEADERBOARD_RULES.activeWindowDays} days') AS recent_market_count,
          COALESCE(SUM(t.net_trader_quote) FILTER (WHERE t.is_buy AND t.block_timestamp>now()-interval '${LEADERBOARD_RULES.activeWindowDays} days'),0) AS recent_invested_quote,
          COALESCE(SUM(t.net_trader_quote) FILTER (WHERE t.block_timestamp>now()-interval '${LEADERBOARD_RULES.activeWindowDays} days'),0) AS recent_volume_quote
        FROM trades t WHERE t.chain_id=$1 AND t.trader_address=latest.address AND t.orphaned=false
      ) activity
      CROSS JOIN LATERAL (
        SELECT COUNT(*) FILTER (WHERE holdings.effective_balance>0 AND
            (holdings.current_price_x18 IS NULL OR holdings.current_price_x18=0
              OR holdings.latest_trade_at IS NULL
              OR holdings.latest_trade_at<now()-interval '${LEADERBOARD_RULES.openPriceMaxAgeDays} days'))
            AS stale_open_market_count,
          COALESCE(SUM(floor(holdings.effective_balance*COALESCE(holdings.current_price_x18,0)/1000000000000000000)
            - CASE WHEN holdings.known_basis_token_balance>0 THEN
                floor(holdings.remaining_cost_basis_quote*holdings.effective_balance/holdings.known_basis_token_balance)
              ELSE 0 END),0) AS marked_unrealized_pnl_quote,
          COALESCE(SUM(floor(holdings.effective_balance*COALESCE(holdings.current_price_x18,0)/1000000000000000000)),0)
            AS marked_portfolio_value_quote,
          COALESCE(MAX(floor(holdings.effective_balance*COALESCE(holdings.current_price_x18,0)/1000000000000000000)),0)
            AS largest_marked_position_quote,
          (SELECT COUNT(*) FROM asset_transfers outgoing
            JOIN curve_positions position ON position.chain_id=outgoing.chain_id
              AND position.token_address=outgoing.token_address AND position.trader_address=latest.address
            WHERE outgoing.chain_id=$1 AND outgoing.from_address=latest.address AND outgoing.orphaned=false
              AND NOT EXISTS (SELECT 1 FROM trades sell WHERE sell.chain_id=$1
                AND sell.trader_address=latest.address AND sell.token_address=outgoing.token_address
                AND sell.transaction_hash=outgoing.transaction_hash AND sell.is_buy=false AND sell.orphaned=false))
            AS external_outbound_count
        FROM (
          SELECT cp.known_basis_token_balance,cp.remaining_cost_basis_quote,
            ms.current_price_x18,ms.latest_trade_at,
            LEAST(cp.known_basis_token_balance,GREATEST(0,COALESCE(tb.balance,cp.known_basis_token_balance))) AS effective_balance
          FROM curve_positions cp
          LEFT JOIN market_stats ms ON ms.chain_id=cp.chain_id AND ms.token_address=cp.token_address
          LEFT JOIN LATERAL (
            SELECT SUM(CASE WHEN at.to_address=latest.address THEN at.amount ELSE 0 END)-
              SUM(CASE WHEN at.from_address=latest.address THEN at.amount ELSE 0 END) AS balance
            FROM asset_transfers at WHERE at.chain_id=$1 AND at.token_address=cp.token_address
              AND at.orphaned=false AND (at.to_address=latest.address OR at.from_address=latest.address)
          ) tb ON true
          WHERE cp.chain_id=$1 AND cp.trader_address=latest.address
        ) holdings
      ) pricing
      WHERE NOT EXISTS (SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=$1 AND pa.address=latest.address AND pa.is_user_attributable=false)
    ), categories(category,snapshot_id) AS (VALUES ${categoryRows}), scored AS (
      SELECT categories.snapshot_id,candidate.address,
        CASE ${scores} END AS score,
        candidate.realized_pnl_quote+candidate.marked_unrealized_pnl_quote AS net_pnl,
        jsonb_build_object('realizedPnlWei',candidate.realized_pnl_quote::text,
          'unrealizedPnlWei',candidate.marked_unrealized_pnl_quote::text,
          'netPnlWei',(candidate.realized_pnl_quote+candidate.marked_unrealized_pnl_quote)::text,
          'investedWei',candidate.invested_quote::text,'realizedCostWei',candidate.realized_cost_wei,
          'returnBps',(candidate.realized_pnl_quote+candidate.marked_unrealized_pnl_quote)*10000.0/NULLIF(candidate.invested_quote,0),
          'tradeCount',candidate.trade_count,'marketCount',candidate.market_count,
          'tradingDayCount',candidate.trading_day_count,'recentTradingDayCount',candidate.recent_trading_day_count,
          'recentMarketCount',candidate.recent_market_count,'recentInvestedWei',candidate.recent_invested_quote::text,
          'recentVolumeWei',candidate.recent_volume_quote::text,'volumeWei',candidate.wallet_cash_turnover::text,
          'firstTradeAt',candidate.first_trade_at,'lastTradeAt',candidate.last_trade_at,
          'staleOpenMarketCount',candidate.stale_open_market_count,
          'externalOutboundTransferCount',candidate.external_outbound_count,
          'sampleLabel',CASE WHEN categories.category='consistent' THEN 'established' ELSE 'provisional' END,
          'methodologyVersion',$2,'methodologyCaveat',$4::text,
          'portfolioValueWei',candidate.marked_portfolio_value_quote::text,
          'concentrationBps',CASE WHEN candidate.marked_portfolio_value_quote>0 THEN
            candidate.largest_marked_position_quote*10000.0/candidate.marked_portfolio_value_quote END) AS metrics
      FROM candidate CROSS JOIN categories WHERE ${eligibility}
    ), ranked AS (
      SELECT snapshot_id,address,score,metrics,
        row_number() OVER (PARTITION BY snapshot_id ORDER BY score DESC,net_pnl DESC,address ASC) AS rank
      FROM scored
    )
    INSERT INTO leaderboard_rows (snapshot_id,address,rank,score,metrics)
    SELECT snapshot_id,address,rank,score,metrics FROM ranked WHERE rank<=100`,
  [config.chainId, PERFORMANCE_METHODOLOGY, asOfBlock.toString(), methodologyCaveat, ...snapshotIds]);
}
