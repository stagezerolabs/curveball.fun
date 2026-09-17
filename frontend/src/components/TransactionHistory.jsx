import { useEffect, useState } from "react";
import { apiUrl } from "../lib/web3.js";
import { formatAddress, formatEthAmount } from "../lib/format.js";

const EXPLORER_TX_URL = "https://explorer.risechain.com/tx/";

export function TransactionHistory({ tokenAddress }) {
  const [trades, setTrades] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    fetch(`${apiUrl}/tokens/${tokenAddress}/transactions`)
      .then((response) => (response.ok ? response.json() : Promise.reject()))
      .then((rows) => {
        if (!cancelled) setTrades(rows);
      })
      .catch(() => {
        if (!cancelled) setError("Could not load recent trades.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [tokenAddress]);

  return (
    <div className="tx-history">
      <div className="tx-history-label">
        <span>Recent activity</span>
        {trades.length > 0 && <strong>{trades.length} trades</strong>}
      </div>
      {loading && <p className="tx-empty">Loading trades…</p>}
      {!loading && error && <p className="tx-empty">{error}</p>}
      {!loading && !error && trades.length === 0 && (
        <p className="tx-empty">No trades yet.</p>
      )}
      {!loading && !error && trades.length > 0 && (
        <ul className="tx-list">
          {trades.map((trade) => (
            <li key={trade.id} className={`tx-row tx-${trade.side}`}>
              <span className="tx-side">
                {trade.side === "buy" ? "Buy" : "Sell"}
              </span>
              <span className="tx-amounts">
                {formatEthAmount(Number(trade.amount) / 1e18)} tokens
                <small>{formatEthAmount(Number(trade.quote) / 1e18)} ETH</small>
              </span>
              <a
                className="tx-link"
                href={`${EXPLORER_TX_URL}${trade.tx}`}
                target="_blank"
                rel="noreferrer"
              >
                {formatAddress(trade.tx)}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
