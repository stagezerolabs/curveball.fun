import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { AppLink } from "../components/Navigation";
import { formatAddress, formatEthAmount, formatRelativeTime } from "../lib/format.js";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";
import { activeExplorerUrl } from "../lib/web3";
import type { Navigate } from "../types";
import { FollowButton } from "../social/FollowButton";
import { NotificationPreferences } from "../social/NotificationPreferences";
import { socialApi, socialApiConfigured } from "../social/api";
import type { TraderProfile } from "../social/types";
import { useSocialAuth } from "../social/useSocialAuth";

function signedWeth(value: string) {
  const amount = Number(formatEther(BigInt(value || "0")));
  return `${amount >= 0 ? "+" : ""}${formatEthAmount(amount)} WETH`;
}

function ProfileEditor({ profile, onSaved, onCancel }: {
  profile: TraderProfile;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const { ensureAuthenticated } = useSocialAuth();
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio);
  const [discoverable, setDiscoverable] = useState(profile.discoverable);
  const mutation = useMutation({
    mutationFn: async () => {
      await ensureAuthenticated();
      return socialApi.saveProfile({ displayName, bio, discoverable });
    },
    onSuccess: onSaved,
  });

  return <form className="trader-profile-editor" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    <div>
      <label htmlFor="trader-display-name">Display name</label>
      <input id="trader-display-name" maxLength={40} value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Optional — your .rise name is shown first" />
    </div>
    <div>
      <label htmlFor="trader-bio">Short bio</label>
      <textarea id="trader-bio" maxLength={280} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="How you approach Curveball markets" />
      <small>{bio.length}/280</small>
    </div>
    <label className="social-checkbox"><input type="checkbox" checked={discoverable} onChange={(event) => setDiscoverable(event.target.checked)} /><span>Show this profile in trader discovery and leaderboards</span></label>
    {mutation.error ? <p className="social-form-error" role="alert">{mutation.error.message}</p> : null}
    <div className="profile-editor-actions"><button type="button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit" disabled={mutation.isPending}>{mutation.isPending ? "Saving…" : "Save profile"}</button></div>
  </form>;
}

export function TraderProfilePage({ address: routeAddress, navigate, launches = null }: { address: string; navigate: Navigate; launches?: ReactNode }) {
  const validAddress = isAddress(routeAddress);
  const traderAddress = validAddress ? getAddress(routeAddress) : null;
  const { address: walletAddress } = useAccount();
  const { ensureAuthenticated } = useSocialAuth();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [reporting, setReporting] = useState(false);
  const [reportReason, setReportReason] = useState("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [notice, setNotice] = useState("");
  const isOwner = Boolean(traderAddress && walletAddress?.toLowerCase() === traderAddress.toLowerCase());
  const profile = useQuery({
    queryKey: ["social", "profile", traderAddress?.toLowerCase(), walletAddress?.toLowerCase()],
    queryFn: () => socialApi.profile(traderAddress!),
    enabled: socialApiConfigured && Boolean(traderAddress),
  });
  const trades = useQuery({
    queryKey: ["social", "profile-trades", traderAddress?.toLowerCase()],
    queryFn: () => socialApi.feed("global", undefined, traderAddress!),
    enabled: socialApiConfigured && Boolean(traderAddress),
  });
  const rns = useQuery({
    queryKey: ["rns", "primary", traderAddress?.toLowerCase()],
    queryFn: ({ signal }) => fetchRnsPrimaryName(traderAddress!, signal),
    enabled: Boolean(traderAddress),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => setEditing(false), [traderAddress]);

  if (!traderAddress) return <main className="page-status wrap"><h1>Trader not found</h1><p>This wallet address is invalid.</p><AppLink className="primary-button" route="social" navigate={navigate}>Back to social</AppLink></main>;
  if (!socialApiConfigured) return <main className="page-status wrap"><h1>Social service is not connected</h1><p>Configure the VPS API before loading trader profiles.</p><AppLink className="primary-button" route="social" navigate={navigate}>Back to social</AppLink></main>;
  if (profile.isLoading) return <main className="trader-profile-page wrap" aria-busy="true" aria-label="Loading trader profile"><div className="trader-profile-skeleton skeleton" /></main>;
  if (profile.isError || !profile.data) return <main className="page-status wrap"><h1>Profile unavailable</h1><p>{profile.error instanceof Error ? profile.error.message : "Try again shortly."}</p><button className="primary-button" type="button" onClick={() => void profile.refetch()}>Retry</button></main>;

  const data = profile.data;
  const name = rns.data ?? data.displayName ?? formatAddress(traderAddress);
  const joined = data.stats.firstTrade ? formatRelativeTime(data.stats.firstTrade) : "No trades yet";
  const portfolioValue = data.positions.reduce((total, position) => {
    const balance = Number(formatEther(BigInt(position.balance_wei)));
    const rate = Number(position.virtual_token_after) > 0
      ? Number(position.virtual_quote_after) / Number(position.virtual_token_after)
      : 0;
    return total + balance * rate;
  }, 0);

  async function shareProfile() {
    const url = window.location.href;
    const canShare = typeof navigator.share === "function";
    try {
      if (canShare) await navigator.share({ title: `${name} on Curveball`, text: "View verified Curveball trading activity.", url });
      else await navigator.clipboard.writeText(url);
      setNotice(canShare ? "Share sheet opened." : "Profile link copied.");
    } catch { /* The user can cancel the platform share sheet. */ }
  }

  async function reportProfile() {
    try {
      await ensureAuthenticated();
      await socialApi.report(traderAddress as Address, reportReason, reportDetails);
      setNotice("Report submitted for review.");
      setReporting(false);
      setReportDetails("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not submit the report.");
    }
  }

  async function toggleBlock() {
    try {
      await ensureAuthenticated();
      await socialApi.block(traderAddress as Address, !data.isBlocked);
      setNotice(data.isBlocked ? "Trader unblocked." : "Trader blocked and removed from your feeds.");
      await queryClient.invalidateQueries({ queryKey: ["social"] });
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not update this block.");
    }
  }

  return <main className="trader-profile-page">
    <div className="trader-profile-layout">
      <div className="trader-profile-main">
        {notice ? <p className="notice notice-dismissible" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button></p> : null}

        <section className="trader-profile-overview" aria-labelledby="trader-profile-name">
          <div className="trader-profile-cover" aria-hidden="true"><span /><span /><span /></div>
          <div className="trader-profile-identity">
            <div className="trader-profile-avatar" aria-hidden="true">{name.slice(0, 2).toUpperCase()}</div>
            <div className="trader-profile-actions">
              {isOwner ? <button type="button" onClick={() => setEditing((value) => !value)}>{editing ? "Close editor" : data.claimed ? "Edit profile" : "Claim profile"}</button> : <FollowButton trader={traderAddress} following={data.isFollowed} onError={setNotice} />}
              <button type="button" onClick={() => void shareProfile()}>Share</button>
              {!isOwner ? <button type="button" aria-pressed={data.isBlocked} onClick={() => void toggleBlock()}>{data.isBlocked ? "Unblock" : "Block"}</button> : null}
              {!isOwner ? <button type="button" aria-expanded={reporting} aria-controls="trader-report-form" onClick={() => setReporting((value) => !value)}>Report</button> : null}
            </div>
          </div>
          <div className="trader-profile-copy">
            <span className="profile-proof">{data.claimed ? "Wallet claimed" : "Raw onchain view"}</span>
            <h1 id="trader-profile-name">{name}</h1>
            <a href={`${activeExplorerUrl}/address/${traderAddress}`} target="_blank" rel="noreferrer">{formatAddress(traderAddress)} ↗</a>
            <p>{data.bio || (data.claimed ? "This trader has not added a bio." : "This wallet has not claimed a public social profile. Its Curveball activity remains independently verifiable.")}</p>
            <dl className="trader-social-counts"><div><dd>{data.followers}</dd><dt>Followers</dt></div><div><dd>{data.following}</dd><dt>Following</dt></div></dl>
          </div>
        </section>

        {editing ? <ProfileEditor profile={data} onCancel={() => setEditing(false)} onSaved={() => { setEditing(false); void queryClient.invalidateQueries({ queryKey: ["social", "profile", traderAddress.toLowerCase()] }); }} /> : null}
        {reporting ? <form id="trader-report-form" className="trader-report-form" onSubmit={(event) => { event.preventDefault(); void reportProfile(); }}>
          <div><label htmlFor="trader-report-reason">Reason</label><select id="trader-report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="spam">Spam</option><option value="impersonation">Impersonation</option><option value="manipulation">Suspected manipulation</option><option value="harmful_content">Harmful content</option><option value="other">Other</option></select></div>
          <div><label htmlFor="trader-report-details">Details <span>(optional)</span></label><textarea id="trader-report-details" maxLength={1000} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} /></div>
          <div className="profile-editor-actions"><button type="button" onClick={() => setReporting(false)}>Cancel</button><button className="primary-button" type="submit">Submit report</button></div>
        </form> : null}

        {isOwner ? <NotificationPreferences address={traderAddress} /> : null}

        <section className="trader-wallet-section" aria-labelledby="trader-wallet-title">
          <header><div><span aria-hidden="true">▣</span><h2 id="trader-wallet-title">Wallets</h2></div><strong>1</strong></header>
          <div className="trader-portfolio-summary"><div><small>Curve portfolio value</small><strong>{formatEthAmount(portfolioValue)} WETH</strong><span>{data.positions.length} open {data.positions.length === 1 ? "position" : "positions"}</span></div><p>Estimated from indexed Curve Trades</p></div>
          <dl className="trader-profile-stats">
            <div><dt>Realized PnL</dt><dd className={BigInt(data.stats.realizedPnlWei) < 0n ? "negative" : ""}>{signedWeth(data.stats.realizedPnlWei)}</dd></div>
            <div><dt>Realized return</dt><dd>{data.stats.realizedReturnPct === null ? "—" : `${data.stats.realizedReturnPct >= 0 ? "+" : ""}${data.stats.realizedReturnPct.toFixed(1)}%`}</dd></div>
            <div><dt>Curve volume</dt><dd>{formatEthAmount(Number(formatEther(BigInt(data.stats.volumeWei))))} WETH</dd></div>
            <div><dt>Track record</dt><dd>{data.stats.tradeCount} trades</dd><small>{joined}</small></div>
          </dl>
          <p className="profile-methodology">Curveball-only virtual portfolio · average-cost realized PnL · external wallet activity excluded</p>
        </section>

        <div className="trader-profile-grid">
          <section aria-labelledby="trader-activity-title">
            <header className="social-section-header"><div><h2 id="trader-activity-title">Recent activity</h2><p>Confirmed Curve Trades</p></div></header>
            {trades.isLoading ? <div className="profile-activity-skeleton skeleton" /> : !trades.data?.items.length ? <p className="trader-empty-state">No indexed trades from this wallet.</p> : <ol className="profile-activity-list">{trades.data.items.slice(0, 12).map((trade) => <li key={trade.id}>
              <span className={`social-side ${trade.isBuy ? "buy" : "sell"}`}>{trade.isBuy ? "Buy" : "Sell"}</span>
              <AppLink route="market" params={{ address: trade.tokenAddress }} navigate={navigate}><strong>{trade.tokenName}</strong><small>${trade.tokenSymbol}</small></AppLink>
              <span>{formatEthAmount(Number(formatEther(BigInt(trade.quoteAmountWei))))} WETH</span>
              <time dateTime={trade.blockTimestamp}>{formatRelativeTime(trade.blockTimestamp)}</time>
            </li>)}</ol>}
          </section>
          <aside aria-labelledby="trader-positions-title">
            <header className="social-section-header"><div><h2 id="trader-positions-title">Curve positions</h2><p>Estimated from Curve Trades</p></div></header>
            {!data.positions.length ? <p className="trader-empty-state">No open curve positions.</p> : <ul className="trader-position-list">{data.positions.map((position) => {
              const balance = Number(formatEther(BigInt(position.balance_wei)));
              const rate = Number(position.virtual_token_after) > 0 ? Number(position.virtual_quote_after) / Number(position.virtual_token_after) : 0;
              const estimated = balance * rate;
              const knownBasis = Number(formatEther(BigInt(position.known_basis_balance_wei)));
              const content = <><span><strong>{position.token_name}</strong><small>${position.token_symbol}</small></span><span><strong>{formatEthAmount(balance)}</strong><small>≈ {formatEthAmount(estimated)} WETH{position.exact_balance_indexed && knownBasis < balance ? " · includes unknown-basis transfers" : ""}</small></span></>;
              return <li key={position.token_address}><AppLink route="market" params={{ address: position.token_address }} navigate={navigate}>{content}</AppLink></li>;
            })}</ul>}
          </aside>
        </div>
        {launches}
      </div>
    </div>
  </main>;
}
