import { TokenAvatar } from "./TokenAvatar";
import {
  formatAddress,
  formatEthAmount,
  formatPercent,
  formatRelativeTime,
} from "../lib/format.js";
import type { Token } from "../types";
import { activeExplorerUrl } from "../lib/web3";
import { UsdAmount } from "./UsdAmount";

const EXPLORER = `${activeExplorerUrl}/address/`;

function ExplorerLink({ value, label }: { value: string; label: string }) {
  return (
    <a
      className="market-address-link"
      href={`${EXPLORER}${value}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`View ${label} ${formatAddress(value)} on the explorer`}
    >
      <code>{formatAddress(value)}</code>
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M11 4h5v5M16 4l-7 7M15 12v3.5A1.5 1.5 0 0 1 13.5 17h-9A1.5 1.5 0 0 1 3 15.5v-9A1.5 1.5 0 0 1 4.5 5H8" />
      </svg>
    </a>
  );
}

function Socials({ token }: { token: Token }) {
  const links = [
    token.website && { href: token.website, label: "Website", icon: "globe" },
    token.xHandle && {
      href: `https://x.com/${token.xHandle.replace(/^@/, "")}`,
      label: "X",
      icon: "x",
    },
    token.telegram && {
      href: `https://t.me/${token.telegram.replace(/^@/, "")}`,
      label: "Telegram",
      icon: "telegram",
    },
  ].filter(Boolean) as { href: string; label: string; icon: string }[];

  if (!links.length) return null;

  return (
    <nav className="market-socials" aria-label="Token links">
      {links.map((link) => (
        <a
          key={link.label}
          className="market-social-link"
          href={link.href}
          target="_blank"
          rel="noreferrer"
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            {link.icon === "globe" && (
              <>
                <circle cx="10" cy="10" r="7" />
                <path d="M3 10h14M10 3c2 2.3 2 11.7 0 14M10 3c-2 2.3-2 11.7 0 14" />
              </>
            )}
            {link.icon === "x" && <path d="M4 4l12 12M16 4L4 16" />}
            {link.icon === "telegram" && <path d="M17 4 3 9.6l4 1.4 1.4 4.5L11 12l4 4 2-12Z" />}
          </svg>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function MarketHeader({ token }: { token: Token }) {
  const quoteSymbol = token.quoteSymbol ?? "WETH";
  const soldPercent = token.graduated ? 100 : Math.min(100, Math.max(0, token.progress ?? 0));
  return (
    <header className="market-header">
      <div className="market-header-left">
        <div className="market-header-content">
          <div className="market-token-summary">
            <TokenAvatar token={token} className="market-avatar" />
            <div className="market-identity">
              <div className="market-title-row">
                <h1>{token.name}</h1>
                <span className="market-ticker">${token.symbol}</span>
                <span className={`market-status ${token.graduated ? "graduated" : token.pending ? "pending" : "live"}`}>
                  {token.graduated ? "Graduated" : token.pending ? "Pending" : "live"}
                </span>
              </div>
              <div className="market-identity-row">
                <span className="market-pair">{token.symbol} / {quoteSymbol}</span>
                {token.feeBps != null && (
                  <span className="market-data-chip">Fee <strong>{(token.feeBps / 100).toFixed(2)}%</strong></span>
                )}
                {token.creatorTaxBps != null && token.creatorTaxBps > 0 && (
                  <span className="market-data-chip">Creator tax <strong>{(token.creatorTaxBps / 100).toFixed(2)}%</strong></span>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="market-header-details">
          <dl className="market-meta">
            <div>
              <dt>CA</dt>
              <dd><ExplorerLink value={token.address} label="contract" /></dd>
            </div>
            <div>
              <dt>Created by</dt>
              <dd><ExplorerLink value={token.creator} label="creator" /></dd>
            </div>
            <div>
              <dt>Launched</dt>
              <dd>{formatRelativeTime(token.createdAt)}</dd>
            </div>
          </dl>
          <Socials token={token} />
        </div>
      </div>
      <div className="market-headline-stats">
        <dl className="market-stat-price">
          <dt>Price</dt>
          <dd><UsdAmount weth={token.price} /></dd>
          <dd className="market-stat-note">{token.price == null ? "—" : formatEthAmount(token.price)} {quoteSymbol}</dd>
        </dl>
        <dl className="market-stat-summary">
          <div className="market-stat-cap">
            <dt>Market cap</dt>
            <dd><UsdAmount weth={token.marketCap} compact /></dd>
            <dd className="market-stat-note">Fully diluted</dd>
          </div>
          <div className="market-stat-progress">
            <dt>Bonding status</dt>
            <dd>{token.graduated ? "100%" : formatPercent(token.progress)}</dd>
            <dd className="market-stat-progress-track"><progress aria-label="Curve sold" value={soldPercent} max={100} /></dd>
            <dd className="market-stat-note">{token.graduated ? "Graduated" : "To graduation"}</dd>
          </div>
        </dl>
      </div>
    </header>
  );
}
