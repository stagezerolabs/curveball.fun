import { useStore } from "../app/useStore.js";
import { AppLink } from "../components/Navigation.jsx";
import { TokenAvatar } from "../components/TokenAvatar.jsx";
import { TradeCard } from "../components/TradeCard.jsx";
import { TransactionHistory } from "../components/TransactionHistory.jsx";
import { useAccount } from "wagmi";
import { formatEthAmount, formatPercent } from "../lib/format.js";

export function MarketPage({
  token,
  navigate,
}) {
  const { loading, marketError, actionError } = useStore();
  const { address } = useAccount();
  const error = actionError || marketError;

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
          <TokenAvatar token={token} className="detail-avatar" />
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
              <span>Progress</span>
              <strong>
                {token.graduated ? "100%" : formatPercent(token.progress)}
              </strong>
            </p>
            <p>
              <span>Price</span>
              <strong>
                {token.graduated ? "On Icarus" : `${formatEthAmount(token.price)} ETH`}
              </strong>
            </p>
          </div>
        </div>
        <TradeCard
          token={token}
          address={address}
        />
      </section>
      <section className="market-history wrap">
        <TransactionHistory tokenAddress={token.address} />
      </section>
      {error && (
        <p className="notice floating-notice wrap" role="alert">
          {error}
        </p>
      )}
    </main>
  );
}
