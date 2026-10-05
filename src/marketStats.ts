import { sql, type SQL } from "drizzle-orm";

export type MarketReadDb = { execute(query: SQL): PromiseLike<unknown> };

export type TokenStats = {
  volume24h: number | null;
  holders: number | null;
  change24h: number | null;
  peakPrice: number | null;
  lastPrice: number | null;
  priceHistory: number[] | null;
};

const WEI = 1e18;

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

// A trade's price is quoteAmount / tokenAmount — both wei, so the ratio is
// quote-per-token in whole units, the same scale as the on-chain realQ / sold
// price the /tokens endpoint already reports.
const PRICED_TRADES = sql`
  SELECT
    token,
    trader,
    side,
    quote::numeric AS quote,
    COALESCE(gross_curve_quote, quote)::numeric AS price_quote,
    amount::numeric AS amount,
    COALESCE(block_time, created_at) AS ts,
    CASE WHEN amount::numeric > 0
         THEN COALESCE(gross_curve_quote, quote)::numeric / amount::numeric
    END AS price
  FROM trades
  WHERE deleted_at IS NULL
`;

/**
 * Per-token market telemetry derived from indexed Trade events. One pass for the
 * scalars, one for the hourly price series. Tokens with no trades are absent
 * from the map — callers leave those fields null rather than reporting zeros.
 */
export async function marketStats(db: MarketReadDb): Promise<Map<string, TokenStats>> {
  const [aggregates, buckets] = await Promise.all([
    db.execute(sql`
      WITH priced AS (${PRICED_TRADES}),
      totals AS (
        SELECT
          token,
          SUM(quote) FILTER (WHERE ts >= now() - interval '24 hours') / ${WEI} AS volume_24h,
          MAX(price) AS peak_price
        FROM priced
        GROUP BY token
      ),
      latest AS (
        SELECT DISTINCT ON (token) token, price
        FROM priced WHERE price IS NOT NULL
        ORDER BY token, ts DESC
      ),
      reference AS (
        SELECT DISTINCT ON (token) token, price
        FROM priced
        WHERE price IS NOT NULL AND ts <= now() - interval '24 hours'
        ORDER BY token, ts DESC
      ),
      earliest AS (
        SELECT DISTINCT ON (token) token, price
        FROM priced WHERE price IS NOT NULL
        ORDER BY token, ts ASC
      ),
      positions AS (
        SELECT
          token,
          trader,
          SUM(CASE WHEN side = 'buy' THEN amount ELSE -amount END) AS net
        FROM priced
        GROUP BY token, trader
      ),
      holder_counts AS (
        SELECT token, COUNT(*)::int AS holders
        FROM positions WHERE net > 0
        GROUP BY token
      )
      SELECT
        totals.token,
        totals.volume_24h,
        totals.peak_price,
        latest.price AS last_price,
        COALESCE(reference.price, earliest.price) AS reference_price,
        holder_counts.holders
      FROM totals
      LEFT JOIN latest ON latest.token = totals.token
      LEFT JOIN reference ON reference.token = totals.token
      LEFT JOIN earliest ON earliest.token = totals.token
      LEFT JOIN holder_counts ON holder_counts.token = totals.token
    `),
    db.execute(sql`
      SELECT
        token,
        date_trunc('hour', COALESCE(block_time, created_at)) AS bucket,
        AVG(COALESCE(gross_curve_quote, quote)::numeric / amount::numeric) AS price
      FROM trades
      WHERE deleted_at IS NULL
        AND amount::numeric > 0
        AND COALESCE(block_time, created_at) >= now() - interval '24 hours'
      GROUP BY token, bucket
      ORDER BY token, bucket
    `),
  ]);

  const history = new Map<string, number[]>();
  for (const row of buckets as unknown as { token: string; price: unknown }[]) {
    const price = toNumber(row.price);
    if (price === null) continue;
    const series = history.get(row.token);
    if (series) series.push(price);
    else history.set(row.token, [price]);
  }

  const stats = new Map<string, TokenStats>();
  for (const row of aggregates as unknown as Record<string, unknown>[]) {
    const token = row.token as string;
    const lastPrice = toNumber(row.last_price);
    const referencePrice = toNumber(row.reference_price);
    stats.set(token, {
      volume24h: toNumber(row.volume_24h) ?? 0,
      holders: toNumber(row.holders) ?? 0,
      change24h:
        lastPrice !== null && referencePrice
          ? (lastPrice / referencePrice - 1) * 100
          : null,
      peakPrice: toNumber(row.peak_price),
      lastPrice,
      priceHistory: history.get(token) ?? null,
    });
  }
  return stats;
}

const RANGES = {
  "5min": { window: "5 minutes", bucketSeconds: 15 },
  "1h": { window: "1 hour", bucketSeconds: 60 },
  "6h": { window: "6 hours", bucketSeconds: 300 },
  "1D": { window: "1 day", bucketSeconds: 900 },
  all: { window: null, bucketSeconds: 86_400 },
} as const;

export type CandleRange = keyof typeof RANGES;

export function isCandleRange(value: string): value is CandleRange {
  return value in RANGES;
}

/**
 * Bucketed close prices for the chart. Each bucket takes the last trade in it
 * rather than the average — a price chart should show where the market actually
 * ended the interval, not a midpoint no trade happened at.
 */
export async function candles(db: MarketReadDb, token: string, range: CandleRange) {
  const { window, bucketSeconds } = RANGES[range];
  const since = window
    ? sql`AND COALESCE(block_time, created_at) >= now() - ${sql.raw(`interval '${window}'`)}`
    : sql``;
  const rows = await db.execute(sql`
    SELECT
      to_timestamp(
        floor(extract(epoch FROM COALESCE(block_time, created_at)) / ${bucketSeconds})
        * ${bucketSeconds}
      ) AS t,
      (array_agg(
        COALESCE(gross_curve_quote, quote)::numeric / amount::numeric
        ORDER BY COALESCE(block_time, created_at) DESC
      ))[1] AS price
    FROM trades
    WHERE token = ${token}
      AND deleted_at IS NULL
      AND amount::numeric > 0
      ${since}
    GROUP BY t
    ORDER BY t
  `);
  return (rows as unknown as { t: string; price: unknown }[])
    .map((row) => ({ t: row.t, price: toNumber(row.price) }))
    .filter((point): point is { t: string; price: number } => point.price !== null);
}

// ponytail: net position from Trade events only. Wallet-to-wallet ERC20
// transfers never touch the launchpad, so a holder who received tokens off-curve
// is invisible here. Index Transfer events into a balances table if this needs
// to be exact.
export async function holders(db: MarketReadDb, token: string, limit = 100) {
  const rows = await db.execute(sql`
    WITH positions AS (
      SELECT
        trader,
        SUM(CASE WHEN side = 'buy' THEN amount::numeric ELSE -amount::numeric END) AS net
      FROM trades
      WHERE token = ${token} AND deleted_at IS NULL
      GROUP BY trader
    )
    SELECT trader, net / ${WEI} AS balance
    FROM positions
    WHERE net > 0
    ORDER BY net DESC
    LIMIT ${limit}
  `);
  return (rows as unknown as { trader: string; balance: unknown }[]).map(
    (row) => ({ address: row.trader, balance: toNumber(row.balance) ?? 0 }),
  );
}

export async function position(db: MarketReadDb, token: string, wallet: string) {
  const [row] = (await db.execute(sql`
    SELECT
      SUM(CASE WHEN side = 'buy' THEN amount::numeric ELSE -amount::numeric END) / ${WEI} AS balance,
      SUM(CASE WHEN side = 'buy' THEN quote::numeric ELSE 0 END) / ${WEI} AS invested,
      SUM(CASE WHEN side = 'sell' THEN quote::numeric ELSE 0 END) / ${WEI} AS proceeds,
      SUM(CASE WHEN side = 'buy' THEN amount::numeric ELSE 0 END) / ${WEI} AS bought,
      COUNT(*)::int AS trades
    FROM trades
    WHERE token = ${token}
      AND lower(trader) = lower(${wallet})
      AND deleted_at IS NULL
  `)) as unknown as Record<string, unknown>[];

  const bought = toNumber(row?.bought) ?? 0;
  const invested = toNumber(row?.invested) ?? 0;
  return {
    balance: toNumber(row?.balance) ?? 0,
    invested,
    proceeds: toNumber(row?.proceeds) ?? 0,
    avgCost: bought > 0 ? invested / bought : null,
    trades: toNumber(row?.trades) ?? 0,
  };
}
