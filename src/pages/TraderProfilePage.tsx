import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { AppLink } from "../components/Navigation";
import { UsdAmount } from "../components/UsdAmount";
import { TraderProfileSkeleton } from "../components/TraderProfileSkeleton";
import {
  formatAddress,
  formatEthAmount,
  formatRelativeTime,
} from "../lib/format.js";
import { activeExplorerUrl } from "../lib/web3";
import type { Navigate, Token } from "../types";
import { FollowButton } from "../social/FollowButton";
import { TraderAvatar } from "../social/TraderAvatar";
import { useTraderName } from "../social/useTraderName";
import { fetchCreatorMarkets } from "../markets/api";
import { socialApi, socialApiConfigured } from "../social/api";
import { useSocialAuth } from "../social/useSocialAuth";
import { calculateHoldingsChange24h } from "../social/portfolioChange";

export type ProfileTab = "holdings" | "activity" | "launches";

function wethAmount(wei: string) {
  return Number(formatEther(BigInt(wei || "0")));
}

function EmptyState({
  title,
  children,
  action,
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="profile-empty-state">
      <strong>{title}</strong>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

/** Tokens this trader launched, for anyone reading their profile. */
function CreatorMarketList({
  tokens,
  navigate,
}: {
  tokens: Token[];
  navigate: Navigate;
}) {
  return (
    <ul className="profile-list">
      {tokens.map((token) => (
        <li key={token.address}>
          <AppLink
            className="profile-row"
            route="market"
            params={{ address: token.address }}
            navigate={navigate}
          >
            <span className="profile-row-main">
              <strong>{token.name}</strong>
              <small>
                ${token.symbol} · launched {formatRelativeTime(token.createdAt)}
              </small>
            </span>
            <span className="profile-row-value">
              <strong><UsdAmount weth={token.marketCap} compact /></strong>
              <small>
                {token.graduated
                  ? "Graduated"
                  : `${Math.round(token.progress ?? 0)}% sold`}
              </small>
            </span>
            <span className="profile-row-chevron" aria-hidden="true">
              ›
            </span>
          </AppLink>
        </li>
      ))}
    </ul>
  );
}

export function TraderProfilePage({
  address: routeAddress,
  navigate,
  launches = null,
  initialTab = "holdings",
}: {
  address: string;
  navigate: Navigate;
  launches?: ReactNode;
  initialTab?: ProfileTab;
}) {
  const validAddress = isAddress(routeAddress);
  const traderAddress = validAddress ? getAddress(routeAddress) : null;
  const { address: walletAddress } = useAccount();
  const { ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<ProfileTab>(initialTab);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = Boolean(
    traderAddress &&
    walletAddress?.toLowerCase() === traderAddress.toLowerCase(),
  );
  const profile = useQuery({
    queryKey: [
      "social",
      "profile",
      traderAddress?.toLowerCase(),
      walletAddress?.toLowerCase(),
    ],
    queryFn: () => socialApi.profile(traderAddress!),
    enabled: socialApiConfigured && Boolean(traderAddress),
  });
  const trades = useQuery({
    queryKey: ["social", "profile-trades", traderAddress?.toLowerCase()],
    queryFn: () => socialApi.feed("global", undefined, traderAddress!),
    enabled: socialApiConfigured && Boolean(traderAddress),
  });
  const rns = useTraderName(traderAddress);
  const creatorMarkets = useQuery({
    queryKey: ["markets", "creator", traderAddress?.toLowerCase()],
    queryFn: ({ signal }) => fetchCreatorMarkets(traderAddress!, signal),
    enabled: socialApiConfigured && !launches && Boolean(traderAddress),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => setTab(initialTab), [traderAddress, initialTab]);

  if (!traderAddress)
    return (
      <main className="page-status wrap">
        <h1>Trader not found</h1>
        <p>This wallet address is invalid.</p>
        <AppLink className="primary-button" route="social" navigate={navigate}>
          Back to Pulse
        </AppLink>
      </main>
    );
  if (!socialApiConfigured)
    return (
      <main className="page-status wrap">
        <h1>Social service is not connected</h1>
        <p>Configure the VPS API before loading trader profiles.</p>
        <AppLink className="primary-button" route="social" navigate={navigate}>
          Back to Pulse
        </AppLink>
      </main>
    );
  if (profile.isLoading) return <TraderProfileSkeleton />;
  if (profile.isError || !profile.data)
    return (
      <main className="page-status wrap">
        <h1>Profile unavailable</h1>
        <p>
          {profile.error instanceof Error
            ? profile.error.message
            : "Try again shortly."}
        </p>
        <button
          className="primary-button"
          type="button"
          onClick={() => void profile.refetch()}
        >
          Retry
        </button>
      </main>
    );

  const data = profile.data;
  const name = rns.label;
  const positions = data.positions
    .map((position) => {
      const balance = wethAmount(position.balance_wei);
      const rate =
        Number(position.virtual_token_after) > 0
          ? Number(position.virtual_quote_after) /
            Number(position.virtual_token_after)
          : 0;
      return {
        position,
        balance,
        value: balance * rate,
      };
    })
    .sort((a, b) => b.value - a.value);
  const portfolioValue = positions.reduce(
    (total, item) => total + item.value,
    0,
  );
  const holdingsChange24h = calculateHoldingsChange24h(
    positions.map(({ position, value }) => ({
      valueWeth: value,
      change24hBps: position.change_24h_bps,
    })),
  );
  const displayedChange24h = holdingsChange24h === null
    ? null
    : Number(holdingsChange24h.toFixed(1));

  async function reportProfile() {
    try {
      await ensureAuthenticated();
      await socialApi.report(
        traderAddress as Address,
        reportReason,
        reportDetails,
      );
      setNotice("Report submitted for review.");
      setReporting(false);
      setReportDetails("");
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not submit the report.",
      );
    }
  }

  async function toggleBlock() {
    try {
      await ensureAuthenticated();
      await socialApi.block(traderAddress as Address, !data.isBlocked);
      setNotice(
        data.isBlocked
          ? "Trader unblocked."
          : "Trader blocked and removed from your feeds.",
      );
      await queryClient.invalidateQueries({ queryKey: ["social"] });
    } catch (error) {
      setNotice(
        error instanceof Error ? error.message : "Could not update this block.",
      );
    }
  }

  return (
    <main className="trader-profile-page wrap">
      {notice ? (
        <p className="notice notice-dismissible" role="status">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice("")}
            aria-label="Dismiss message"
          >
            ×
          </button>
        </p>
      ) : null}

      <div className="profile-top">
        <header className="profile-hero" aria-labelledby="trader-profile-name">
          <TraderAvatar
            className="profile-hero-avatar"
            address={traderAddress}
            name={name}
          />
          <div className="profile-hero-copy">
            <h1 id="trader-profile-name">{name}</h1>
            <p className="profile-hero-meta">
              <a
                href={`${activeExplorerUrl}/address/${traderAddress}`}
                target="_blank"
                rel="noreferrer"
                title={traderAddress}
              >
                {formatAddress(traderAddress)} <span aria-hidden="true">↗</span>
              </a>
            </p>
            <p className="profile-hero-social">
              <span>
                <strong>{data.followers}</strong> followers
              </span>
              <span>
                <strong>{data.following}</strong> following
              </span>
            </p>
            {!isOwner ? (
              <div className="profile-hero-actions">
                <FollowButton
                  trader={traderAddress}
                  following={data.isFollowed}
                  onError={setNotice}
                />
                <Menu.Root>
                  <Menu.Trigger
                    className="profile-icon-button"
                    aria-label="More actions"
                    title="More actions"
                  >
                    <span aria-hidden="true">⋯</span>
                  </Menu.Trigger>
                  <Menu.Portal>
                    <Menu.Positioner
                      className="profile-menu-positioner"
                      sideOffset={8}
                      align="start"
                    >
                      <Menu.Popup className="profile-menu">
                        <Menu.Item
                          className="profile-menu-item"
                          onClick={() => void toggleBlock()}
                        >
                          {data.isBlocked ? "Unblock" : "Block"}
                        </Menu.Item>
                        <Menu.Item
                          className="profile-menu-item danger"
                          onClick={() => setReporting(true)}
                        >
                          Report
                        </Menu.Item>
                      </Menu.Popup>
                    </Menu.Positioner>
                  </Menu.Portal>
                </Menu.Root>
              </div>
            ) : null}
          </div>
        </header>

        <section className="profile-summary" aria-label="Trading summary">
          <div className="profile-summary-value">
            <small>Portfolio value</small>
            <div className="profile-summary-amount">
              <strong><UsdAmount weth={portfolioValue} /></strong>
              <span
                className={`profile-summary-change ${displayedChange24h === null || displayedChange24h === 0 ? "muted" : displayedChange24h < 0 ? "negative" : "positive"}`}
                title="24h token price change in WETH, weighted by current holdings. Excludes buys, sells, transfers, and ETH/USD movement."
              >
                {displayedChange24h === null
                  ? "—"
                  : `${displayedChange24h > 0 ? "+" : ""}${displayedChange24h.toFixed(1)}%`}
              </span>
            </div>
          </div>
        </section>
      </div>

      {reporting ? (
        <form
          id="trader-report-form"
          className="profile-settings-card trader-report-form"
          aria-label="Report this profile"
          onSubmit={(event) => {
            event.preventDefault();
            void reportProfile();
          }}
        >
          <div>
            <label htmlFor="trader-report-reason">Reason</label>
            <select
              id="trader-report-reason"
              value={reportReason}
              onChange={(event) => setReportReason(event.target.value)}
            >
              <option value="spam">Spam</option>
              <option value="impersonation">Impersonation</option>
              <option value="manipulation">Suspected manipulation</option>
              <option value="harmful_content">Harmful content</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label htmlFor="trader-report-details">
              Details <span>(optional)</span>
            </label>
            <textarea
              id="trader-report-details"
              maxLength={1000}
              value={reportDetails}
              onChange={(event) => setReportDetails(event.target.value)}
            />
          </div>
          <div className="profile-editor-actions">
            <button type="button" onClick={() => setReporting(false)}>
              Cancel
            </button>
            <button className="primary-button" type="submit">
              Submit report
            </button>
          </div>
        </form>
      ) : null}

      <Tabs.Root
        className="profile-tabs"
        value={tab}
        onValueChange={(value) => setTab(value as ProfileTab)}
      >
        <Tabs.List
          className="profile-section-nav"
          aria-label="Profile sections"
        >
          <Tabs.Tab value="holdings">
            Holdings{positions.length ? <span>{positions.length}</span> : null}
          </Tabs.Tab>
          <Tabs.Tab value="activity">Activity</Tabs.Tab>
          {launches || creatorMarkets.data?.length ? (
            <Tabs.Tab value="launches">
              Launches
              {creatorMarkets.data?.length ? (
                <span>{creatorMarkets.data.length}</span>
              ) : null}
            </Tabs.Tab>
          ) : null}
          <Tabs.Indicator className="profile-section-indicator" />
        </Tabs.List>

        <Tabs.Panel value="holdings" className="profile-section-panel">
          {!positions.length ? (
            <EmptyState
              title="No holdings yet"
              action={
                isOwner ? (
                  <AppLink
                    className="profile-secondary-action"
                    route="markets"
                    navigate={navigate}
                  >
                    Explore markets
                  </AppLink>
                ) : null
              }
            >
              {isOwner
                ? "Tokens you buy on a curve show up here."
                : "This trader holds no curve tokens right now."}
            </EmptyState>
          ) : (
            <ul className="profile-list profile-holdings-list">
              {positions.map(({ position, balance }) => (
                <li key={position.token_address}>
                  <AppLink
                    className="profile-row profile-holding-row"
                    route="market"
                    params={{ address: position.token_address }}
                    navigate={navigate}
                  >
                    <span className="profile-row-main">
                      <strong>{position.token_name}</strong>
                      <small>
                        {formatEthAmount(balance)} ${position.token_symbol}
                      </small>
                    </span>
                    <span className="profile-holding-metrics">
                      <span className="profile-holding-metric">
                        <small>Amount invested</small>
                        <strong>{BigInt(position.invested_wei) > 0n
                          ? <UsdAmount weth={wethAmount(position.invested_wei)} compact />
                          : "—"}</strong>
                      </span>
                      <span className="profile-holding-metric">
                        <small title="Average market cap at buys, weighted by trade size">Avg. buy in</small>
                        <strong>{position.average_entry_market_cap_wei
                          ? <UsdAmount weth={wethAmount(position.average_entry_market_cap_wei)} compact />
                          : "—"}</strong>
                      </span>
                      <span className="profile-holding-metric">
                        <small title="Average market cap at sells, weighted by trade size">Avg. sell out</small>
                        <strong>{position.average_exit_market_cap_wei
                          ? <UsdAmount weth={wethAmount(position.average_exit_market_cap_wei)} compact />
                          : "—"}</strong>
                      </span>
                    </span>
                    <span className="profile-row-chevron" aria-hidden="true">
                      ›
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </Tabs.Panel>

        <Tabs.Panel value="activity" className="profile-section-panel">
          {trades.isLoading ? (
            <div
              className="profile-list-skeleton"
              aria-busy="true"
              aria-label="Loading activity"
            >
              {Array.from({ length: 4 }, (_, index) => (
                <span className="skeleton" key={index} />
              ))}
            </div>
          ) : trades.isError ? (
            <EmptyState
              title="Activity is unavailable"
              action={
                <button
                  className="profile-secondary-action"
                  type="button"
                  onClick={() => void trades.refetch()}
                >
                  Retry
                </button>
              }
            >
              {trades.error instanceof Error
                ? trades.error.message
                : "Try again shortly."}
            </EmptyState>
          ) : !trades.data?.items.length ? (
            <EmptyState title="No trades yet">
              {isOwner
                ? "Your buys and sells on Curveball show up here."
                : "This trader hasn't traded on Curveball yet."}
            </EmptyState>
          ) : (
            <ul className="profile-list">
              {trades.data.items.slice(0, 20).map((trade) => (
                <li key={trade.id}>
                  <AppLink
                    className="profile-row"
                    route="market"
                    params={{ address: trade.tokenAddress }}
                    navigate={navigate}
                  >
                    <span
                      className={`social-side ${trade.isBuy ? "buy" : "sell"}`}
                    >
                      {trade.isBuy ? "Buy" : "Sell"}
                    </span>
                    <span className="profile-row-main">
                      <strong>{trade.tokenName}</strong>
                      <small>
                        {trade.note
                          ? `"${trade.note}"`
                          : `$${trade.tokenSymbol}`}
                      </small>
                    </span>
                    <span className="profile-row-value">
                      <strong>
                        <UsdAmount weth={wethAmount(trade.quoteAmountWei)} compact />
                      </strong>
                      {trade.reactionCount ? (
                        <small>
                          {trade.reactionCount}{" "}
                          {trade.reactionCount === 1
                            ? "conviction"
                            : "convictions"}
                        </small>
                      ) : null}
                      <time dateTime={trade.blockTimestamp}>
                        {formatRelativeTime(trade.blockTimestamp)}
                      </time>
                    </span>
                  </AppLink>
                </li>
              ))}
            </ul>
          )}
        </Tabs.Panel>

        {launches || creatorMarkets.data?.length ? (
          <Tabs.Panel value="launches" className="profile-section-panel">
            {launches ?? (
              <CreatorMarketList
                tokens={creatorMarkets.data ?? []}
                navigate={navigate}
              />
            )}
          </Tabs.Panel>
        ) : null}
      </Tabs.Root>
    </main>
  );
}
