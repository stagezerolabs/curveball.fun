import { AppLink } from "../components/Navigation.jsx";
import { TradeCard } from "../components/TradeCard.jsx";

export function MarketPage({
  token,
  loading,
  error,
  address,
  amount,
  setAmount,
  trade,
  isPending,
  navigate,
}) {
  if (loading) return <main className="page-status wrap">Loading market…</main>;
  if (!token)
    return (
      <main className="page-status wrap">
        <span className="empty-orbit" />
        <h1>Market not found</h1>
        <p>This curve may not exist, or the API is unavailable.</p>
        <AppLink className="primary-button" route="markets" navigate={navigate}>
          Back to markets
        </AppLink>
      </main>
    );
  return (
    <main className="page-main">
      <section className="market-detail-heading wrap">
        <AppLink className="back-link" route="markets" navigate={navigate}>
          ← All markets
        </AppLink>
        <div className="market-title-row">
          <div className="token-avatar detail-avatar">
            {(token.symbol || "?").slice(0, 1)}
          </div>
          <div>
            <span
              className={`status-pill ${token.graduated ? "graduated" : "live"}`}
            >
              <i /> {token.graduated ? "Graduated" : "Curve live"}
            </span>
            <h1>
              {token.name} <small>${token.symbol}</small>
            </h1>
          </div>
        </div>
        <p className="market-address">
          Contract <span>{token.address}</span>
        </p>
      </section>
      <section className="market-detail-grid wrap">
        <div className="market-chart-card">
          <div className="visual-label">
            <span>Bonding curve</span>
            <strong>{token.graduated ? "Complete" : "Live"}</strong>
          </div>
          <svg viewBox="0 0 760 360" aria-label="Bonding curve chart">
            <path
              className="detail-grid"
              d="M30 300H730M30 220H730M30 140H730M30 60H730"
            />
            <path
              className="detail-area"
              d="M30 310C220 310 330 290 430 230S600 90 730 45V330H30Z"
            />
            <path
              className="curve-line"
              d="M30 310C220 310 330 290 430 230S600 90 730 45"
            />
          </svg>
          <div className="market-facts">
            <p>
              <span>Network</span>
              <strong>RISE</strong>
            </p>
            <p>
              <span>Pricing</span>
              <strong>Bonding curve</strong>
            </p>
            <p>
              <span>Protection</span>
              <strong>3% slippage</strong>
            </p>
          </div>
        </div>
        <TradeCard
          token={token}
          address={address}
          amount={amount}
          setAmount={setAmount}
          trade={trade}
          isPending={isPending}
        />
      </section>
      {error && (
        <p className="notice floating-notice wrap" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
