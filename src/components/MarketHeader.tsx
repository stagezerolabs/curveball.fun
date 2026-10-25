import { TokenAvatar } from "./TokenAvatar";
import { formatPercent } from "../lib/format.js";
import type { Token } from "../types";
import { getMarketDisplayStatus } from "../lib/marketState";
import { UsdAmount } from "./UsdAmount";
import type { MarketPriceChange } from "../lib/marketChart";
import type { MarketPreviewStats } from "../lib/marketPreviewStats";
import { formatMarketAge, formatMarketCount } from "../lib/marketDisplay";

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
    <nav
      className="market-socials market-header-details"
      aria-label="Token links"
    >
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
            {link.icon === "telegram" && (
              <path d="M17 4 3 9.6l4 1.4 1.4 4.5L11 12l4 4 2-12Z" />
            )}
          </svg>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

export function MarketHeader({
  token,
  marketCapChange,
  activityStats,
}: {
  token: Token;
  marketCapChange?: MarketPriceChange | null;
  activityStats?: MarketPreviewStats;
}) {
  const quoteSymbol = token.quoteSymbol ?? "WETH";
  const soldPercent = token.graduated
    ? 100
    : Math.min(100, Math.max(0, token.progress ?? 0));
  const status = getMarketDisplayStatus(token);
  const direction =
    marketCapChange?.percent == null
      ? "unavailable"
      : marketCapChange.percent > 0
        ? "up"
        : marketCapChange.percent < 0
          ? "down"
          : "flat";
  const magnitude = Math.abs(marketCapChange?.percent ?? 0);
  const formattedChange =
    magnitude > 0 && magnitude < 0.01
      ? "<0.01"
      : magnitude.toLocaleString("en-US", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        });
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
                <span className={`market-status ${status.kind}`}>
                  {status.label}
                </span>
              </div>
              <div className="market-identity-row">
                <span className="market-pair">
                  {token.symbol} / {quoteSymbol}
                </span>
                {token.feeBps != null && (
                  <span className="market-data-chip">
                    Fee <strong>{(token.feeBps / 100).toFixed(2)}%</strong>
                  </span>
                )}
                {token.creatorTaxBps != null && token.creatorTaxBps > 0 && (
                  <span className="market-data-chip">
                    Creator tax{" "}
                    <strong>{(token.creatorTaxBps / 100).toFixed(2)}%</strong>
                  </span>
                )}
              </div>
            </div>
          </div>
        </div>

        <Socials token={token} />
      </div>
      <div className="market-headline-stats">
        <dl className="market-stat-summary">
          <div className="market-stat-cap">
            <dt>Market cap</dt>
            <dd>
              <UsdAmount weth={token.marketCap} compact />
            </dd>
            <dd
              className={`market-cap-change ${direction}`}
              aria-label={
                marketCapChange
                  ? `Market cap ${direction} ${formattedChange} percent ${marketCapChange.period === "24h" ? "in the last 24 hours" : "since the first trade"}`
                  : "Market cap change unavailable until trade history loads"
              }
            >
              <strong aria-hidden="true">
                {direction === "up"
                  ? "↗ "
                  : direction === "down"
                    ? "↘ "
                    : direction === "flat"
                      ? "→ "
                      : ""}
                {marketCapChange ? `${formattedChange}%` : "—"}
              </strong>
              <span>
                {marketCapChange?.period === "since first trade"
                  ? "since launch"
                  : "24H"}
              </span>
            </dd>
          </div>
          <div className="market-stat-progress">
            <dt>Bonding status</dt>
            <dd>{token.graduated ? "100%" : formatPercent(token.progress)}</dd>
            <dd className="market-stat-progress-track">
              <progress aria-label="Curve sold" value={soldPercent} max={100} />
            </dd>
            <dd className="market-stat-note">
              {status.kind === "live" ? "To graduation" : status.label}
            </dd>
          </div>
        </dl>
      </div>
      <dl className="market-detail-activity" aria-label="Market activity">
        <div>
          <dt>1H</dt>
          <dd className={changeClass(activityStats?.change1h)}>
            {formatChange(activityStats?.change1h)}
          </dd>
        </div>
        <div>
          <dt>6H</dt>
          <dd className={changeClass(activityStats?.change6h)}>
            {formatChange(activityStats?.change6h)}
          </dd>
        </div>
        <div>
          <dt>24H</dt>
          <dd className={changeClass(activityStats?.change24h)}>
            {formatChange(activityStats?.change24h)}
          </dd>
        </div>
        <div>
          <dt>ATH</dt>
          <dd>
            <UsdAmount weth={activityStats?.athMarketCap} compact />
          </dd>
        </div>
        <div>
          <dt>24HR VOL</dt>
          <dd>
            <UsdAmount weth={activityStats?.volume24h} compact />
          </dd>
        </div>
        <div>
          <dt>AGE</dt>
          <dd>{formatMarketAge(token.createdAt)}</dd>
        </div>
        <div>
          <dt>TXNS</dt>
          <dd>{formatMarketCount(activityStats?.transactions)}</dd>
        </div>
        <div>
          <dt>TRADERS</dt>
          <dd>{formatMarketCount(activityStats?.traders)}</dd>
        </div>
      </dl>
    </header>
  );
}

function formatChange(value: number | null | undefined) {
  return value == null ? "—" : `${value > 0 ? "+" : ""}${value.toFixed(1)}%`;
}

function changeClass(value: number | null | undefined) {
  return value == null || value === 0
    ? ""
    : value > 0
      ? "positive"
      : "negative";
}
