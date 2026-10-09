import { useState } from "react";
import { Badge } from "@radix-ui/themes";
import { TokenAvatar } from "./TokenAvatar";
import { AppLink } from "./Navigation";
import {
  formatAddress,
  formatEthAmount,
  formatPercent,
  formatRelativeTime,
} from "../lib/format.js";
import type { Navigate, Token } from "../types";
import { activeExplorerUrl } from "../lib/web3";
import { UsdAmount } from "./UsdAmount";

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

export function MarketHeader({ token, navigate }: { token: Token; navigate: Navigate }) {
  const quoteSymbol = token.quoteSymbol ?? "WETH";
  const progress = token.graduated ? 100 : Math.min(100, Math.max(0, token.progress ?? 0));
  return (
    <header className="market-header">
      <div className="market-breadcrumb">
        <AppLink route="markets" navigate={navigate}>Explore</AppLink>
        <span aria-hidden="true">/</span>
        <span>{token.name}</span>
      </div>
      <div className="market-header-content">
        <div className="market-token-summary">
          <TokenAvatar token={token} className="market-avatar" />
          <div className="market-identity">
            <div className="market-title-row">
              <h1>{token.name}</h1>
              <span className="market-ticker">${token.symbol}</span>
            </div>
            <div className="market-identity-row">
              <span className="market-pair">{token.symbol} / {quoteSymbol}</span>
              <Badge color={token.graduated ? "orange" : "lime"} variant="soft" className={`market-status ${token.graduated ? "graduated" : "live"}`}>
                {token.graduated ? "Graduated" : token.pending ? "Pending" : "Live"}
              </Badge>
              {token.feeBps != null && (
                <span className="market-data-chip">Fee {(token.feeBps / 100).toFixed(2)}%</span>
              )}
              {token.creatorTaxBps != null && token.creatorTaxBps > 0 && (
                <span className="market-data-chip">Creator tax {(token.creatorTaxBps / 100).toFixed(2)}%</span>
              )}
            </div>

            <div className="market-bonding" aria-label={`Bonding status ${formatPercent(progress)}`}>
              <div className="market-bonding-label"><span>Bonding status</span><strong>{formatPercent(progress)}</strong></div>
              <span className="market-bonding-track"><span style={{ width: `${progress}%` }} /></span>
            </div>

            <dl className="market-meta">
              <div>
                <dt>CA</dt>
                <dd>
                  <code>{formatAddress(token.address)}</code>
                  <CopyButton value={token.address} label="contract address" />
                  <ExplorerLink value={token.address} label="contract" />
                </dd>
              </div>
              <div>
                <dt>Created by</dt>
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
            </dl>

            <Socials token={token} />
          </div>
        </div>
      </div>

      <dl className="market-headline-stats">
        <div>
          <dt>Price</dt>
          <dd><UsdAmount weth={token.price} /></dd>
          <small>{token.price == null ? "—" : formatEthAmount(token.price)} {quoteSymbol}</small>
        </div>
        <div>
          <dt>Market cap</dt>
          <dd><UsdAmount weth={token.marketCap} compact /></dd>
          <small>Fully diluted</small>
        </div>
        <div>
          <dt>Bonding status</dt>
          <dd>{token.graduated ? "100%" : formatPercent(token.progress)}</dd>
          <small>{token.graduated ? "Graduated" : "To graduation"}</small>
        </div>
      </dl>
    </header>
  );
}
