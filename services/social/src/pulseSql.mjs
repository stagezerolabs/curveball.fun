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

export const publicPulseSql = pulseActorWindowsSql(false) + marketMomentsSql;
export const followingPulseSql = pulseActorWindowsSql(true) + marketMomentsSql;
