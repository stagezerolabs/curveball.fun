const pulseActorWindowsSql = (following) => `WITH actor_windows AS (
  SELECT t.token_address,t.trader_address,
    FLOOR(EXTRACT(EPOCH FROM t.block_timestamp)/$4::integer) AS bucket,
    MIN(t.block_timestamp) AS first_at,MAX(t.block_timestamp) AS latest_at,
    COUNT(*) AS trade_count,
    COUNT(*) FILTER (WHERE t.is_buy) AS buy_count,
    COUNT(*) FILTER (WHERE NOT t.is_buy) AS sell_count,
    COALESCE(SUM(t.net_trader_quote) FILTER (WHERE t.is_buy),0) AS buy_quote_wei,
    COALESCE(SUM(t.net_trader_quote) FILTER (WHERE NOT t.is_buy),0) AS sell_quote_wei,
    MIN(t.transaction_hash) AS transaction_hash
  FROM trades t WHERE t.chain_id=$1 AND t.orphaned=false
    AND t.block_timestamp>=$5::timestamptz-$2::interval
    AND t.block_timestamp<=$5::timestamptz
    AND NOT EXISTS (SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=t.chain_id
      AND pa.address=t.trader_address AND pa.is_user_attributable=false)
    AND NOT (t.trader_address=ANY($6::text[]))
    ${following ? `AND t.trader_address=ANY(ARRAY(
      SELECT f.followed_address FROM follows f WHERE f.chain_id=$1 AND f.follower_address=$3
    ))` : ""}
  GROUP BY t.token_address,t.trader_address,bucket
)`;

const marketMomentsSql = `, market_windows AS (
  SELECT token_address,bucket,MIN(first_at) AS first_at,MAX(latest_at) AS latest_at,
    SUM(trade_count) AS trade_count,SUM(buy_count) AS buy_count,SUM(sell_count) AS sell_count,
    SUM(buy_quote_wei) AS buy_quote_wei,SUM(sell_quote_wei) AS sell_quote_wei,
    COUNT(*) AS distinct_wallet_count,SUM(LEAST(trade_count,3)) AS actor_score,
    MIN(transaction_hash) AS transaction_hash
  FROM actor_windows GROUP BY token_address,bucket
), ranked_windows AS (
  SELECT mw.*,m.name AS token_name,m.symbol AS token_symbol,
    (LEAST(mw.actor_score,24)+LEAST(mw.distinct_wallet_count,8)*2
      + CASE WHEN $3::text IS NOT NULL THEN LEAST(mw.distinct_wallet_count,3)*2 ELSE 0 END) /
      (1+GREATEST(0,EXTRACT(EPOCH FROM ($5::timestamptz-mw.latest_at))/3600) /
        (CASE WHEN $4::integer=900 THEN 0.5 ELSE 4 END)) AS relevance
  FROM market_windows mw JOIN markets m ON m.chain_id=$1 AND m.token_address=mw.token_address AND m.orphaned=false
), best_per_market AS (
  SELECT *,ROW_NUMBER() OVER (PARTITION BY token_address ORDER BY relevance DESC,latest_at DESC) AS token_rank
  FROM ranked_windows
) SELECT * FROM best_per_market WHERE token_rank=1 ORDER BY relevance DESC,latest_at DESC LIMIT 12`;

export const followingPulseSql = pulseActorWindowsSql(true) + marketMomentsSql;

// Now: one row per market over the whole window, kept only when buy value beat sell value and
// ranked by net inflow. Params: $1 chain, $2 interval, $3 asOf, $4 blocked wallets.
export const nowPulseSql = `SELECT t.token_address,m.name AS token_name,m.symbol AS token_symbol,
    MIN(t.block_timestamp) AS first_at,MAX(t.block_timestamp) AS latest_at,
    COUNT(*) AS trade_count,
    COUNT(*) FILTER (WHERE t.is_buy) AS buy_count,
    COUNT(*) FILTER (WHERE NOT t.is_buy) AS sell_count,
    COUNT(DISTINCT t.trader_address) AS distinct_wallet_count,
    COALESCE(SUM(t.net_trader_quote) FILTER (WHERE t.is_buy),0) AS buy_quote_wei,
    COALESCE(SUM(t.net_trader_quote) FILTER (WHERE NOT t.is_buy),0) AS sell_quote_wei,
    (ARRAY_AGG(t.transaction_hash ORDER BY t.block_timestamp DESC,t.log_index DESC) FILTER (WHERE t.is_buy))[1] AS transaction_hash
  FROM trades t JOIN markets m ON m.chain_id=t.chain_id AND m.token_address=t.token_address AND m.orphaned=false
  WHERE t.chain_id=$1 AND t.orphaned=false
    AND t.block_timestamp>=$3::timestamptz-$2::interval
    AND t.block_timestamp<=$3::timestamptz
    AND NOT EXISTS (SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=t.chain_id
      AND pa.address=t.trader_address AND pa.is_user_attributable=false)
    AND NOT (t.trader_address=ANY($4::text[]))
  GROUP BY t.token_address,m.name,m.symbol
  HAVING COALESCE(SUM(t.net_trader_quote) FILTER (WHERE t.is_buy),0)
    > COALESCE(SUM(t.net_trader_quote) FILTER (WHERE NOT t.is_buy),0)
  ORDER BY COALESCE(SUM(t.net_trader_quote) FILTER (WHERE t.is_buy),0)
    - COALESCE(SUM(t.net_trader_quote) FILTER (WHERE NOT t.is_buy),0) DESC,latest_at DESC
  LIMIT 12`;

// Leaderboard fallback while no current-method snapshot is published: every trader's latest stored
// performance, ranked by return. Params: $1 chain, $2 limit.
export const provisionalLeaderboardSql = `SELECT ps.address,p.display_name,p.bio,ps.methodology_version,
    ps.return_bps,ps.realized_pnl_quote,ps.unrealized_pnl_quote,ps.invested_quote,ps.trade_count,ps.market_count
  FROM (SELECT DISTINCT ON (address) * FROM trader_performance_snapshots
    WHERE chain_id=$1 ORDER BY address,as_of_block DESC) ps
  LEFT JOIN profiles p ON p.chain_id=$1 AND p.address=ps.address
  WHERE ps.trade_count>0
    AND NOT EXISTS (SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=$1
      AND pa.address=ps.address AND pa.is_user_attributable=false)
  ORDER BY ps.return_bps DESC NULLS LAST,ps.invested_quote DESC LIMIT $2`;

// Following: markets the given wallets bought, with each buyer and their WETH spend. When $2 is
// null every user wallet counts (follows are not live yet). Params: $1 chain, $2 followed wallets,
// $3 blocked wallets.
export const followingBuysSql = `WITH buyers AS (
    SELECT t.token_address,t.trader_address,SUM(t.net_trader_quote) AS bought
    FROM trades t WHERE t.chain_id=$1 AND t.orphaned=false AND t.is_buy
      AND ($2::text[] IS NULL OR t.trader_address=ANY($2::text[]))
      AND NOT (t.trader_address=ANY($3::text[]))
      AND NOT EXISTS (SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=t.chain_id
        AND pa.address=t.trader_address AND pa.is_user_attributable=false)
    GROUP BY t.token_address,t.trader_address
  )
  SELECT b.token_address,m.name AS token_name,m.symbol AS token_symbol,SUM(b.bought)::text AS bought_quote_wei,
    JSON_AGG(JSON_BUILD_OBJECT('address',b.trader_address,'displayName',p.display_name) ORDER BY b.bought DESC) AS buyers
  FROM buyers b
  JOIN markets m ON m.chain_id=$1 AND m.token_address=b.token_address AND m.orphaned=false
  LEFT JOIN profiles p ON p.chain_id=$1 AND p.address=b.trader_address
  GROUP BY b.token_address,m.name,m.symbol
  ORDER BY COUNT(*) DESC,SUM(b.bought) DESC LIMIT 12`;
