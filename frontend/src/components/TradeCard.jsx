export function TradeCard({
  token,
  address,
  amount,
  setAmount,
  trade,
  isPending,
}) {
  if (token.graduated) {
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
      </aside>
    );
  }
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
          <strong>ETH</strong>
        </span>
      </label>
      <p className="slippage-note">
        <span>◎</span> 3% slippage protection included
      </p>
      <div className="trade-actions">
        <button
          disabled={isPending || !address}
          onClick={() => trade("buy", token)}
        >
          Buy
        </button>
        <button
          className="sell-button"
          disabled={isPending || !address}
          onClick={() => trade("sell", token)}
        >
          Sell
        </button>
      </div>
      {!address && (
        <p className="connect-hint">Connect your wallet to trade.</p>
      )}
    </aside>
  );
}
