import { useMemo } from "react";
import { AppLink } from "./Navigation";
import { ArrowIcon } from "./ArrowIcon";
import { TokenAvatar } from "./TokenAvatar";
import {
  changeTone,
  formatChange,
  formatCompact,
  formatCount,
  formatUsd,
  formatUsdCompact,
} from "../lib/format.js";
import type { Navigate, Token } from "../types";

const CONTENDER_COUNT = 5;
const TOP_CAP_COUNT = 4;

function byProgress(a: Token, b: Token) {
  return (b.progress ?? -1) - (a.progress ?? -1);
}

function byCap(a: Token, b: Token) {
  return (b.marketCapUsd ?? -1) - (a.marketCapUsd ?? -1);
}

function CrownIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M2.5 6.5 5.5 9 10 3.5 14.5 9l3-2.5-1.5 9h-12z" />
    </svg>
  );
}

function Change({ value, suffix }: { value?: number | null; suffix?: string }) {
  return (
    <span className={`change ${changeTone(value)}`}>
      {formatChange(value)}
      {suffix && <small>{suffix}</small>}
    </span>
  );
}

// Normalised polyline over the price series. Flat or absent series render
// nothing rather than a misleading straight line at the baseline.
function Sparkline({ points }: { points?: number[] | null }) {
  if (!points || points.length < 2) return null;
  const low = Math.min(...points);
  const high = Math.max(...points);
  const span = high - low || 1;
  const path = points
    .map((point, index) => {
      const x = (index / (points.length - 1)) * 100;
      const y = 30 - ((point - low) / span) * 27 - 1.5;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
  return (
    <svg
      className="sparkline"
      viewBox="0 0 100 30"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <polygon className="sparkline-area" points={`0,30 ${path} 100,30`} />
      <polyline className="sparkline-line" points={path} />
    </svg>
  );
}

function KingOfTheHill({
  token,
  navigate,
}: {
  token: Token;
  navigate: Navigate;
}) {
  return (
    <AppLink
      className="king"
      route="market"
      params={{ address: token.address }}
      navigate={navigate}
    >
      <span className="king-head">
        <span className="king-title">
          <CrownIcon />
          King of the Hill
        </span>
        <span className="king-note">Closest to graduation</span>
      </span>

      <span className="king-headline">
        <TokenAvatar token={token} className="king-avatar" />
        <span className="king-id">
          <strong>${token.symbol}</strong>
          <small>{token.name}</small>
        </span>
        <span className="king-value">
          <strong>{formatUsdCompact(token.marketCapUsd)}</strong>
          <Change value={token.change24h} suffix="24h" />
          {token.peakMarketCapUsd != null && (
            <small>Peak {formatUsdCompact(token.peakMarketCapUsd)}</small>
          )}
        </span>
      </span>

      <span className="king-chart">
        <small>Recent price</small>
        <Sparkline points={token.priceHistory} />
      </span>

      <span className="king-stats">
        <span>
          <small>Price</small>
          <strong>{formatUsd(token.priceUsd)}</strong>
        </span>
        <span>
          <small>24h volume</small>
          <strong>{formatCompact(token.volume24h)} ETH</strong>
        </span>
        <span>
          <small>Holders</small>
          <strong>{formatCount(token.holders)}</strong>
        </span>
      </span>
    </AppLink>
  );
}

function Contenders({
  tokens,
  navigate,
}: {
  tokens: Token[];
  navigate: Navigate;
}) {
  return (
    <aside className="contenders" aria-labelledby="contenders-title">
      <header>
        <h3 id="contenders-title">Contenders</h3>
        <span>Closest to graduation</span>
      </header>
      {tokens.length ? (
        <ol>
          {tokens.map((token, index) => (
            <li key={token.address}>
              <AppLink
                route="market"
                params={{ address: token.address }}
                navigate={navigate}
              >
                <span className="contender-rank">{index + 1}</span>
                <TokenAvatar token={token} index={index} />
                <span className="contender-symbol">{token.symbol}</span>
                <span className="contender-value">
                  <strong>{formatUsdCompact(token.marketCapUsd)}</strong>
                  <Change value={token.change24h} suffix="24h" />
                </span>
                <ArrowIcon />
              </AppLink>
            </li>
          ))}
        </ol>
      ) : (
        <p className="featured-empty">No curves climbing yet.</p>
      )}
    </aside>
  );
}

function TopByMarketCap({
  tokens,
  navigate,
}: {
  tokens: Token[];
  navigate: Navigate;
}) {
  return (
    <>
      <h2 className="section-label">Top by market cap</h2>
      <ul className="top-caps">
        {tokens.map((token, index) => (
          <li key={token.address}>
            <AppLink
              route="market"
              params={{ address: token.address }}
              navigate={navigate}
            >
              <TokenAvatar token={token} index={index} />
              <span className="top-cap-id">
                <strong>${token.symbol}</strong>
                <small>{formatUsdCompact(token.marketCapUsd)}</small>
              </span>
              <span className="top-cap-value">
                <Change value={token.change24h} />
                <small>
                  {token.liquidity != null
                    ? `${formatCompact(token.liquidity)} ETH liq`
                    : `${formatCount(token.holders)} holders`}
                </small>
              </span>
            </AppLink>
          </li>
        ))}
      </ul>
    </>
  );
}

export function Featured({
  tokens,
  loading,
  navigate,
}: {
  tokens: Token[];
  loading: boolean;
  navigate: Navigate;
}) {
  const { king, contenders, topCaps } = useMemo(() => {
    const live = tokens.filter((token) => !token.graduated).sort(byProgress);
    const [leader, ...rest] = live;
    return {
      king: leader ?? [...tokens].sort(byCap)[0],
      contenders: rest.slice(0, CONTENDER_COUNT),
      topCaps: [...tokens].sort(byCap).slice(0, TOP_CAP_COUNT),
    };
  }, [tokens]);

  if (loading && !tokens.length) {
    return (
      <section className="featured">
        <h2 className="section-label">Featured</h2>
        <div className="featured-grid">
          <div className="king skeleton" />
          <div className="contenders skeleton" />
        </div>
      </section>
    );
  }

  if (!king) return null;

  return (
    <section className="featured" aria-label="Featured markets">
      <h2 className="section-label">Featured</h2>
      <div className="featured-grid">
        <KingOfTheHill token={king} navigate={navigate} />
        <Contenders tokens={contenders} navigate={navigate} />
      </div>
      {topCaps.length > 0 && (
        <TopByMarketCap tokens={topCaps} navigate={navigate} />
      )}
    </section>
  );
}
