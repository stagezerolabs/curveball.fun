import { useMemo } from "react";
import { AppLink } from "./Navigation";
import { TokenAvatar } from "./TokenAvatar";
import { UsdAmount } from "./UsdAmount";
import { formatPercent } from "../lib/format.js";
import type { Navigate, Token } from "../types";

export function Featured({ tokens, loading, navigate }: { tokens: Token[]; loading: boolean; navigate: Navigate }) {
  const featured = useMemo(
    () => [...tokens].filter((token) => !token.graduated).sort((a, b) => (b.progress ?? -1) - (a.progress ?? -1)).slice(0, 5),
    [tokens],
  );
  if (loading && !tokens.length) return <section className="featured"><div className="king skeleton" /></section>;
  if (!featured.length) return null;
  const [leader, ...contenders] = featured;
  return (
    <section className="featured" aria-label="Closest to graduation">
      <h2 className="section-label">Closest to graduation</h2>
      <div className="featured-grid">
        <AppLink className="king" route="market" params={{ address: leader.address }} navigate={navigate}>
          <span className="king-headline">
            <span className="king-rank" aria-hidden="true">01</span>
            <TokenAvatar token={leader} className="king-avatar" />
            <span className="king-id"><strong>${leader.symbol}</strong><small>{leader.name}</small></span>
            <span className="king-value"><strong>{formatPercent(leader.progress)}</strong><small>curve sold</small></span>
          </span>
          <span className="king-stats">
            <span><small>Price</small><strong><UsdAmount weth={leader.price} /></strong></span>
            <span><small>Market cap</small><strong><UsdAmount weth={leader.marketCap} /></strong></span>
          </span>
        </AppLink>
        {contenders.length > 0 && <aside className="contenders"><ol>{contenders.map((token, index) => <li key={token.address}>
          <AppLink route="market" params={{ address: token.address }} navigate={navigate}>
            <span className="contender-rank">{String(index + 2).padStart(2, "0")}</span><TokenAvatar token={token} index={index} />
            <span className="contender-id"><strong>${token.symbol}</strong><small>{token.name}</small></span>
            <span className="contender-value"><strong>{formatPercent(token.progress)}</strong><small>sold</small></span>
          </AppLink>
        </li>)}</ol></aside>}
      </div>
    </section>
  );
}
