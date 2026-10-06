import { useMemo } from "react";
import { AppLink } from "./Navigation";
import { ArrowIcon } from "./ArrowIcon";
import { TokenAvatar } from "./TokenAvatar";
import { formatEthAmount, formatPercent } from "../lib/format.js";
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
            <TokenAvatar token={leader} className="king-avatar" />
            <span className="king-id"><strong>${leader.symbol}</strong><small>{leader.name}</small></span>
            <span className="king-value"><strong>{formatPercent(leader.progress)}</strong><small>curve sold</small></span>
          </span>
          <span className="king-stats">
            <span><small>On-chain price</small><strong>{leader.price == null ? "—" : `${formatEthAmount(leader.price)} WETH`}</strong></span>
            <span><small>On-chain market cap</small><strong>{leader.marketCap == null ? "—" : `${formatEthAmount(leader.marketCap)} WETH`}</strong></span>
          </span>
        </AppLink>
        {contenders.length > 0 && <aside className="contenders"><ol>{contenders.map((token, index) => <li key={token.address}>
          <AppLink route="market" params={{ address: token.address }} navigate={navigate}>
            <span className="contender-rank">{index + 2}</span><TokenAvatar token={token} index={index} />
            <span className="contender-symbol">{token.symbol}</span><span className="contender-value"><strong>{formatPercent(token.progress)}</strong></span><ArrowIcon />
          </AppLink>
        </li>)}</ol></aside>}
      </div>
    </section>
  );
}
