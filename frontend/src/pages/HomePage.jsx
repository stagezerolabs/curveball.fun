import { useMemo } from "react";
import { ArrowIcon } from "../components/ArrowIcon.jsx";
import { CurveVisual } from "../components/CurveVisual.jsx";
import { AppLink } from "../components/Navigation.jsx";
import { MarketList } from "../components/MarketList.jsx";
import { useStore } from "../app/useStore.js";

export function HomePage({ navigate }) {
  const { tokens, loading } = useStore();
  const graduatedCount = useMemo(
    () => tokens.filter((token) => token.graduated).length,
    [tokens],
  );
  const newest = useMemo(
    () =>
      [...tokens]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, 5),
    [tokens],
  );

  return (
    <main>
      <section className="hero wrap">
        <div className="hero-copy">
          <div className="eyebrow">
            <span /> Built on RISE
          </div>
          <h1>
            A fairer way to find the next <em>curveball.</em>
          </h1>
          <p className="hero-lede">
            Launch instantly. Trade on a transparent bonding curve. Graduate
            into Icarus liquidity when the market is ready.
          </p>
          <div className="hero-actions">
            <AppLink
              className="primary-button"
              route="markets"
              navigate={navigate}
            >
              Explore markets <ArrowIcon />
            </AppLink>
            <AppLink className="text-link" route="launch" navigate={navigate}>
              Launch your token
            </AppLink>
          </div>
        </div>
        <CurveVisual />
      </section>
      <section className="ticker" aria-label="Platform stats">
        <div className="wrap ticker-inner">
          <p>
            <strong>{tokens.length}</strong>
            <span>markets launched</span>
          </p>
          <p>
            <strong>{graduatedCount}</strong>
            <span>graduated to Icarus</span>
          </p>
          <p>
            <strong>3%</strong>
            <span>slippage protection</span>
          </p>
          <p>
            <strong>0</strong>
            <span>private allocations</span>
          </p>
        </div>
      </section>
      <section className="markets-section wrap">
        <div className="section-heading">
          <div>
            <p>Fresh off the curve</p>
            <h2>Newest launches</h2>
          </div>
          <AppLink className="text-link" route="markets" navigate={navigate}>
            View all markets
          </AppLink>
        </div>
        <MarketList tokens={newest} loading={loading} navigate={navigate} />
      </section>
      <section className="home-cta wrap">
        <div>
          <div className="eyebrow">
            <span /> Your move
          </div>
          <h2>Ready to bend the curve?</h2>
        </div>
        <div className="home-cta-actions">
          <AppLink
            className="primary-button"
            route="launch"
            navigate={navigate}
          >
            Launch a token <ArrowIcon />
          </AppLink>
          <AppLink className="text-link" route="markets" navigate={navigate}>
            Browse live markets
          </AppLink>
        </div>
      </section>
    </main>
  );
}
