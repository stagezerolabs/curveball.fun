import { useState } from "react";
import { TokenAvatar } from "./TokenAvatar";
import {
  changeTone,
  formatAddress,
  formatChange,
  formatRelativeTime,
  formatUsd,
  formatUsdCompact,
} from "../lib/format.js";
import type { Token } from "../types";
import { activeExplorerUrl } from "../lib/web3";

const EXPLORER = `${activeExplorerUrl}/address/`;

function CopyButton({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={copied ? `${label} copied` : `Copy ${label}`}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          setCopied(false);
        }
      }}
    >
      {copied ? (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <path d="m5 10.5 3.5 3.5L15 7" />
        </svg>
      ) : (
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="7" y="7" width="9" height="9" rx="2" />
          <path d="M13 4.5H6A1.5 1.5 0 0 0 4.5 6v7" />
        </svg>
      )}
    </button>
  );
}

function ExplorerLink({ value, label }: { value: string; label: string }) {
  return (
    <a
      className="icon-button"
      href={`${EXPLORER}${value}`}
      target="_blank"
      rel="noreferrer"
      aria-label={`View ${label} on the explorer`}
    >
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
    <span className="market-socials">
      {links.map((link) => (
        <a
          key={link.label}
          className="icon-button"
          href={link.href}
          target="_blank"
          rel="noreferrer"
          aria-label={link.label}
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
        </a>
      ))}
    </span>
  );
}

export function MarketHeader({ token }: { token: Token }) {
  return (
    <header className="market-header">
      <div className="market-header-top">
        <TokenAvatar token={token} className="market-avatar" />
        <div className="market-identity">
          <h1>{token.name}</h1>
          <div className="market-identity-row">
            <span className="market-ticker">${token.symbol}</span>
            <span
              className={`market-status ${token.graduated ? "graduated" : "live"}`}
            >
              <i aria-hidden="true" />
              {token.graduated ? "Graduated" : token.pending ? "Graduation pending" : "On the curve"}
            </span>
            <Socials token={token} />
          </div>
        </div>
        <div className="market-headline-value">
          <strong>{formatUsdCompact(token.marketCapUsd)}</strong>
          <span>
            <span className={`change ${changeTone(token.change24h)}`}>
              {formatChange(token.change24h)} <small>24h</small>
            </span>
            {token.quoteSymbol && (
              <span className="market-quote-chip">{token.quoteSymbol}</span>
            )}
          </span>
        </div>
      </div>

      <dl className="market-meta">
        <div>
          <dt>Contract</dt>
          <dd>
            <code>{formatAddress(token.address)}</code>
            <CopyButton value={token.address} label="contract address" />
            <ExplorerLink value={token.address} label="contract" />
          </dd>
        </div>
        <div>
          <dt>Creator</dt>
          <dd>
            <code>{formatAddress(token.creator)}</code>
            <CopyButton value={token.creator} label="creator address" />
            <ExplorerLink value={token.creator} label="creator" />
          </dd>
        </div>
        <div>
          <dt>Launched</dt>
          <dd>{formatRelativeTime(token.createdAt)}</dd>
        </div>
        <div>
          <dt>Price</dt>
          <dd>
            {formatUsd(token.priceUsd)}
            {token.usdStale && (
              <small
                className="usd-stale"
                title="Using the last known ETH/USD rate"
              >
                stale rate
              </small>
            )}
          </dd>
        </div>
      </dl>
    </header>
  );
}
