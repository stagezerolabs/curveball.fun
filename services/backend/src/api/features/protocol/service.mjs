import { pool } from "../../../platform/db.mjs";
import { config } from "../../../platform/config.mjs";

export async function protocolStats() {
  const result = await pool.query(
    `SELECT
      COUNT(*) FILTER (WHERE orphaned=false) AS markets,
      COUNT(*) FILTER (WHERE orphaned=false AND graduated=true) AS graduated,
      COALESCE((SELECT SUM(gross_curve_quote) FROM trades WHERE chain_id=$1 AND orphaned=false),0) AS gross_quote_volume,
      COALESCE((SELECT SUM(net_trader_quote) FROM trades WHERE chain_id=$1 AND orphaned=false),0) AS wallet_cash_turnover,
      (SELECT COUNT(DISTINCT trader_address) FROM trades t WHERE chain_id=$1 AND orphaned=false AND NOT EXISTS (
        SELECT 1 FROM protocol_accounts pa WHERE pa.chain_id=t.chain_id AND pa.address=t.trader_address AND pa.is_user_attributable=false
      )) AS traders,
      COALESCE((SELECT SUM((pf.metadata->>'creatorAmount')::numeric) FROM protocol_flows pf WHERE pf.chain_id=$1 AND pf.orphaned=false
        AND pf.category='fee_accrued' AND pf.asset_address=(SELECT address FROM protocol_accounts WHERE chain_id=$1 AND role='quote' LIMIT 1)),0) AS creator_fees_earned,
      COALESCE((SELECT SUM(amount) FROM protocol_flows pf WHERE pf.chain_id=$1 AND pf.orphaned=false
        AND pf.category='fee_claimed' AND pf.asset_address=(SELECT address FROM protocol_accounts WHERE chain_id=$1 AND role='quote' LIMIT 1)
        AND EXISTS (SELECT 1 FROM markets cm WHERE cm.chain_id=pf.chain_id AND cm.orphaned=false AND cm.creator_address=pf.to_address)),0) AS creator_fees_claimed,
      COALESCE((SELECT SUM(quote_spent) FROM buyback_executions WHERE chain_id=$1 AND orphaned=false),0) AS buyback_quote_spent,
      COALESCE((SELECT SUM(amount) FROM protocol_flows pf WHERE pf.chain_id=$1 AND pf.orphaned=false AND pf.category='pool_fee'
        AND pf.asset_address=(SELECT address FROM protocol_accounts WHERE chain_id=$1 AND role='quote' LIMIT 1)),0) AS pool_quote_fees
    FROM markets WHERE chain_id=$1`,
    [config.chainId],
  );
  const row = result.rows[0];
  return {
    markets: Number(row.markets || 0),
    graduated: Number(row.graduated || 0),
    grossQuoteVolume: String(row.gross_quote_volume || 0),
    walletCashTurnover: String(row.wallet_cash_turnover || 0),
    traders: Number(row.traders || 0),
    creatorFeesEarned: String(row.creator_fees_earned || 0),
    creatorFeesClaimed: String(row.creator_fees_claimed || 0),
    buybackQuoteSpent: String(row.buyback_quote_spent || 0),
    poolQuoteFees: String(row.pool_quote_fees || 0),
  };
}
