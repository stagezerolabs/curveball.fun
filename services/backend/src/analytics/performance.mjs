import { config } from "../platform/config.mjs";
import { RANKED_CATEGORIES, evaluateLeaderboards } from "./leaderboardEngine.mjs";

// Leaderboards use the v3 engine with the configured rule profile (strict unless
// LEADERBOARD_RULES_PROFILE=preview). Per-wallet performance snapshots (a realized/basis cache
// for profiles) keep their own label so their rows are never mislabelled v3.
export const PERFORMANCE_METHODOLOGY = config.leaderboardRules.methodologyVersion;
export const PERFORMANCE_SNAPSHOT_METHODOLOGY = "curve-known-basis-v2";

export async function refreshPerformanceSnapshot(db, address, asOfBlock) {
  await db.query(
    `WITH position_values AS (
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
      calculated_at=now()`,
    [config.chainId, address, asOfBlock.toString(), PERFORMANCE_SNAPSHOT_METHODOLOGY],
  );
}


const WEI = 10n ** 18n;

// numeric(38,18) holds 20 integer digits, so wei scores are stored as exact WETH decimals.
export function weiToDecimal(wei) {
  const value = BigInt(wei);
  const abs = value < 0n ? -value : value;
  const fraction = (abs % WEI).toString().padStart(18, "0");
  return `${value < 0n ? "-" : ""}${abs / WEI}.${fraction}`;
}

const epoch = (value) => (value === null || value === undefined ? null : Number(value));

// One bulk, read-only load of everything the v3 engine needs at `asOfBlock`. Curve state and
// TWAP history come from trades at or before the block, so a rerun is reproducible.
export async function loadLeaderboardInputs(
  db,
  asOfBlock,
  asOfTime,
  { chainId = config.chainId, rules = config.leaderboardRules } = {},
) {
  const block = asOfBlock.toString();
  const marketScope = `SELECT token_address FROM markets WHERE chain_id=$1 AND orphaned=false`;
  const [marketRows, tradeRows, transferRows, protocolRows, followRows] = await Promise.all([
    db.query(
      `SELECT m.token_address,m.creator_address,m.launchpad_address,m.launch_block,
        EXTRACT(EPOCH FROM m.launched_at)::bigint AS launched_at_epoch,
        m.initial_virtual_quote,m.total_supply,m.fee_bps,m.creator_tax_bps,m.state,m.graduation_block
      FROM markets m WHERE m.chain_id=$1 AND m.orphaned=false AND m.launch_block<=$2`,
      [chainId, block],
    ),
    db.query(
      `SELECT t.token_address,t.trader_address,t.is_buy,t.token_amount,t.net_trader_quote,
        t.anti_snipe_tax_quote,t.virtual_quote_after,t.virtual_token_after,t.block_number,
        t.transaction_index,t.log_index,EXTRACT(EPOCH FROM t.block_timestamp)::bigint AS at_epoch
      FROM trades t WHERE t.chain_id=$1 AND t.block_number<=$2 AND t.orphaned=false
        AND t.token_address IN (${marketScope})
      ORDER BY t.block_number,t.transaction_index NULLS LAST,t.log_index`,
      [chainId, block],
    ),
    db.query(
      `SELECT a.token_address,a.from_address,a.to_address,a.amount,a.block_number,
        a.transaction_index,a.log_index,EXTRACT(EPOCH FROM a.block_timestamp)::bigint AS at_epoch
      FROM asset_transfers a WHERE a.chain_id=$1 AND a.block_number<=$2 AND a.orphaned=false
        AND a.token_address IN (${marketScope})
      ORDER BY a.block_number,a.transaction_index NULLS LAST,a.log_index`,
      [chainId, block],
    ),
    db.query("SELECT DISTINCT address FROM protocol_accounts WHERE chain_id=$1", [chainId]),
    db.query(
      "SELECT follower_address,followed_address FROM follows WHERE chain_id=$1 AND created_at<=$2",
      [chainId, asOfTime],
    ),
  ]);

  const asOfSeconds = Math.floor(asOfTime.getTime() / 1000);
  const windowStart = asOfSeconds - rules.twapWindowSec;
  const trades = tradeRows.rows.map((row) => ({
    token: row.token_address,
    trader: row.trader_address,
    isBuy: row.is_buy,
    tokenAmount: BigInt(row.token_amount),
    netQuote: BigInt(row.net_trader_quote),
    antiSnipeTax: BigInt(row.anti_snipe_tax_quote ?? 0),
    vQ: row.virtual_quote_after,
    vT: row.virtual_token_after,
    blockNumber: BigInt(row.block_number),
    txIndex: row.transaction_index,
    logIndex: row.log_index,
    at: epoch(row.at_epoch),
  }));
  const transfers = transferRows.rows.map((row) => ({
    token: row.token_address,
    from: row.from_address,
    to: row.to_address,
    amount: BigInt(row.amount),
    blockNumber: BigInt(row.block_number),
    txIndex: row.transaction_index,
    logIndex: row.log_index,
    at: epoch(row.at_epoch),
  }));

  const historyByToken = new Map();
  const markets = marketRows.rows.map((row) => {
    const graduated =
      row.graduation_block !== null && row.graduation_block !== undefined &&
      BigInt(row.graduation_block) <= BigInt(block);
    const launchState = {
      at: epoch(row.launched_at_epoch),
      vQ: row.initial_virtual_quote,
      vT: row.total_supply,
    };
    historyByToken.set(row.token_address, [launchState]);
    return {
      token: row.token_address,
      creator: row.creator_address,
      launchpad: row.launchpad_address,
      launchBlock: row.launch_block,
      initialVirtualQuote: row.initial_virtual_quote,
      feeBps: row.fee_bps ?? 0,
      creatorTaxBps: row.creator_tax_bps ?? 0,
      // A market that graduated after asOfBlock was still on its curve at the block.
      state: graduated ? "graduated" : row.state === "graduated" ? "ready" : row.state,
      vQ: row.initial_virtual_quote,
      vT: row.total_supply,
      latestTradeAt: null,
    };
  });
  const marketByToken = new Map(markets.map((market) => [market.token, market]));
  for (const trade of trades) {
    const market = marketByToken.get(trade.token);
    if (!market || trade.vQ === null || trade.vT === null) continue;
    market.vQ = trade.vQ;
    market.vT = trade.vT;
    market.latestTradeAt = trade.at;
    historyByToken.get(trade.token).push({ at: trade.at, vQ: trade.vQ, vT: trade.vT });
  }
  const statesByToken = new Map();
  for (const [token, history] of historyByToken) {
    let first = 0;
    for (let i = 0; i < history.length; i++) if (history[i].at <= windowStart) first = i;
    statesByToken.set(token, history.slice(first));
  }

  return {
    asOfBlock: BigInt(block),
    asOfTime: asOfSeconds,
    markets,
    statesByToken,
    trades,
    transfers,
    protocolAccounts: protocolRows.rows.map((row) => row.address),
    follows: followRows.rows.map((row) => ({
      follower: row.follower_address,
      followed: row.followed_address,
    })),
  };
}

async function inTransaction(db, run) {
  // A pg Pool hands out connections per query, so a transaction needs one checked-out client.
  if (typeof db.connect === "function" && "totalCount" in db) {
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      const result = await run(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
  await db.query("BEGIN");
  try {
    const result = await run(db);
    await db.query("COMMIT");
    return result;
  } catch (error) {
    await db.query("ROLLBACK");
    throw error;
  }
}

const jsonWithBigInt = (value) =>
  JSON.stringify(value, (_key, item) => (typeof item === "bigint" ? item.toString() : item));

export async function publishLeaderboards(
  db,
  asOfBlock,
  asOfTime = new Date(),
  { chainId = config.chainId, rules = config.leaderboardRules } = {},
) {
  const started = Date.now();
  const inputs = await loadLeaderboardInputs(db, asOfBlock, asOfTime, { chainId, rules });
  const { categories, evaluations } = evaluateLeaderboards({ ...inputs, rules });
  const summary = {
    asOfBlock: asOfBlock.toString(),
    methodologyVersion: rules.methodologyVersion,
    walletCount: evaluations.length,
    categories: {},
  };

  for (const category of RANKED_CATEGORIES) {
    const board = categories[category];
    const details = {
      rules: board.rules,
      watching: board.watching,
      progress: board.progress,
    };
    const rows = board.items.map((item) => ({
      address: item.address,
      rank: item.rank,
      score: category === "followers" ? `${item.score}` : weiToDecimal(item.score),
      metrics: { ...item.metrics, scoreWei: category === "followers" ? undefined : item.score.toString() },
    }));
    await inTransaction(db, async (client) => {
      const snapshot = await client.query(
        `INSERT INTO leaderboard_snapshots
        (chain_id,category,period,methodology_version,as_of_block,published_at,status,as_of_time,details)
        VALUES ($1,$2,'all',$3,$4,now(),$5,$6,$7::jsonb)
        ON CONFLICT (chain_id,category,period,as_of_block,methodology_version) DO UPDATE SET
          calculated_at=now(),published_at=now(),status=EXCLUDED.status,
          as_of_time=EXCLUDED.as_of_time,details=EXCLUDED.details
        RETURNING id`,
        [
          chainId,
          category,
          rules.methodologyVersion,
          asOfBlock.toString(),
          board.status,
          asOfTime,
          jsonWithBigInt(details),
        ],
      );
      const snapshotId = snapshot.rows[0].id;
      await client.query("DELETE FROM leaderboard_rows WHERE snapshot_id=$1", [snapshotId]);
      if (rows.length) {
        await client.query(
          `INSERT INTO leaderboard_rows (snapshot_id,address,rank,score,metrics)
          SELECT $1,r.address,r.rank,r.score::numeric,r.metrics
          FROM jsonb_to_recordset($2::jsonb) AS r(address text,rank integer,score text,metrics jsonb)`,
          [snapshotId, jsonWithBigInt(rows)],
        );
      }
    });
    summary.categories[category] = { status: board.status, rows: rows.length };
  }

  // Keep the latest snapshot per category; never touch other methodology versions.
  await db.query(
    `DELETE FROM leaderboard_snapshots s
    WHERE s.chain_id=$1 AND s.methodology_version=$2
      AND s.published_at<now()-interval '7 days'
      AND s.published_at<(SELECT max(latest.published_at) FROM leaderboard_snapshots latest
        WHERE latest.chain_id=s.chain_id AND latest.category=s.category
          AND latest.methodology_version=$2)`,
    [chainId, rules.methodologyVersion],
  );

  summary.durationMs = Date.now() - started;
  return summary;
}
