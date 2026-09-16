import { ArrowIcon } from "../components/ArrowIcon.jsx";
import { CurveVisual } from "../components/CurveVisual.jsx";
import { AppLink } from "../components/Navigation.jsx";

export function HomePage({ navigate }) {
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
      <section className="ticker" aria-label="Platform highlights">
        <div className="wrap ticker-inner">
          <p>
            <strong>100%</strong>
            <span>on-chain pricing</span>
          </p>
          <p>
            <strong>3%</strong>
            <span>slippage protection</span>
          </p>
          <p>
            <strong>0</strong>
            <span>private allocations</span>
          </p>
          <p>
            <strong>∞</strong>
            <span>possible curveballs</span>
          </p>
        </div>
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
