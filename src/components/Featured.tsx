import { useMemo } from "react";
import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import { formatPercent } from "../lib/format.js";
import type { Navigate, Token } from "../types";

export function Featured({
  tokens,
  loading,
  navigate,
}: {
  tokens: Token[];
  loading: boolean;
  navigate: Navigate;
}) {
  const featured = useMemo(
    () =>
      [...tokens]
        .filter((token) => !token.graduated)
        .sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1))
        .slice(0, 3),
    [tokens],
  );
  if (loading && !tokens.length)
    return (
      <section className="featured" aria-label="Closest to graduation">
        <h2 className="section-label">Closest to graduation</h2>
        <div className="featured-leader skeleton" aria-busy="true" />
      </section>
    );
  if (!featured.length) return null;
  const [leader, ...contenders] = featured;
  return (
    <section className="featured" aria-label="Closest to graduation">
      <h2 className="section-label">Closest to graduation</h2>
      <div className="featured-grid">
        <AppLink
          className="featured-leader"
          route="market"
          params={{ address: leader.address }}
          navigate={navigate}
        >
          <span className="featured-leader-content">
            <span className="featured-leader-identity">
              <TokenAvatar token={leader} />
              <span className="featured-leader-name">
                <strong>${leader.symbol}</strong>
                <small>{leader.name}</small>
              </span>
            </span>
            <span className="featured-leader-cap">
              <small>MCAP</small>
              <strong>
                <UsdAmount weth={leader.marketCap} />
              </strong>
            </span>
            <span className="featured-leader-value">
              <strong>{formatPercent(leader.progress)}</strong>
              <small>curve sold</small>
            </span>
          </span>
        </AppLink>
        {contenders.length > 0 && (
          <div className="featured-contenders">
            {contenders.map((token, index) => (
              <AppLink
                className={`featured-contender ${index === 0 ? "featured-contender-next" : "featured-contender-last"}`}
                route="market"
                params={{ address: token.address }}
                navigate={navigate}
                key={token.address}
              >
                <TokenAvatar token={token} index={index + 1} />
                <span className="featured-contender-name">
                  <strong>${token.symbol}</strong>
                  <small>{token.name}</small>
                </span>
                <span className="featured-contender-value">
                  <strong>{formatPercent(token.progress)}</strong>
                  <small>sold</small>
                </span>
              </AppLink>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
