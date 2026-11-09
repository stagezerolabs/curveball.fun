import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";
import { addressParam, boundedLimit, decodeCursor, encodeCursor } from "../../transport/params.mjs";
import { pulseGraph } from "../pulse/pulse.mjs";

function shapeMarket(row) {
  return {
    chainId: Number(row.chain_id),
    factoryAddress: config.launchpadAddress.toLowerCase(),
    tokenAddress: row.token_address,
    launchpadAddress: row.launchpad_address,
    creatorAddress: row.creator_address,
    name: row.name,
    symbol: row.symbol,
    metadataUri: row.metadata_uri,
    imageUrl: row.token_metadata?.imageUrl || null,
    state: row.state,
    readyAt: row.ready_at,
    isGraduated: Boolean(row.graduated),
    poolAddress: row.pool_address,
    launchedAt: row.launched_at,
    launchBlock: String(row.launch_block),
    policy: {
      totalSupply: row.total_supply,
      curveSupply: row.curve_supply,
      initialVirtualQuote: row.initial_virtual_quote,
      graduationTargetQuote: row.graduation_target_quote,
      feeBps: row.fee_bps === null ? null : Number(row.fee_bps),
      creatorFeeShareBps:
        row.creator_fee_share_bps === null
          ? null
          : Number(row.creator_fee_share_bps),
      buybackFeeShareBps:
        row.buyback_fee_share_bps === null
          ? null
          : Number(row.buyback_fee_share_bps),
      creatorTaxBps:
        row.creator_tax_bps === null ? null : Number(row.creator_tax_bps),
    },
    metrics: {
      tradeCount: Number(row.trade_count || 0),
      uniqueTraderCount: Number(row.unique_trader_count || 0),
      grossQuoteVolume: String(row.gross_quote_volume || 0),
      walletCashTurnover: String(row.wallet_cash_turnover || 0),
      virtualQuote:
        row.virtual_quote === null ? null : String(row.virtual_quote),
      virtualToken:
        row.virtual_token === null ? null : String(row.virtual_token),
      sold: row.sold === null ? "0" : String(row.sold),
      currentPriceX18:
        row.current_price_x18 === null ? null : String(row.current_price_x18),
      athPriceX18:
        row.ath_price_x18 === null ? null : String(row.ath_price_x18),
      recentGrossQuoteVolume: String(row.recent_gross_quote_volume || 0),
      change1hBps:
        row.change_1h_bps === null ? null : Number(row.change_1h_bps),
      change6hBps:
        row.change_6h_bps === null ? null : Number(row.change_6h_bps),
      change24hBps:
        row.change_24h_bps === null ? null : Number(row.change_24h_bps),
      latestTradeAt: row.latest_trade_at,
    },
  };
}

const recentVolumeExpression = "COALESCE(ms.gross_quote_volume_24h,0)";

const marketSelect = `SELECT m.*,ms.trade_count,ms.unique_trader_count,ms.gross_quote_volume,
  ms.wallet_cash_turnover,ms.virtual_quote,ms.virtual_token,ms.sold,ms.latest_trade_at,
  ms.current_price_x18,ms.ath_price_x18,ms.change_1h_bps,ms.change_6h_bps,ms.change_24h_bps,
  a.metadata AS token_metadata,
  ${recentVolumeExpression} AS recent_gross_quote_volume`;

export async function markets(url) {
  const limit = boundedLimit(url, 24, 50);
  const tab = url.searchParams.get("tab") || "trending";
  if (!new Set(["trending", "new", "graduated", "all"]).has(tab)) {
    throw Object.assign(new Error("Unknown market tab."), { status: 400 });
  }
  const search = (url.searchParams.get("search") || "").trim().slice(0, 80);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  if (cursor && cursor.tab !== tab)
    throw Object.assign(
      new Error("The market cursor belongs to another tab."),
      { status: 400 },
    );
  const cursorValue = typeof cursor?.value === "string" ? cursor.value : null;
  const cursorToken =
    typeof cursor?.token === "string" ? addressParam(cursor.token) : null;
  const statusClause =
    tab === "graduated"
      ? "AND m.graduated=true"
      : tab === "all"
        ? ""
        : "AND m.graduated=false";
  const orderExpression =
    tab === "trending" ? "recent_gross_quote_volume" : "m.launched_at";
  const cursorClause =
    tab === "trending"
      ? `AND ($4::numeric IS NULL OR (${recentVolumeExpression},m.token_address)<($4::numeric,$5::text))`
      : "AND ($4::timestamptz IS NULL OR (m.launched_at,m.token_address)<($4::timestamptz,$5::text))";
  const result = await pool.query(
    `${marketSelect}
    FROM markets m LEFT JOIN market_stats ms ON ms.chain_id=m.chain_id AND ms.token_address=m.token_address
    LEFT JOIN assets a ON a.chain_id=m.chain_id AND a.address=m.token_address
    WHERE m.chain_id=$1 AND m.orphaned=false ${statusClause}
      AND ($3::text='' OR m.name ILIKE '%'||$3||'%' OR m.symbol ILIKE '%'||$3||'%')
      ${cursorClause}
    ORDER BY ${orderExpression} DESC,m.token_address DESC LIMIT $2`,
    [config.chainId, limit + 1, search, cursorValue, cursorToken],
  );
  const hasMore = result.rows.length > limit;
  const rows = hasMore ? result.rows.slice(0, limit) : result.rows;
  const last = rows.at(-1);
  return {
    items: rows.map(shapeMarket),
    nextCursor:
      hasMore && last
        ? encodeCursor({
            tab,
            value:
              tab === "trending"
                ? String(last.recent_gross_quote_volume || 0)
                : new Date(last.launched_at).toISOString(),
            token: last.token_address,
          })
        : null,
  };
}

export async function market(address) {
  const result = await pool.query(
    `${marketSelect}
    FROM markets m LEFT JOIN market_stats ms ON ms.chain_id=m.chain_id AND ms.token_address=m.token_address
    LEFT JOIN assets a ON a.chain_id=m.chain_id AND a.address=m.token_address
    WHERE m.chain_id=$1 AND m.token_address=$2 AND m.orphaned=false`,
    [config.chainId, address],
  );
  if (!result.rows[0])
    throw Object.assign(new Error("Market not found."), { status: 404 });
  return shapeMarket(result.rows[0]);
}

export async function marketTape(address) {
  const result = await pool.query(
    `SELECT
      (SELECT COALESCE(SUM(t.gross_curve_quote),0) FROM trades t
       WHERE t.chain_id=m.chain_id AND t.token_address=m.token_address
         AND t.orphaned=false AND t.block_timestamp>now()-interval '24 hours')
      + (SELECT COALESCE(SUM(s.quote_amount),0) FROM venue_swaps s
         WHERE s.chain_id=m.chain_id AND s.token_address=m.token_address
           AND s.orphaned=false AND s.block_timestamp>now()-interval '24 hours') AS volume_24h_wei,
      (SELECT COALESCE(SUM(t.token_amount),0) FROM trades t
       WHERE t.chain_id=m.chain_id AND t.token_address=m.token_address
         AND t.is_buy=true AND t.orphaned=false
         AND t.block_timestamp>now()-interval '24 hours')
      + (SELECT COALESCE(SUM(s.token_amount),0) FROM venue_swaps s
         WHERE s.chain_id=m.chain_id AND s.token_address=m.token_address
           AND s.is_buy=true AND s.orphaned=false
           AND s.block_timestamp>now()-interval '24 hours') AS bought_24h_wei,
      (SELECT COALESCE(SUM(a.amount),0) FROM asset_transfers a
       WHERE a.chain_id=m.chain_id AND a.token_address=m.token_address
         AND a.to_address='0x0000000000000000000000000000000000000000'
         AND a.orphaned=false) AS burned_total_wei
    FROM markets m
    WHERE m.chain_id=$1 AND m.token_address=$2 AND m.orphaned=false`,
    [config.chainId, address],
  );
  const row = result.rows[0];
  if (!row)
    throw Object.assign(new Error("Market not found."), { status: 404 });
  return {
    tokenAddress: address,
    volume24hWei: String(row.volume_24h_wei),
    bought24hWei: String(row.bought_24h_wei),
    burnedTotalWei: String(row.burned_total_wei),
    asOf: new Date().toISOString(),
  };
}

export async function marketTrades(url, tokenAddress, viewer) {
  const limit = boundedLimit(url, 50, 100);
  const cursor = decodeCursor(url.searchParams.get("cursor"));
  const beforeAt = typeof cursor?.at === "string" ? cursor.at : null;
  const beforeId = typeof cursor?.id === "string" ? cursor.id : null;
  const graph = await pulseGraph(viewer);
  const followed = [...graph.followed];
  const blocked = [...graph.blocked];
  const [result, followedHere] = await Promise.all([
    pool.query(
      `WITH activity AS (
      SELECT logical_id,trader_address AS participant_address,'trader'::text AS participant_role,
        NULL::text AS execution_sender_address,'curve'::text AS venue_type,launchpad_address AS venue_address,
        is_buy,gross_curve_quote,net_trader_quote,fee_quote,creator_tax_quote,anti_snipe_tax_quote,token_amount,
        virtual_quote_after,virtual_token_after,sold_after,transaction_hash,block_number,log_index,block_timestamp
      FROM trades WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
      UNION ALL
      SELECT logical_id,recipient_address,'recipient',sender_address,'pool',pool_address,is_buy,
        quote_amount,quote_amount,0,0,0,token_amount,NULL,NULL,NULL,transaction_hash,block_number,log_index,block_timestamp
      FROM venue_swaps WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
    ) SELECT a.*,n.note,
      (SELECT COUNT(*) FROM trade_reactions rx WHERE rx.logical_trade_id=a.logical_id) AS reaction_count,
      EXISTS(SELECT 1 FROM trade_reactions rx WHERE rx.logical_trade_id=a.logical_id AND rx.reactor_address=$6) AS reacted,
      (a.participant_address=ANY($7::text[])) AS is_followed,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.chain_id=$1 AND f2.followed_address=a.participant_address) AS follower_count
    FROM activity a
    LEFT JOIN trade_notes n ON n.logical_trade_id=a.logical_id AND NOT EXISTS (
      SELECT 1 FROM reports r
      WHERE r.chain_id=$1 AND r.subject_trade_id=a.logical_id AND r.status='actioned'
    )
    WHERE true
      AND ($4::timestamptz IS NULL OR block_timestamp<$4::timestamptz
        OR (block_timestamp=$4::timestamptz AND $5::text IS NOT NULL AND logical_id<$5))
      AND NOT (a.participant_address=ANY($8::text[]))
    ORDER BY block_timestamp DESC,logical_id DESC LIMIT $3`,
      [
        config.chainId,
        tokenAddress,
        limit,
        beforeAt,
        beforeId,
        viewer || "",
        followed,
        blocked,
      ],
    ),
    followed.length
      ? pool.query(
          `SELECT COUNT(*) AS traders FROM (
          SELECT trader_address AS participant FROM trades WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
          UNION SELECT recipient_address FROM venue_swaps WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
        ) actors WHERE actors.participant=ANY($3::text[])`,
          [config.chainId, tokenAddress, followed],
        )
      : Promise.resolve({ rows: [{ traders: 0 }] }),
  ]);
  const items = result.rows.map((row) => ({
    id: row.logical_id,
    participantAddress: row.participant_address,
    participantRole: row.participant_role,
    executionSenderAddress: row.execution_sender_address,
    venueType: row.venue_type,
    venueAddress: row.venue_address,
    side: row.is_buy ? "buy" : "sell",
    grossCurveQuote: String(row.gross_curve_quote),
    walletQuoteAmount: String(row.net_trader_quote),
    feeQuote: String(row.fee_quote),
    creatorTaxQuote: String(row.creator_tax_quote),
    antiSnipeTaxQuote: String(row.anti_snipe_tax_quote),
    tokenAmount: String(row.token_amount),
    virtualQuoteAfter:
      row.virtual_quote_after === null ? null : String(row.virtual_quote_after),
    virtualTokenAfter:
      row.virtual_token_after === null ? null : String(row.virtual_token_after),
    soldAfter: row.sold_after === null ? null : String(row.sold_after),
    transactionHash: row.transaction_hash,
    blockNumber: String(row.block_number),
    logIndex: Number(row.log_index),
    blockTimestamp: row.block_timestamp,
    note: row.note || null,
    reactionCount: Number(row.reaction_count || 0),
    reacted: Boolean(row.reacted),
    isFollowed: Boolean(row.is_followed),
    followerCount: Number(row.follower_count || 0),
  }));
  const last = result.rows.at(-1);
  return {
    followingTraderCount: Number(followedHere.rows[0]?.traders || 0),
    items,
    nextCursor: last
      ? encodeCursor({ at: last.block_timestamp, id: last.logical_id })
      : null,
  };
}

export async function marketCandles(url, tokenAddress) {
  const interval = Number(url.searchParams.get("interval") || 300);
  if (![60, 300, 900, 3_600, 14_400, 86_400].includes(interval)) {
    throw Object.assign(new Error("Unsupported candle interval."), {
      status: 400,
    });
  }
  const from = url.searchParams.get("from");
  const limit = boundedLimit(url, 500, 2_000);
  const result = await pool.query(
    `SELECT bucket_start,open_price_x18,high_price_x18,low_price_x18,close_price_x18,
      gross_quote_volume,wallet_cash_turnover,token_volume,trade_count,buy_count,sell_count
    FROM market_candles WHERE chain_id=$1 AND token_address=$2 AND interval_seconds=$3
      AND ($4::timestamptz IS NULL OR bucket_start>=$4::timestamptz)
    ORDER BY bucket_start DESC LIMIT $5`,
    [config.chainId, tokenAddress, interval, from, limit],
  );
  return {
    intervalSeconds: interval,
    items: result.rows.reverse().map((row) => ({
      bucketStart: row.bucket_start,
      openPriceX18: String(row.open_price_x18),
      highPriceX18: String(row.high_price_x18),
      lowPriceX18: String(row.low_price_x18),
      closePriceX18: String(row.close_price_x18),
      grossQuoteVolume: String(row.gross_quote_volume),
      walletCashTurnover: String(row.wallet_cash_turnover),
      tokenVolume: String(row.token_volume),
      tradeCount: Number(row.trade_count),
      buyCount: Number(row.buy_count),
      sellCount: Number(row.sell_count),
    })),
  };
}

export async function marketHolders(url, tokenAddress, viewer) {
  const atBlockValue = url.searchParams.get("atBlock");
  const atBlock =
    atBlockValue && /^\d+$/.test(atBlockValue) ? atBlockValue : null;
  const limit = boundedLimit(url, 100, 500);
  const graph = await pulseGraph(viewer);
  const followed = [...graph.followed];
  const result = await pool.query(
    `WITH balances AS (
      SELECT wallet,SUM(delta) AS balance FROM (
        SELECT to_address AS wallet,amount AS delta FROM asset_transfers
          WHERE chain_id=$1 AND token_address=$2 AND orphaned=false AND ($3::numeric IS NULL OR block_number<=$3)
        UNION ALL
        SELECT from_address AS wallet,-amount AS delta FROM asset_transfers
          WHERE chain_id=$1 AND token_address=$2 AND orphaned=false AND ($3::numeric IS NULL OR block_number<=$3)
      ) movements WHERE wallet<>'0x0000000000000000000000000000000000000000' GROUP BY wallet
    ), eligible AS (
      SELECT wallet,balance FROM balances b WHERE balance>0 AND NOT EXISTS (
        SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=$1 AND pa.address=b.wallet AND pa.is_user_attributable=false
      )
    ) SELECT wallet AS address,balance,(wallet=ANY($5::text[])) AS is_followed,
      SUM(balance) OVER () AS eligible_supply,
      COUNT(*) FILTER (WHERE wallet=ANY($5::text[])) OVER () AS followed_count
    FROM eligible ORDER BY balance DESC,wallet ASC LIMIT $4`,
    [config.chainId, tokenAddress, atBlock, limit, followed],
  );
  return {
    atBlock,
    eligibleSupply: String(result.rows[0]?.eligible_supply || 0),
    followedHolderCount: Number(result.rows[0]?.followed_count || 0),
    items: result.rows.map((row) => ({
      address: row.address,
      balance: String(row.balance),
      isFollowed: Boolean(row.is_followed),
    })),
  };
}
