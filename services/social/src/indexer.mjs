import { createPublicClient, http, parseAbi, parseAbiItem, toEventSelector } from "viem";
import { config } from "./config.mjs";
import { pool, transaction } from "./db.mjs";
import { crossedCurveMilestones } from "./milestones.mjs";
import { publishLeaderboards, refreshPerformanceSnapshot } from "./performance.mjs";
import { traceBackendTask } from "./instrument.mjs";

// The lean launchpad (docs/adr/0003-lean-singleton-launchpad.md): one contract runs every market's
// curve, and the fee escrow, LP locker and holder reserve are singletons discovered from it.
const launchEvent = parseAbiItem("event LaunchCreated(address indexed token,address indexed creator,string name,string symbol,string uri,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 taxBps,uint256 reserveTokens)");
const graduationReadyEvent = parseAbiItem("event GraduationReady(address indexed token)");
const graduationAbortedEvent = parseAbiItem("event GraduationAborted(address indexed token)");
const graduatedEvent = parseAbiItem("event Graduated(address indexed token,address indexed pool,uint256 quoteAmount,uint256 tokenAmount,uint256 burned)");
const tradeEvent = parseAbiItem("event Trade(address indexed token,address indexed trader,bool isBuy,uint256 quoteAmount,uint256 tokenAmount,uint256 fee,uint256 tax,uint256 virtualToken,uint256 virtualQuote)");
const transferEvent = parseAbiItem("event Transfer(address indexed from,address indexed to,uint256 value)");
const feeAccruedEvent = parseAbiItem("event FeeAccrued(address indexed token,address indexed asset,uint256 creatorAmount,uint256 buybackAmount,uint256 protocolAmount)");
const feeClaimedEvent = parseAbiItem("event FeeClaimed(address indexed account,address indexed asset,uint256 amount)");
const buybackBurnedEvent = parseAbiItem("event BuybackBurned(address indexed token,uint256 quoteSpent,uint256 tokensBurned)");
const lpFeesClaimedEvent = parseAbiItem("event LpFeesClaimed(address indexed token,address indexed pool,uint256 tokenAmount,uint256 quoteAmount)");
const reserveRegisteredEvent = parseAbiItem("event ReserveRegistered(address indexed token,uint256 amount)");
const reserveClaimedEvent = parseAbiItem("event ReserveClaimed(address indexed token,address indexed account,uint256 amount)");
const poolSwapEvent = parseAbiItem("event Swap(address indexed sender,address indexed to,uint256 amount0In,uint256 amount1In,uint256 amount0Out,uint256 amount1Out)");
const ledgerTopics = [transferEvent, feeAccruedEvent, feeClaimedEvent, buybackBurnedEvent, lpFeesClaimedEvent,
  reserveRegisteredEvent, reserveClaimedEvent].map((event) => toEventSelector(event).toLowerCase());
const launchpadAbi = parseAbi([
  "function quoteToken() view returns (address)",
  "function treasury() view returns (address)",
  "function escrow() view returns (address)",
  "function locker() view returns (address)",
  "function reserve() view returns (address)",
  "function SUPPLY() view returns (uint256)",
  "function CURVE_SUPPLY() view returns (uint256)",
  "function market(address token) view returns ((address creator,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 taxBps,uint8 state,uint128 virtualToken,uint128 virtualQuote,uint128 initialVirtualQuote,uint128 realQuote,uint128 reserveTokens,uint40 readyAt,address pool))",
]);
// Trades and lifecycle events both come from the launchpad, so each stream orphans only its own topics.
const lifecycleTopics = [launchEvent, graduationReadyEvent, graduationAbortedEvent, graduatedEvent]
  .map((event) => toEventSelector(event).toLowerCase());
const tradeTopic = toEventSelector(tradeEvent).toLowerCase();
/** CurveLaunchpad.State in enum order, as stored in markets.state. */
const MARKET_STATES = ["trading", "trading", "ready", "graduated", "aborted"];
/** The launchpad's SUPPLY and CURVE_SUPPLY, read once at startup. */
let supplies;
const poolPairAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
]);
const REORG_OVERLAP = 16n;

const client = createPublicClient({ transport: http(config.rpcUrl, { retryCount: 5, retryDelay: 500 }) });
const poolPairCache = new Map();

function lower(value) {
  return value.toLowerCase();
}

function logicalId(log) {
  return `${config.chainId}:${lower(log.transactionHash)}:${log.logIndex}:${lower(log.address)}:${lower(log.topics[0])}`;
}

async function cursor(stream) {
  const result = await pool.query(
    "SELECT next_block FROM chain_cursors WHERE chain_id = $1 AND stream = $2",
    [config.chainId, stream],
  );
  return result.rows[0] ? BigInt(result.rows[0].next_block) : config.deploymentBlock;
}

async function blockFor(blockNumber, cache) {
  const key = blockNumber.toString();
  if (!cache.has(key)) {
    const block = await client.getBlock({ blockNumber });
    cache.set(key, block);
  }
  return cache.get(key);
}

async function recordBlock(db, block) {
  await db.query(
    "UPDATE chain_blocks SET canonical=false WHERE chain_id=$1 AND block_number=$2 AND block_hash<>$3",
    [config.chainId, block.number.toString(), lower(block.hash)],
  );
  await db.query(`INSERT INTO chain_blocks
    (chain_id,block_number,block_hash,parent_hash,block_timestamp,canonical,finalized)
    VALUES ($1,$2,$3,$4,$5,true,true)
    ON CONFLICT (chain_id,block_hash) DO UPDATE SET canonical=true,finalized=true,observed_at=now()`,
  [config.chainId, block.number.toString(), lower(block.hash), lower(block.parentHash), new Date(Number(block.timestamp) * 1_000)]);
}

async function recordOccurrence(db, log) {
  await db.query(
    `INSERT INTO chain_logs
      (chain_id, block_hash, block_number, transaction_hash, transaction_index, log_index, address, topic0, topics, data, orphaned, finalized)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,false,true)
     ON CONFLICT (chain_id, block_hash, log_index)
     DO UPDATE SET orphaned=false,finalized=true,observed_at=now(),topics=EXCLUDED.topics,data=EXCLUDED.data`,
    [config.chainId, lower(log.blockHash), log.blockNumber.toString(), lower(log.transactionHash), log.transactionIndex ?? null,
      log.logIndex, lower(log.address), lower(log.topics[0]), JSON.stringify(log.topics.map(lower)), log.data],
  );
}

function minimum(left, right) {
  return left < right ? left : right;
}

async function rebuildCurvePosition(db, traderAddress, tokenAddress) {
  const result = await db.query(`SELECT logical_id,is_buy,token_amount,net_trader_quote,block_timestamp
    FROM trades WHERE chain_id=$1 AND trader_address=$2 AND token_address=$3 AND orphaned=false
    ORDER BY block_number,transaction_index NULLS LAST,log_index`,
  [config.chainId, traderAddress, tokenAddress]);
  if (!result.rowCount) {
    await db.query("DELETE FROM curve_positions WHERE chain_id=$1 AND trader_address=$2 AND token_address=$3", [config.chainId, traderAddress, tokenAddress]);
    return;
  }

  let knownBalance = 0n;
  let bought = 0n;
  let sold = 0n;
  let unknownSold = 0n;
  let invested = 0n;
  let proceeds = 0n;
  let remainingCost = 0n;
  let realizedCost = 0n;
  let knownProceedsTotal = 0n;
  let realizedPnl = 0n;
  for (const trade of result.rows) {
    const tokens = BigInt(trade.token_amount);
    const quote = BigInt(trade.net_trader_quote);
    if (trade.is_buy) {
      knownBalance += tokens;
      bought += tokens;
      invested += quote;
      remainingCost += quote;
      continue;
    }
    sold += tokens;
    proceeds += quote;
    const knownSold = minimum(tokens, knownBalance);
    const unknown = tokens - knownSold;
    unknownSold += unknown;
    if (knownSold > 0n && knownBalance > 0n) {
      const removedCost = remainingCost * knownSold / knownBalance;
      const knownProceeds = quote * knownSold / tokens;
      remainingCost -= removedCost;
      realizedCost += removedCost;
      knownProceedsTotal += knownProceeds;
      realizedPnl += knownProceeds - removedCost;
      knownBalance -= knownSold;
    }
  }
  const first = result.rows[0];
  const latest = result.rows.at(-1);
  await db.query(`INSERT INTO curve_positions
    (chain_id,trader_address,token_address,known_basis_token_balance,total_tokens_bought,total_tokens_sold,
     unknown_basis_tokens_sold,total_invested_quote,total_proceeds_quote,remaining_cost_basis_quote,
     realized_cost_basis_quote,known_basis_proceeds_quote,realized_pnl_quote,trade_count,first_trade_at,last_trade_at,
     latest_trade_id,methodology_version,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'curve-weighted-average-v1',now())
    ON CONFLICT (chain_id,trader_address,token_address) DO UPDATE SET
      known_basis_token_balance=EXCLUDED.known_basis_token_balance,total_tokens_bought=EXCLUDED.total_tokens_bought,
      total_tokens_sold=EXCLUDED.total_tokens_sold,unknown_basis_tokens_sold=EXCLUDED.unknown_basis_tokens_sold,
      total_invested_quote=EXCLUDED.total_invested_quote,total_proceeds_quote=EXCLUDED.total_proceeds_quote,
      remaining_cost_basis_quote=EXCLUDED.remaining_cost_basis_quote,realized_cost_basis_quote=EXCLUDED.realized_cost_basis_quote,
      known_basis_proceeds_quote=EXCLUDED.known_basis_proceeds_quote,realized_pnl_quote=EXCLUDED.realized_pnl_quote,
      trade_count=EXCLUDED.trade_count,first_trade_at=EXCLUDED.first_trade_at,last_trade_at=EXCLUDED.last_trade_at,
      latest_trade_id=EXCLUDED.latest_trade_id,methodology_version=EXCLUDED.methodology_version,updated_at=now()`,
  [config.chainId, traderAddress, tokenAddress, knownBalance.toString(), bought.toString(), sold.toString(),
    unknownSold.toString(), invested.toString(), proceeds.toString(), remainingCost.toString(), realizedCost.toString(),
    knownProceedsTotal.toString(), realizedPnl.toString(), result.rowCount, first.block_timestamp, latest.block_timestamp, latest.logical_id]);
}

async function rebuildMarketStats(db, tokenAddress) {
  const result = await db.query(`WITH curve_priced AS (
      SELECT logical_id,is_buy,gross_curve_quote AS quote_volume,net_trader_quote AS wallet_turnover,
        token_amount,trader_address,block_number,transaction_index,log_index,block_timestamp,
        virtual_quote_after,virtual_token_after,sold_after,
        TRUNC(virtual_quote_after*1000000000000000000/NULLIF(virtual_token_after,0)) AS price_x18
      FROM trades WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
    ), priced AS (
      SELECT logical_id,is_buy,quote_volume,wallet_turnover,token_amount,trader_address,block_number,
        transaction_index,log_index,block_timestamp,price_x18 FROM curve_priced
      UNION ALL
      SELECT logical_id,is_buy,quote_amount,quote_amount,token_amount,NULL::text,block_number,
        transaction_index,log_index,block_timestamp,price_x18
      FROM venue_swaps WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
    ), curve_state AS (
      SELECT
        (ARRAY_AGG(virtual_quote_after ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC))[1] AS virtual_quote,
        (ARRAY_AGG(virtual_token_after ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC))[1] AS virtual_token,
        (ARRAY_AGG(sold_after ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC))[1] AS sold
      FROM curve_priced
    ) SELECT
      COUNT(*) AS trade_count,COUNT(*) FILTER (WHERE is_buy) AS buy_count,COUNT(*) FILTER (WHERE NOT is_buy) AS sell_count,
      COUNT(DISTINCT trader_address) AS unique_trader_count,COALESCE(SUM(quote_volume),0) AS gross_quote_volume,
      COALESCE(SUM(wallet_turnover),0) AS wallet_cash_turnover,COALESCE(SUM(token_amount),0) AS token_volume,
      COALESCE(MAX(curve_state.virtual_quote),0) AS virtual_quote,
      COALESCE(MAX(curve_state.virtual_token),0) AS virtual_token,
      COALESCE(MAX(curve_state.sold),0) AS sold,
      (ARRAY_AGG(price_x18 ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC))[1] AS current_price_x18,
      MAX(price_x18) AS ath_price_x18,
      COALESCE(SUM(quote_volume) FILTER (WHERE block_timestamp>now()-interval '24 hours'),0) AS gross_quote_volume_24h,
      (ARRAY_AGG(price_x18 ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC)
        FILTER (WHERE block_timestamp<=now()-interval '1 hour'))[1] AS price_1h,
      (ARRAY_AGG(price_x18 ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC)
        FILTER (WHERE block_timestamp<=now()-interval '6 hours'))[1] AS price_6h,
      (ARRAY_AGG(price_x18 ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC)
        FILTER (WHERE block_timestamp<=now()-interval '24 hours'))[1] AS price_24h,
      (ARRAY_AGG(price_x18 ORDER BY block_number,transaction_index NULLS LAST,log_index))[1] AS first_price_x18,
      (ARRAY_AGG(logical_id ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC))[1] AS latest_trade_id,
      MAX(block_timestamp) AS latest_trade_at
    FROM priced CROSS JOIN curve_state`, [config.chainId, tokenAddress]);
  const row = result.rows[0];
  if (!row?.latest_trade_id) {
    await db.query("DELETE FROM market_stats WHERE chain_id=$1 AND token_address=$2", [config.chainId, tokenAddress]);
    return;
  }
  const currentPrice = BigInt(row.current_price_x18);
  const firstPrice = BigInt(row.first_price_x18);
  const changeBps = (prior) => {
    const baseline = BigInt(prior || firstPrice);
    return baseline > 0n ? (currentPrice * 10_000n / baseline - 10_000n).toString() : null;
  };
  await db.query(`INSERT INTO market_stats
    (chain_id,token_address,trade_count,buy_count,sell_count,unique_trader_count,gross_quote_volume,
     wallet_cash_turnover,token_volume,virtual_quote,virtual_token,sold,current_price_x18,ath_price_x18,
     gross_quote_volume_24h,change_1h_bps,change_6h_bps,change_24h_bps,latest_trade_id,latest_trade_at,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,now())
    ON CONFLICT (chain_id,token_address) DO UPDATE SET
      trade_count=EXCLUDED.trade_count,buy_count=EXCLUDED.buy_count,sell_count=EXCLUDED.sell_count,
      unique_trader_count=EXCLUDED.unique_trader_count,gross_quote_volume=EXCLUDED.gross_quote_volume,
      wallet_cash_turnover=EXCLUDED.wallet_cash_turnover,token_volume=EXCLUDED.token_volume,
      virtual_quote=EXCLUDED.virtual_quote,virtual_token=EXCLUDED.virtual_token,sold=EXCLUDED.sold,
      current_price_x18=EXCLUDED.current_price_x18,ath_price_x18=EXCLUDED.ath_price_x18,
      gross_quote_volume_24h=EXCLUDED.gross_quote_volume_24h,change_1h_bps=EXCLUDED.change_1h_bps,
      change_6h_bps=EXCLUDED.change_6h_bps,change_24h_bps=EXCLUDED.change_24h_bps,
      latest_trade_id=EXCLUDED.latest_trade_id,latest_trade_at=EXCLUDED.latest_trade_at,updated_at=now()`,
  [config.chainId, tokenAddress, row.trade_count, row.buy_count, row.sell_count, row.unique_trader_count,
    row.gross_quote_volume, row.wallet_cash_turnover, row.token_volume, row.virtual_quote, row.virtual_token,
    row.sold, row.current_price_x18, row.ath_price_x18, row.gross_quote_volume_24h,
    changeBps(row.price_1h), changeBps(row.price_6h), changeBps(row.price_24h), row.latest_trade_id, row.latest_trade_at]);
}

async function rebuildMarketCandles(db, tokenAddress) {
  for (const intervalSeconds of [60, 300, 900, 3_600, 14_400, 86_400]) {
    await db.query("DELETE FROM market_candles WHERE chain_id=$1 AND token_address=$2 AND interval_seconds=$3",
      [config.chainId, tokenAddress, intervalSeconds]);
    await db.query(`INSERT INTO market_candles
      (chain_id,token_address,interval_seconds,bucket_start,open_price_x18,high_price_x18,low_price_x18,
       close_price_x18,gross_quote_volume,wallet_cash_turnover,token_volume,trade_count,buy_count,sell_count,updated_at)
      SELECT $1,$2,$3,bucket_start,
        (ARRAY_AGG(price_x18 ORDER BY block_number,transaction_index NULLS LAST,log_index))[1],
        MAX(price_x18),MIN(price_x18),
        (ARRAY_AGG(price_x18 ORDER BY block_number DESC,transaction_index DESC NULLS LAST,log_index DESC))[1],
        SUM(quote_volume),SUM(wallet_turnover),SUM(token_amount),COUNT(*),
        COUNT(*) FILTER (WHERE is_buy),COUNT(*) FILTER (WHERE NOT is_buy),now()
      FROM (
        SELECT is_buy,gross_curve_quote AS quote_volume,net_trader_quote AS wallet_turnover,token_amount,
          block_number,transaction_index,log_index,block_timestamp,
          TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM block_timestamp)/$3)*$3) AS bucket_start,
          TRUNC(virtual_quote_after*1000000000000000000/NULLIF(virtual_token_after,0)) AS price_x18
        FROM trades WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
        UNION ALL
        SELECT is_buy,quote_amount,quote_amount,token_amount,block_number,transaction_index,log_index,block_timestamp,
          TO_TIMESTAMP(FLOOR(EXTRACT(EPOCH FROM block_timestamp)/$3)*$3),price_x18
        FROM venue_swaps WHERE chain_id=$1 AND token_address=$2 AND orphaned=false
      ) candle_trades GROUP BY bucket_start`,
    [config.chainId, tokenAddress, intervalSeconds]);
  }
}

// Everything below is derived from chain logs, so a new launchpad can retire the old deployment's rows by
// orphaning them (as a reorg would) and rebuild from its own deployment block. User content (profiles,
// follows, notes, reactions, copy intents) is untouched; it keeps referencing the orphaned trades.
const DERIVED_TABLES_TO_ORPHAN = ["markets", "trades", "venue_swaps", "asset_transfers", "protocol_flows", "buyback_executions", "reserve_claims", "chain_logs"];
const DERIVED_TABLES_TO_CLEAR = ["market_stats", "market_candles", "curve_positions", "trader_performance_snapshots", "leaderboard_snapshots", "chain_cursors"];

async function retirePreviousDeployment(db, launchpad) {
  const active = await db.query(`SELECT address FROM contract_deployments
    WHERE chain_id=$1 AND role IN ('factory','launchpad') AND active_until IS NULL`, [config.chainId]);
  if (!active.rowCount || active.rows.every((row) => row.address === launchpad)) return false;
  await db.query(`UPDATE contract_deployments SET active_until=now()
    WHERE chain_id=$1 AND role IN ('factory','launchpad') AND address<>$2 AND active_until IS NULL`, [config.chainId, launchpad]);
  for (const table of DERIVED_TABLES_TO_ORPHAN) {
    await db.query(`UPDATE ${table} SET orphaned=true WHERE chain_id=$1 AND orphaned=false`, [config.chainId]);
  }
  for (const table of DERIVED_TABLES_TO_CLEAR) {
    await db.query(`DELETE FROM ${table} WHERE chain_id=$1`, [config.chainId]);
  }
  await db.query(`DELETE FROM protocol_accounts WHERE chain_id=$1`, [config.chainId]);
  return true;
}

async function initializeIndexerState() {
  const connectedChainId = await client.getChainId();
  if (connectedChainId !== config.chainId) {
    throw new Error(`RPC chain ${connectedChainId} does not match configured chain ${config.chainId}.`);
  }
  const launchpad = lower(config.launchpadAddress);
  const read = (functionName) => client.readContract({ address: config.launchpadAddress, abi: launchpadAbi, functionName });
  const [quote, treasury, escrow, locker, reserve, supply, curveSupply] = await Promise.all([
    read("quoteToken"), read("treasury"), read("escrow"), read("locker"), read("reserve"), read("SUPPLY"), read("CURVE_SUPPLY"),
  ]);
  supplies = { supply, curveSupply };
  // Roles the ledger stream reads logs from; none of these addresses is a user for stats or holders.
  const accounts = [
    { role: "launchpad", address: launchpad },
    { role: "quote", address: lower(quote) },
    { role: "treasury", address: lower(treasury) },
    { role: "escrow", address: lower(escrow) },
    { role: "locker", address: lower(locker) },
    { role: "holderReserve", address: lower(reserve) },
    ...config.protocolAccounts,
  ];
  await transaction(async (db) => {
    await db.query(`INSERT INTO chains (id,name,native_symbol,finality_confirmations)
      VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO UPDATE SET
      name=EXCLUDED.name,native_symbol=EXCLUDED.native_symbol,finality_confirmations=EXCLUDED.finality_confirmations,enabled=true`,
    [config.chainId, config.chainName, config.nativeSymbol, Number(config.confirmations)]);
    if (await retirePreviousDeployment(db, launchpad)) {
      console.info(`Indexer switched to launchpad ${launchpad}; the previous deployment's rows are orphaned and re-indexing starts at block ${config.deploymentBlock}.`);
    }
    await db.query(`INSERT INTO contract_deployments (chain_id,role,address,version,deployment_block)
      VALUES ($1,'launchpad',$2,'lean-v2',$3) ON CONFLICT (chain_id,role,address) DO UPDATE SET
      deployment_block=EXCLUDED.deployment_block,active_until=NULL`,
    [config.chainId, launchpad, config.deploymentBlock.toString()]);
    for (const account of accounts) {
      await db.query(`INSERT INTO protocol_accounts (chain_id,address,role,label,is_user_attributable)
        VALUES ($1,$2,$3,$3,false) ON CONFLICT (chain_id,address,role) DO UPDATE SET is_user_attributable=false`,
      [config.chainId, account.address, account.role]);
    }
  });
}

async function indexFactoryRange(fromBlock, toBlock) {
  const launchpad = config.launchpadAddress;
  const [launches, readies, aborts, graduations] = await Promise.all([
    client.getLogs({ address: launchpad, event: launchEvent, fromBlock, toBlock, strict: true }),
    client.getLogs({ address: launchpad, event: graduationReadyEvent, fromBlock, toBlock, strict: true }),
    client.getLogs({ address: launchpad, event: graduationAbortedEvent, fromBlock, toBlock, strict: true }),
    client.getLogs({ address: launchpad, event: graduatedEvent, fromBlock, toBlock, strict: true }),
  ]);
  const timestamps = new Map();
  const { supply, curveSupply } = supplies;

  await transaction(async (db) => {
    const [replacedGraduations, replacedLifecycle] = await Promise.all([
      db.query(`SELECT token_address,pool_address FROM markets
        WHERE chain_id=$1 AND pool_address IS NOT NULL AND graduation_block BETWEEN $2 AND $3`,
      [config.chainId, fromBlock.toString(), toBlock.toString()]),
      db.query(`SELECT DISTINCT token_address FROM markets m JOIN chain_logs l
          ON l.chain_id=m.chain_id AND l.address=$4 AND l.orphaned=false AND l.block_number BETWEEN $2 AND $3
          AND l.topic0=ANY($5::text[]) AND l.topics->>1=('0x' || lpad(substr(m.token_address,3),64,'0'))
        WHERE m.chain_id=$1 AND m.orphaned=false`,
      [config.chainId, fromBlock.toString(), toBlock.toString(), lower(launchpad), lifecycleTopics]),
    ]);
    const replacedPools = replacedGraduations.rows.map((row) => row.pool_address);
    const replacedGraduatedTokens = replacedGraduations.rows.map((row) => row.token_address);
    await db.query(
      "UPDATE chain_logs SET orphaned = true WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3 AND address = $4 AND topic0 = ANY($5::text[])",
      [config.chainId, fromBlock.toString(), toBlock.toString(), lower(launchpad), lifecycleTopics],
    );
    await db.query(
      "UPDATE markets SET orphaned=true WHERE chain_id=$1 AND launch_block BETWEEN $2 AND $3",
      [config.chainId, fromBlock.toString(), toBlock.toString()],
    );
    await db.query(
      "UPDATE markets SET graduated=false,pool_address=NULL,graduation_block=NULL,graduated_at=NULL WHERE chain_id=$1 AND graduation_block BETWEEN $2 AND $3",
      [config.chainId, fromBlock.toString(), toBlock.toString()],
    );
    if (replacedPools.length) {
      await db.query("DELETE FROM protocol_accounts WHERE chain_id=$1 AND role='pool' AND address=ANY($2::text[])",
        [config.chainId, replacedPools]);
      for (const poolAddress of replacedPools) poolPairCache.delete(poolAddress);
    }
    if (replacedGraduatedTokens.length) {
      await db.query(`DELETE FROM notifications WHERE chain_id=$1 AND kind='graduation'
        AND payload->>'tokenAddress'=ANY($2::text[])`, [config.chainId, replacedGraduatedTokens]);
    }

    for (const log of launches) {
      await recordOccurrence(db, log);
      const block = await blockFor(log.blockNumber, timestamps);
      await recordBlock(db, block);
      const launchedAt = new Date(Number(block.timestamp) * 1_000);
      // The starting virtual quote isn't in the event; the market snapshot holds it from launch on.
      const market = await client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "market", args: [log.args.token], blockNumber: log.blockNumber });
      const initialVirtualQuote = market.initialVirtualQuote;
      const graduationTarget = initialVirtualQuote * curveSupply / (supply - curveSupply);
      const reserveTokens = log.args.reserveTokens;
      await db.query(
        `INSERT INTO markets
          (chain_id, token_address, launchpad_address, creator_address, name, symbol, metadata_uri,
           launch_tx_hash, launch_log_index, launch_block, launched_at,total_supply,curve_supply,reserve_amount,reserve_bps,
           initial_virtual_quote,graduation_target_quote,fee_bps,creator_fee_share_bps,buyback_fee_share_bps,creator_tax_bps,
           state,ready_at,orphaned)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,'trading',NULL,false)
         ON CONFLICT (chain_id, token_address) DO UPDATE SET
           launchpad_address = EXCLUDED.launchpad_address, creator_address = EXCLUDED.creator_address,
           name = EXCLUDED.name, symbol = EXCLUDED.symbol, metadata_uri = EXCLUDED.metadata_uri,
           launch_tx_hash = EXCLUDED.launch_tx_hash, launch_log_index = EXCLUDED.launch_log_index,
           launch_block = EXCLUDED.launch_block, launched_at = EXCLUDED.launched_at,total_supply=EXCLUDED.total_supply,
           curve_supply=EXCLUDED.curve_supply,reserve_amount=EXCLUDED.reserve_amount,reserve_bps=EXCLUDED.reserve_bps,
           initial_virtual_quote=EXCLUDED.initial_virtual_quote,graduation_target_quote=EXCLUDED.graduation_target_quote,
           fee_bps=EXCLUDED.fee_bps,creator_fee_share_bps=EXCLUDED.creator_fee_share_bps,
           buyback_fee_share_bps=EXCLUDED.buyback_fee_share_bps,creator_tax_bps=EXCLUDED.creator_tax_bps,
           state='trading', ready_at=NULL, orphaned = false`,
        [config.chainId, lower(log.args.token), lower(launchpad), lower(log.args.creator), log.args.name,
          log.args.symbol, log.args.uri, lower(log.transactionHash), log.logIndex, log.blockNumber.toString(), launchedAt,
          supply.toString(), curveSupply.toString(), reserveTokens.toString(), Number(reserveTokens * 10_000n / supply),
          initialVirtualQuote.toString(), graduationTarget.toString(), Number(log.args.feeBps),
          Number(log.args.creatorShareBps), Number(log.args.buybackShareBps), Number(log.args.taxBps)],
      );
      await db.query(`INSERT INTO assets (chain_id,address,name,symbol,decimals,metadata_uri)
        VALUES ($1,$2,$3,$4,18,$5) ON CONFLICT (chain_id,address) DO UPDATE SET
        name=EXCLUDED.name,symbol=EXCLUDED.symbol,metadata_uri=EXCLUDED.metadata_uri,updated_at=now()`,
      [config.chainId, lower(log.args.token), log.args.name, log.args.symbol, log.args.uri]);
      const eventId = logicalId(log);
      await db.query(`INSERT INTO notifications (chain_id,recipient_address,kind,actor_address,logical_event_id,payload)
        SELECT $1,f.follower_address,'followed_launch',$2,$3,$4::jsonb
        FROM follows f
        LEFT JOIN notification_preferences p ON p.chain_id=f.chain_id AND p.address=f.follower_address
        WHERE f.chain_id=$1 AND f.followed_address=$2
          AND COALESCE(p.in_app,true)=true AND COALESCE(p.launches,true)=true
        ON CONFLICT DO NOTHING`,
      [config.chainId, lower(log.args.creator), eventId, JSON.stringify({ tokenAddress: lower(log.args.token) })]);
      await db.query(`INSERT INTO notification_outbox (event_key,topic,payload)
        VALUES ($1,'launch',$2::jsonb) ON CONFLICT (event_key) DO NOTHING`,
      [`chain:${config.chainId}:launch:${eventId}`, JSON.stringify({ id: eventId, type: "launch", tokenAddress: lower(log.args.token) })]);
    }

    for (const log of [...readies, ...aborts]) {
      await recordOccurrence(db, log);
      await recordBlock(db, await blockFor(log.blockNumber, timestamps));
    }

    for (const log of graduations) {
      await recordOccurrence(db, log);
      const block = await blockFor(log.blockNumber, timestamps);
      await recordBlock(db, block);
      await db.query(
        "UPDATE markets SET graduated=true,pool_address=$1,graduation_block=$2,graduated_at=$3 WHERE chain_id=$4 AND token_address=$5",
        [lower(log.args.pool), log.blockNumber.toString(), new Date(Number(block.timestamp) * 1_000), config.chainId, lower(log.args.token)],
      );
      await db.query(`INSERT INTO protocol_accounts (chain_id,address,role,label,is_user_attributable)
        VALUES ($1,$2,'pool','Graduated pool',false) ON CONFLICT (chain_id,address,role) DO NOTHING`,
      [config.chainId, lower(log.args.pool)]);
      const eventId = logicalId(log);
      await db.query(
        `WITH recipients AS (
           SELECT m.chain_id,m.creator_address AS recipient_address FROM markets m
             WHERE m.chain_id=$1 AND m.token_address=$4
           UNION
           SELECT m.chain_id,f.follower_address FROM markets m
             JOIN follows f ON f.chain_id=m.chain_id AND f.followed_address=m.creator_address
             WHERE m.chain_id=$1 AND m.token_address=$4
         )
         INSERT INTO notifications (chain_id,recipient_address,kind,actor_address,logical_event_id,payload)
         SELECT $1,r.recipient_address,'graduation',m.creator_address,$2,$3::jsonb
         FROM recipients r JOIN markets m ON m.chain_id=r.chain_id AND m.token_address=$4
         LEFT JOIN notification_preferences p ON p.chain_id=r.chain_id AND p.address=r.recipient_address
         WHERE COALESCE(p.in_app,true)=true AND COALESCE(p.graduations,true)=true
         ON CONFLICT DO NOTHING`,
        [config.chainId, eventId, JSON.stringify({ tokenAddress: lower(log.args.token), poolAddress: lower(log.args.pool) }), lower(log.args.token)],
      );
      await db.query(`INSERT INTO notification_outbox (event_key,topic,payload)
        VALUES ($1,'graduation',$2::jsonb) ON CONFLICT (event_key) DO NOTHING`,
      [`chain:${config.chainId}:graduation:${eventId}`, JSON.stringify({ id: eventId, type: "graduation", tokenAddress: lower(log.args.token) })]);
    }

    // The lifecycle (trading, ready, aborted, graduated) and readyAt are read from the launchpad as of this
    // range's end for every market an event touched, so a replayed or reorged range can't leave them stale.
    const touched = new Set([
      ...replacedLifecycle.rows.map((row) => row.token_address),
      ...replacedGraduatedTokens,
      ...[...launches, ...readies, ...aborts, ...graduations].map((log) => lower(log.args.token)),
    ]);
    for (const token of touched) {
      const market = await client.readContract({ address: launchpad, abi: launchpadAbi, functionName: "market", args: [token], blockNumber: toBlock });
      if (market.creator === "0x0000000000000000000000000000000000000000") continue;
      await db.query("UPDATE markets SET state=$1,ready_at=$2 WHERE chain_id=$3 AND token_address=$4",
        [MARKET_STATES[market.state] ?? "trading", market.readyAt ? new Date(Number(market.readyAt) * 1_000) : null, config.chainId, token]);
    }

    await db.query(
      `INSERT INTO chain_cursors (chain_id, stream, next_block) VALUES ($1,'factory',$2)
       ON CONFLICT (chain_id, stream) DO UPDATE SET next_block = EXCLUDED.next_block, updated_at = now()`,
      [config.chainId, (toBlock + 1n).toString()],
    );
  });
}

async function indexTradeRange(fromBlock, toBlock, onEvent) {
  const launchpad = lower(config.launchpadAddress);
  const logs = await client.getLogs({ address: config.launchpadAddress, event: tradeEvent, fromBlock, toBlock, strict: true });
  logs.sort((left, right) => Number(left.blockNumber - right.blockNumber) || left.logIndex - right.logIndex);
  const timestamps = new Map();
  const emitted = [];

  await transaction(async (db) => {
    await db.query(
      "UPDATE chain_logs SET orphaned = true WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3 AND address = $4 AND topic0 = $5",
      [config.chainId, fromBlock.toString(), toBlock.toString(), launchpad, tradeTopic],
    );
    const replaced = await db.query(
      "SELECT logical_id FROM trades WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3 AND launchpad_address=$4 AND orphaned=false",
      [config.chainId, fromBlock.toString(), toBlock.toString(), launchpad],
    );
    const replacedIds = replaced.rows.map((row) => row.logical_id);
    if (replacedIds.length) {
      await db.query(`DELETE FROM notifications WHERE chain_id=$1 AND (
        logical_event_id=ANY($2::text[])
        OR split_part(logical_event_id, ':milestone:', 1)=ANY($2::text[])
      )`, [config.chainId, replacedIds]);
    }
    await db.query(
      "UPDATE trades SET orphaned = true WHERE chain_id = $1 AND block_number BETWEEN $2 AND $3 AND launchpad_address = $4",
      [config.chainId, fromBlock.toString(), toBlock.toString(), launchpad],
    );

    for (const log of logs) {
      await recordOccurrence(db, log);
      const id = logicalId(log);
      const block = await blockFor(log.blockNumber, timestamps);
      await recordBlock(db, block);
      const occurredAt = new Date(Number(block.timestamp) * 1_000);
      // quoteAmount is what the trader paid on a buy (fee and tax included) or received on a sell; the
      // curve-side quote and the sold amount follow from it and the post-trade virtual token reserve.
      const { isBuy, quoteAmount, fee, tax, tokenAmount, virtualToken, virtualQuote } = log.args;
      const curveQuote = isBuy ? quoteAmount - fee - tax : quoteAmount + fee + tax;
      const soldAfter = supplies.supply - virtualToken;
      await db.query(
        `INSERT INTO trades
          (logical_id, chain_id, block_hash, block_number, transaction_hash, transaction_index, log_index,
           token_address, launchpad_address, trader_address, is_buy, gross_curve_quote,
           net_trader_quote, fee_quote, creator_tax_quote, token_amount, virtual_quote_after,
           virtual_token_after, sold_after, block_timestamp, orphaned)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,false)
         ON CONFLICT (logical_id) DO UPDATE SET block_hash = EXCLUDED.block_hash,
           block_number = EXCLUDED.block_number, block_timestamp = EXCLUDED.block_timestamp, orphaned = false`,
        [id, config.chainId, lower(log.blockHash), log.blockNumber.toString(), lower(log.transactionHash), log.transactionIndex ?? null, log.logIndex,
          lower(log.args.token), lower(log.address), lower(log.args.trader), isBuy,
          curveQuote.toString(), quoteAmount.toString(), fee.toString(), tax.toString(), tokenAmount.toString(),
          virtualQuote.toString(), virtualToken.toString(), soldAfter.toString(), occurredAt],
      );
      await db.query(
        `INSERT INTO notifications (chain_id, recipient_address, kind, actor_address, logical_event_id, payload)
         SELECT $1, f.follower_address, $2, $3, $4, $5::jsonb
         FROM follows f
         LEFT JOIN notification_preferences p ON p.chain_id = f.chain_id AND p.address = f.follower_address
         WHERE f.chain_id = $1 AND f.followed_address = $3
           AND COALESCE(p.in_app, true) = true
           AND CASE WHEN $6::boolean THEN COALESCE(p.trade_buys, true) ELSE COALESCE(p.trade_sells, true) END
         ON CONFLICT DO NOTHING`,
        [config.chainId, log.args.isBuy ? "followed_buy" : "followed_sell", lower(log.args.trader), id,
          JSON.stringify({ tokenAddress: lower(log.args.token), transactionHash: lower(log.transactionHash) }), log.args.isBuy],
      );
      const market = await db.query(
        "SELECT creator_address,curve_supply FROM markets WHERE chain_id=$1 AND token_address=$2 AND orphaned=false",
        [config.chainId, lower(log.args.token)],
      );
      const milestones = market.rows[0]?.curve_supply ? crossedCurveMilestones({
        isBuy: log.args.isBuy,
        soldAfter,
        tokenAmount,
        curveSupply: market.rows[0].curve_supply,
      }) : [];
      for (const milestone of milestones) {
        const eventId = `${id}:milestone:${milestone}`;
        const payload = JSON.stringify({
          tokenAddress: lower(log.args.token),
          transactionHash: lower(log.transactionHash),
          milestone,
        });
        await db.query(`WITH recipients AS (
            SELECT $3::text AS recipient_address
            UNION
            SELECT follower_address FROM follows WHERE chain_id=$1 AND followed_address=$3
          )
          INSERT INTO notifications (chain_id,recipient_address,kind,actor_address,logical_event_id,payload)
          SELECT $1,r.recipient_address,'curve_milestone',$3,$4,$5::jsonb
          FROM recipients r
          LEFT JOIN notification_preferences p ON p.chain_id=$1 AND p.address=r.recipient_address
          WHERE COALESCE(p.in_app,true)=true AND COALESCE(p.graduations,true)=true
            AND NOT EXISTS (
              SELECT 1 FROM notifications n
              WHERE n.chain_id=$1 AND n.recipient_address=r.recipient_address AND n.kind='curve_milestone'
                AND n.payload->>'tokenAddress'=$2 AND n.payload->>'milestone'=$6::text
            )
          ON CONFLICT DO NOTHING`,
        [config.chainId, lower(log.args.token), market.rows[0].creator_address, eventId, payload, milestone]);
      }
      await db.query(`INSERT INTO notification_outbox (event_key,topic,payload)
        VALUES ($1,'trade',$2::jsonb) ON CONFLICT (event_key) DO NOTHING`,
      [`chain:${config.chainId}:trade:${id}`, JSON.stringify({ id, type: "trade", tokenAddress: lower(log.args.token) })]);
      emitted.push({ id, type: "trade" });
    }

    const affectedPositions = await db.query(`SELECT DISTINCT trader_address,token_address FROM trades
      WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3 AND launchpad_address=$4`,
    [config.chainId, fromBlock.toString(), toBlock.toString(), launchpad]);
    for (const position of affectedPositions.rows) {
      await rebuildCurvePosition(db, position.trader_address, position.token_address);
    }
    const affectedTokens = new Set([
      ...affectedPositions.rows.map((position) => position.token_address),
      ...logs.map((log) => lower(log.args.token)),
    ]);
    for (const tokenAddress of affectedTokens) {
      await rebuildMarketStats(db, tokenAddress);
      await rebuildMarketCandles(db, tokenAddress);
    }
    const affectedTraders = new Set(affectedPositions.rows.map((row) => row.trader_address));
    for (const traderAddress of affectedTraders) {
      await refreshPerformanceSnapshot(db, traderAddress, toBlock);
    }
    if (affectedTraders.size) await publishLeaderboards(db, toBlock);

    await db.query(
      `INSERT INTO chain_cursors (chain_id, stream, next_block) VALUES ($1,'trades',$2)
       ON CONFLICT (chain_id, stream) DO UPDATE SET next_block = EXCLUDED.next_block, updated_at = now()`,
      [config.chainId, (toBlock + 1n).toString()],
    );
  });

  for (const event of emitted) onEvent?.(event);
}

async function logsFor(addresses, event, fromBlock, toBlock) {
  if (!addresses.length) return [];
  const logs = [];
  for (let index = 0; index < addresses.length; index += 100) {
    const batch = addresses.slice(index, index + 100);
    logs.push(...await client.getLogs({ address: batch.length === 1 ? batch[0] : batch, event, fromBlock, toBlock, strict: true }));
  }
  return logs;
}

async function recordProtocolFlow(db, log, blockTimestamp, category, values = {}) {
  const id = logicalId(log);
  await db.query(`INSERT INTO protocol_flows
      (logical_id,chain_id,block_hash,block_number,transaction_hash,log_index,category,market_token_address,
       asset_address,from_address,to_address,amount,metadata,block_timestamp,orphaned)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14,false)
    ON CONFLICT (logical_id) DO UPDATE SET orphaned=false,block_hash=EXCLUDED.block_hash,
      block_number=EXCLUDED.block_number,block_timestamp=EXCLUDED.block_timestamp,metadata=EXCLUDED.metadata`,
  [id, config.chainId, lower(log.blockHash), log.blockNumber.toString(), lower(log.transactionHash), log.logIndex,
    category, values.marketTokenAddress || null, values.assetAddress || null, values.fromAddress || null,
    values.toAddress || null, String(values.amount ?? 0), JSON.stringify(values.metadata || {}), blockTimestamp]);
  return id;
}

async function indexLedgerRange(fromBlock, toBlock) {
  const [marketsResult, accountsResult] = await Promise.all([
    pool.query("SELECT token_address FROM markets WHERE chain_id=$1 AND orphaned=false", [config.chainId]),
    pool.query("SELECT role,address FROM protocol_accounts WHERE chain_id=$1", [config.chainId]),
  ]);
  const tokens = marketsResult.rows.map((row) => row.token_address);
  const roles = new Map();
  for (const row of accountsResult.rows) {
    const current = roles.get(row.role) || [];
    current.push(row.address);
    roles.set(row.role, current);
  }
  const role = (name) => roles.get(name) || [];
  const [transfers, feesAccrued, feesClaimed, buybacks, lpFees, reserveRegistrations, reserveClaims] = await Promise.all([
    logsFor(tokens, transferEvent, fromBlock, toBlock),
    logsFor(role("escrow"), feeAccruedEvent, fromBlock, toBlock),
    logsFor(role("escrow"), feeClaimedEvent, fromBlock, toBlock),
    logsFor(role("escrow"), buybackBurnedEvent, fromBlock, toBlock),
    logsFor(role("locker"), lpFeesClaimedEvent, fromBlock, toBlock),
    logsFor(role("holderReserve"), reserveRegisteredEvent, fromBlock, toBlock),
    logsFor(role("holderReserve"), reserveClaimedEvent, fromBlock, toBlock),
  ]);
  const timestamps = new Map();
  const quoteAddress = role("quote")[0] || null;
  const affectedWallets = new Set();
  for (const log of transfers) {
    const from = lower(log.args.from);
    const to = lower(log.args.to);
    if (from !== "0x0000000000000000000000000000000000000000") affectedWallets.add(from);
    if (to !== "0x0000000000000000000000000000000000000000") affectedWallets.add(to);
  }

  await transaction(async (db) => {
    const replacedTransfers = await db.query(`SELECT from_address,to_address FROM asset_transfers
      WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3 AND orphaned=false`,
    [config.chainId, fromBlock.toString(), toBlock.toString()]);
    for (const transfer of replacedTransfers.rows) {
      if (transfer.from_address !== "0x0000000000000000000000000000000000000000") affectedWallets.add(transfer.from_address);
      if (transfer.to_address !== "0x0000000000000000000000000000000000000000") affectedWallets.add(transfer.to_address);
    }
    await db.query(`UPDATE chain_logs SET orphaned=true
      WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3 AND topic0=ANY($4::text[])`,
    [config.chainId, fromBlock.toString(), toBlock.toString(), ledgerTopics]);
    await db.query("UPDATE asset_transfers SET orphaned=true WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3",
      [config.chainId, fromBlock.toString(), toBlock.toString()]);
    await db.query("UPDATE protocol_flows SET orphaned=true WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3",
      [config.chainId, fromBlock.toString(), toBlock.toString()]);
    await db.query("UPDATE buyback_executions SET orphaned=true WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3",
      [config.chainId, fromBlock.toString(), toBlock.toString()]);
    await db.query("UPDATE reserve_claims SET orphaned=true WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3",
      [config.chainId, fromBlock.toString(), toBlock.toString()]);

    const occurrence = async (log) => {
      await recordOccurrence(db, log);
      const block = await blockFor(log.blockNumber, timestamps);
      await recordBlock(db, block);
      return new Date(Number(block.timestamp) * 1_000);
    };

    for (const log of transfers) {
      const occurredAt = await occurrence(log);
      await db.query(`INSERT INTO asset_transfers
          (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,log_index,
           token_address,from_address,to_address,amount,block_timestamp,orphaned,finalized)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,false,true)
        ON CONFLICT (logical_id) DO UPDATE SET orphaned=false,finalized=true,block_hash=EXCLUDED.block_hash,
          block_number=EXCLUDED.block_number,block_timestamp=EXCLUDED.block_timestamp`,
      [logicalId(log), config.chainId, lower(log.blockHash), log.blockNumber.toString(), lower(log.transactionHash),
        log.transactionIndex ?? null, log.logIndex, lower(log.address), lower(log.args.from), lower(log.args.to),
        log.args.value.toString(), occurredAt]);
    }
    // One accrual per fee: amount is the whole fee, split as recorded in metadata. The creator's share
    // is attributable to the market even though claims (below) pool across a creator's launches.
    for (const log of feesAccrued) {
      const occurredAt = await occurrence(log);
      const { creatorAmount, buybackAmount, protocolAmount } = log.args;
      await recordProtocolFlow(db, log, occurredAt, "fee_accrued", {
        marketTokenAddress: lower(log.args.token), assetAddress: lower(log.args.asset), toAddress: lower(log.address),
        amount: creatorAmount + buybackAmount + protocolAmount,
        metadata: { creatorAmount: creatorAmount.toString(), buybackAmount: buybackAmount.toString(), protocolAmount: protocolAmount.toString() },
      });
    }
    for (const log of feesClaimed) {
      const occurredAt = await occurrence(log);
      await recordProtocolFlow(db, log, occurredAt, "fee_claimed", {
        assetAddress: lower(log.args.asset), fromAddress: lower(log.address),
        toAddress: lower(log.args.account), amount: log.args.amount,
      });
    }
    for (const log of lpFees) {
      const occurredAt = await occurrence(log);
      await recordProtocolFlow(db, log, occurredAt, "pool_fee", {
        marketTokenAddress: lower(log.args.token), assetAddress: quoteAddress, amount: log.args.quoteAmount,
        metadata: { poolAddress: lower(log.args.pool), tokenAmount: log.args.tokenAmount.toString() },
      });
    }
    for (const log of buybacks) {
      const occurredAt = await occurrence(log);
      const token = lower(log.args.token);
      const poolResult = await db.query("SELECT pool_address FROM markets WHERE chain_id=$1 AND token_address=$2", [config.chainId, token]);
      const poolAddress = poolResult.rows[0]?.pool_address || lower(log.address);
      const id = await recordProtocolFlow(db, log, occurredAt, "buyback", {
        marketTokenAddress: token, assetAddress: quoteAddress, fromAddress: lower(log.address),
        amount: log.args.quoteSpent, metadata: { poolAddress, tokensBurned: log.args.tokensBurned.toString() },
      });
      await db.query(`INSERT INTO buyback_executions
          (logical_id,chain_id,token_address,venue_address,quote_spent,tokens_bought,transaction_hash,block_number,block_timestamp,orphaned)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,false) ON CONFLICT (logical_id) DO UPDATE SET
          orphaned=false,block_number=EXCLUDED.block_number,block_timestamp=EXCLUDED.block_timestamp`,
      [id, config.chainId, token, poolAddress, log.args.quoteSpent.toString(),
        log.args.tokensBurned.toString(), lower(log.transactionHash), log.blockNumber.toString(), occurredAt]);
    }
    for (const log of reserveRegistrations) {
      const occurredAt = await occurrence(log);
      await recordProtocolFlow(db, log, occurredAt, "reserve_registered", {
        marketTokenAddress: lower(log.args.token), assetAddress: lower(log.args.token), toAddress: lower(log.address),
        amount: log.args.amount,
      });
    }
    // The lean reserve has no rounds: each curve buyer claims once, so round_id is always 0.
    for (const log of reserveClaims) {
      const occurredAt = await occurrence(log);
      const id = await recordProtocolFlow(db, log, occurredAt, "reserve_claim", {
        marketTokenAddress: lower(log.args.token), assetAddress: lower(log.args.token), fromAddress: lower(log.address),
        toAddress: lower(log.args.account), amount: log.args.amount,
      });
      await db.query(`INSERT INTO reserve_claims
          (logical_id,chain_id,token_address,round_id,holder_address,amount,transaction_hash,block_number,claimed_at,orphaned)
        VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8,false) ON CONFLICT (logical_id) DO UPDATE SET
          orphaned=false,block_number=EXCLUDED.block_number,claimed_at=EXCLUDED.claimed_at`,
      [id, config.chainId, lower(log.args.token), lower(log.args.account),
        log.args.amount.toString(), lower(log.transactionHash), log.blockNumber.toString(), occurredAt]);
    }
    for (const address of affectedWallets) await refreshPerformanceSnapshot(db, address, toBlock);
    if (affectedWallets.size) await publishLeaderboards(db, toBlock);
    await db.query(`INSERT INTO chain_cursors (chain_id,stream,next_block) VALUES ($1,'ledger',$2)
      ON CONFLICT (chain_id,stream) DO UPDATE SET next_block=EXCLUDED.next_block,updated_at=now()`,
    [config.chainId, (toBlock + 1n).toString()]);
  });
}

async function pairForPool(poolAddress) {
  const address = lower(poolAddress);
  if (!poolPairCache.has(address)) {
    const pair = Promise.all([
      client.readContract({ address, abi: poolPairAbi, functionName: "token0" }),
      client.readContract({ address, abi: poolPairAbi, functionName: "token1" }),
    ]).then(([token0, token1]) => ({ token0: lower(token0), token1: lower(token1) }))
      .catch((error) => {
        poolPairCache.delete(address);
        throw error;
      });
    poolPairCache.set(address, pair);
  }
  return poolPairCache.get(address);
}

async function indexVenueRange(fromBlock, toBlock) {
  const [marketsResult, quoteResult, existingResult] = await Promise.all([
    pool.query(`SELECT token_address,pool_address FROM markets
      WHERE chain_id=$1 AND orphaned=false AND graduated=true AND pool_address IS NOT NULL`, [config.chainId]),
    pool.query("SELECT address FROM protocol_accounts WHERE chain_id=$1 AND role='quote' LIMIT 1", [config.chainId]),
    pool.query(`SELECT DISTINCT token_address,pool_address FROM venue_swaps
      WHERE chain_id=$1 AND orphaned=false AND block_number BETWEEN $2 AND $3`,
    [config.chainId, fromBlock.toString(), toBlock.toString()]),
  ]);
  if (!marketsResult.rowCount && !existingResult.rowCount) {
    await pool.query(`INSERT INTO chain_cursors (chain_id,stream,next_block) VALUES ($1,'venue',$2)
      ON CONFLICT (chain_id,stream) DO UPDATE SET next_block=EXCLUDED.next_block,updated_at=now()`,
    [config.chainId, (toBlock + 1n).toString()]);
    return;
  }
  const quoteAddress = quoteResult.rows[0]?.address;
  if (marketsResult.rowCount && !quoteAddress) {
    throw new Error("Cannot index venue swaps before the factory quote asset is discovered.");
  }

  const marketByPool = new Map(marketsResult.rows.map((row) => [row.pool_address, row]));
  const pools = [...marketByPool.keys()];
  const indexedPools = [...new Set([...pools, ...existingResult.rows.map((row) => row.pool_address)])];
  const pairs = new Map(await Promise.all(pools.map(async (poolAddress) => [poolAddress, await pairForPool(poolAddress)])));
  for (const [poolAddress, market] of marketByPool) {
    const pair = pairs.get(poolAddress);
    const expected = new Set([market.token_address, quoteAddress]);
    if (!expected.has(pair.token0) || !expected.has(pair.token1) || pair.token0 === pair.token1) {
      throw new Error(`Graduated pool ${poolAddress} does not contain its market token and configured quote asset.`);
    }
  }

  const logs = await logsFor(pools, poolSwapEvent, fromBlock, toBlock);
  logs.sort((left, right) => Number(left.blockNumber - right.blockNumber) || left.logIndex - right.logIndex);
  const timestamps = new Map();
  const affectedTokens = new Set(existingResult.rows.map((row) => row.token_address));

  await transaction(async (db) => {
    await db.query(`UPDATE chain_logs SET orphaned=true
      WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3 AND address=ANY($4::text[])`,
    [config.chainId, fromBlock.toString(), toBlock.toString(), indexedPools]);
    await db.query(`UPDATE venue_swaps SET orphaned=true
      WHERE chain_id=$1 AND block_number BETWEEN $2 AND $3 AND pool_address=ANY($4::text[])`,
    [config.chainId, fromBlock.toString(), toBlock.toString(), indexedPools]);

    for (const log of logs) {
      const poolAddress = lower(log.address);
      const market = marketByPool.get(poolAddress);
      const pair = pairs.get(poolAddress);
      if (!market || !pair) continue;
      const tokenIs0 = pair.token0 === market.token_address;
      const tokenAmountIn = tokenIs0 ? log.args.amount0In : log.args.amount1In;
      const tokenAmountOut = tokenIs0 ? log.args.amount0Out : log.args.amount1Out;
      const quoteAmountIn = tokenIs0 ? log.args.amount1In : log.args.amount0In;
      const quoteAmountOut = tokenIs0 ? log.args.amount1Out : log.args.amount0Out;
      const isBuy = tokenAmountOut > 0n;
      const tokenAmount = isBuy ? tokenAmountOut : tokenAmountIn;
      const quoteAmount = isBuy ? quoteAmountIn : quoteAmountOut;
      if (tokenAmount === 0n || quoteAmount === 0n) continue;

      await recordOccurrence(db, log);
      const block = await blockFor(log.blockNumber, timestamps);
      await recordBlock(db, block);
      const occurredAt = new Date(Number(block.timestamp) * 1_000);
      const id = logicalId(log);
      const priceX18 = quoteAmount * 1_000_000_000_000_000_000n / tokenAmount;
      await db.query(`INSERT INTO venue_swaps
          (logical_id,chain_id,block_hash,block_number,transaction_hash,transaction_index,log_index,
           token_address,quote_address,pool_address,sender_address,recipient_address,is_buy,quote_amount,
           token_amount,amount0_in,amount1_in,amount0_out,amount1_out,price_x18,block_timestamp,orphaned,finalized)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,false,true)
        ON CONFLICT (logical_id) DO UPDATE SET orphaned=false,finalized=true,block_hash=EXCLUDED.block_hash,
          block_number=EXCLUDED.block_number,block_timestamp=EXCLUDED.block_timestamp`,
      [id, config.chainId, lower(log.blockHash), log.blockNumber.toString(), lower(log.transactionHash),
        log.transactionIndex ?? null, log.logIndex, market.token_address, quoteAddress, poolAddress,
        lower(log.args.sender), lower(log.args.to), isBuy, quoteAmount.toString(), tokenAmount.toString(),
        log.args.amount0In.toString(), log.args.amount1In.toString(), log.args.amount0Out.toString(),
        log.args.amount1Out.toString(), priceX18.toString(), occurredAt]);
      await db.query(`INSERT INTO notification_outbox (event_key,topic,payload)
        VALUES ($1,'venue_swap',$2::jsonb) ON CONFLICT (event_key) DO NOTHING`,
      [`chain:${config.chainId}:venue-swap:${id}`, JSON.stringify({ id, type: "venue_swap", tokenAddress: market.token_address })]);
      affectedTokens.add(market.token_address);
    }

    for (const tokenAddress of affectedTokens) {
      await rebuildMarketStats(db, tokenAddress);
      await rebuildMarketCandles(db, tokenAddress);
    }
    await db.query(`INSERT INTO chain_cursors (chain_id,stream,next_block) VALUES ($1,'venue',$2)
      ON CONFLICT (chain_id,stream) DO UPDATE SET next_block=EXCLUDED.next_block,updated_at=now()`,
    [config.chainId, (toBlock + 1n).toString()]);
  });
}

async function scanStream(stream, safeHead, scan) {
  const stored = await cursor(stream);
  let fromBlock = stored > REORG_OVERLAP ? stored - REORG_OVERLAP : config.deploymentBlock;
  if (fromBlock < config.deploymentBlock) fromBlock = config.deploymentBlock;
  while (fromBlock <= safeHead) {
    const toBlock = fromBlock + config.logRange - 1n < safeHead ? fromBlock + config.logRange - 1n : safeHead;
    await scan(fromBlock, toBlock);
    fromBlock = toBlock + 1n;
  }
}

export function startIndexer({ onEvent, onError } = {}) {
  let stopped = false;
  let timer;
  let initialized = false;
  let leadershipClient = null;
  // The API caches RNS name answers in rns_cache; expired rows are never read again, so the
  // leader prunes them hourly to keep the table bounded by one hour of lookups.
  let nextRnsPruneAt = 0;

  const acquireLeadership = async () => {
    if (leadershipClient) return true;
    const candidate = await pool.connect();
    const result = await candidate.query("SELECT pg_try_advisory_lock($1::integer,$2::integer) AS acquired", [config.chainId, 112927085]);
    if (!result.rows[0].acquired) {
      candidate.release();
      return false;
    }
    leadershipClient = candidate;
    candidate.on("error", (error) => {
      leadershipClient = null;
      initialized = false;
      onError?.(error);
    });
    return true;
  };

  const tick = async () => traceBackendTask("social.indexer.tick", async () => {
    if (stopped) return;
    try {
      if (!await acquireLeadership()) return;
      if (!initialized) {
        await initializeIndexerState();
        initialized = true;
      }
      const now = Date.now();
      if (now >= nextRnsPruneAt) {
        nextRnsPruneAt = now + 3_600_000;
        await pool.query(`DELETE FROM rns_cache WHERE expires_at < now() - interval '1 hour'`);
      }
      const head = await client.getBlockNumber();
      const safeHead = head > config.confirmations ? head - config.confirmations : 0n;
      if (safeHead >= config.deploymentBlock) {
        await scanStream("factory", safeHead, indexFactoryRange);
        await scanStream("trades", safeHead, (from, to) => indexTradeRange(from, to, onEvent));
        await scanStream("ledger", safeHead, indexLedgerRange);
        await scanStream("venue", safeHead, indexVenueRange);
      }
    } catch (error) {
      onError?.(error);
    } finally {
      if (!stopped) timer = setTimeout(tick, config.pollIntervalMs);
    }
  });

  void tick();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    if (leadershipClient) {
      const activeClient = leadershipClient;
      leadershipClient = null;
      void activeClient.query("SELECT pg_advisory_unlock($1::integer,$2::integer)", [config.chainId, 112927085])
        .finally(() => activeClient.release());
    }
  };
}
