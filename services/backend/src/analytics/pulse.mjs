// SQL returns one highest-ranked time window per market. Keep the shaping
// boundary small: all ranking, filtering, and exact totals happen in Postgres.
export function shapePublicPulseMoments(rows, { scope = "now" } = {}) {
  return rows.map((row) => {
    const buy = BigInt(row.buy_quote_wei || 0);
    const sell = BigInt(row.sell_quote_wei || 0);
    return {
      tokenAddress: row.token_address,
      tokenName: row.token_name,
      tokenSymbol: row.token_symbol,
      firstAt: row.first_at,
      latestAt: row.latest_at,
      tradeCount: Number(row.trade_count),
      buyCount: Number(row.buy_count),
      sellCount: Number(row.sell_count),
      distinctWalletCount: Number(row.distinct_wallet_count),
      buyQuoteWei: buy.toString(),
      sellQuoteWei: sell.toString(),
      netQuoteWei: (buy - sell).toString(),
      followedTraderCount:
        scope === "following" ? Number(row.distinct_wallet_count) : 0,
      reason:
        scope === "following"
          ? "following"
          : buy > sell
            ? "net_buying"
            : sell > buy
              ? "net_selling"
              : "activity",
      sampleTransactionHash: row.transaction_hash,
    };
  });
}
