import type { ReactNode } from "react";
import { ArrowIcon } from "../components/ArrowIcon";
import { AppLink } from "../components/Navigation";
import type { Navigate } from "../types";

function ActionLink({
  route,
  navigate,
  children,
}: {
  route: string;
  navigate: Navigate;
  children: ReactNode;
}) {
  return (
    <AppLink className="primary-button" route={route} navigate={navigate}>
      {children} <ArrowIcon />
    </AppLink>
  );
}

export function LandingPage({ navigate }: { navigate: Navigate }) {
  return (
    <main className="landing-page">
      <section className="landing-hero wrap">
        <div className="landing-hero-copy">
          <div className="eyebrow">
            <span /> Built on RISE
          </div>
          <h1>
            A fairer way to find the next <em>curveball.</em>
          </h1>
          <p className="landing-lede">
            Launch instantly. Trade on a transparent bonding curve. Graduate
            into Icarus liquidity when the market is ready.
          </p>
          <div className="landing-actions">
            <ActionLink route="home" navigate={navigate}>
              Explore markets
            </ActionLink>
            <AppLink className="text-link" route="launch" navigate={navigate}>
              Launch your token
            </AppLink>
          </div>
        </div>

        <div
          className="curve-visual"
          aria-label="Illustration of a bonding curve"
        >
          <div className="visual-label">
            <span>Bonding curve</span>
            <strong>Curve model</strong>
          </div>
          <svg viewBox="0 0 560 410" role="img" aria-hidden="true">
            <defs>
              <linearGradient id="landing-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fe5d26" stopOpacity=".34" />
                <stop offset="1" stopColor="#fe5d26" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              className="grid-line"
              d="M20 330H540M20 250H540M20 170H540M20 90H540"
            />
            <path
              className="curve-area"
              d="M20 344C150 344 238 318 307 267S420 113 540 55V370H20Z"
            />
            <path
              className="curve-line"
              d="M20 344C150 344 238 318 307 267S420 113 540 55"
            />
            <circle cx="400" cy="165" r="9" />
            <circle className="curve-pulse" cx="400" cy="165" r="18" />
          </svg>
        </div>
      </section>

      <section className="landing-ticker" aria-label="Platform stats">
        <div className="wrap landing-ticker-inner">
          <p>
            <strong>—</strong>
            <span>markets launched</span>
          </p>
          <p>
            <strong>—</strong>
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

      <section className="landing-cta wrap">
        <div>
          <div className="eyebrow">
            <span /> Your move
          </div>
          <h2>Ready to bend the curve?</h2>
        </div>
        <div className="landing-cta-actions">
          <ActionLink route="launch" navigate={navigate}>
            Launch a token
          </ActionLink>
          <AppLink className="text-link" route="home" navigate={navigate}>
            Browse live markets
          </AppLink>
        </div>
      </section>
    </main>
  );
}
