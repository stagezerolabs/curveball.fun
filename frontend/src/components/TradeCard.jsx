import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useStore } from "../app/useStore.js";
import { formatAddress, formatEthAmount } from "../lib/format.js";
import { ArrowIcon } from "./ArrowIcon.jsx";

const ICARUS_URL = "https://icarus.finance";

export function TradeCard({ token, address }) {
  const {
    amount,
    setAmount,
    side,
    setSide,
    trade,
    isPending,
    tradeMessage,
    quotePreview,
    quoting,
    fetchQuote,
  } = useStore();

  useEffect(() => {
    if (token.graduated) return undefined;
    const timeout = setTimeout(() => fetchQuote(token), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, token.address, token.graduated]);

  if (token.graduated) {
    return <GraduatedCard token={token} />;
  }

  const unit = side === "buy" ? "ETH" : token.symbol;
  const previewLabel =
    side === "buy" ? `${token.symbol}` : "ETH";
  const previewValue = quotePreview !== null ? formatEther(quotePreview) : null;

  return (
    <aside className="trade-card market-trade-card">
      <div className="trade-card-head">
        <div>
          <span>Trade on the curve</span>
          <h3>
            {token.name} <small>${token.symbol}</small>
          </h3>
        </div>
      </div>
      <div className="side-toggle" role="tablist" aria-label="Buy or sell">
        <button
          type="button"
          role="tab"
          aria-selected={side === "buy"}
          className={side === "buy" ? "active" : ""}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={side === "sell"}
          className={side === "sell" ? "active" : ""}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
      </div>
      <label className="amount-field">
        <span>Amount</span>
        <span className="input-shell">
          <input
            type="number"
            min="0"
            step="any"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
          <strong>{unit}</strong>
        </span>
      </label>
      <p className="quote-preview" aria-live="polite">
        {quoting && "Fetching quote…"}
        {!quoting && previewValue !== null && (
          <>
            You receive <strong>~{formatEthAmount(Number(previewValue))} {previewLabel}</strong>
          </>
        )}
        {!quoting && previewValue === null && "Enter an amount to see a quote."}
      </p>
      <p className="slippage-note">
        <span>◎</span> 3% slippage protection included
      </p>
      <div className="trade-actions">
        <button
          className={side === "sell" ? "sell-button" : ""}
          disabled={isPending || !address}
          onClick={() => trade(side, token)}
        >
          {isPending ? "Pending…" : side === "buy" ? "Buy" : "Sell"}
        </button>
      </div>
      {!address && (
        <p className="connect-hint">Connect your wallet to trade.</p>
      )}
      {tradeMessage && !isPending && (
        <p className="trade-success" role="status">
          {tradeMessage}
        </p>
      )}
    </aside>
  );
}

function GraduatedCard({ token }) {
  const [copied, setCopied] = useState(false);

  const copyPool = async () => {
    try {
      await navigator.clipboard.writeText(token.pool);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };

  return (
    <aside className="trade-card market-trade-card">
      <div className="trade-card-head">
        <div>
          <span>Market status</span>
          <h3>Graduated</h3>
        </div>
      </div>
      <div className="graduated-message">
        <span aria-hidden="true">↗</span>
        <strong>This token has graduated.</strong>
        <p>Its curve is complete and liquidity has moved to Icarus.</p>
      </div>
      {token.pool && (
        <div className="pool-address">
          <span>Pool</span>
          <code>{formatAddress(token.pool)}</code>
          <button type="button" onClick={copyPool}>
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      )}
      <a
        className="primary-button icarus-link"
        href={`${ICARUS_URL}/${token.address}`}
        target="_blank"
        rel="noreferrer"
      >
        Trade on Icarus <ArrowIcon />
      </a>
    </aside>
  );
}
