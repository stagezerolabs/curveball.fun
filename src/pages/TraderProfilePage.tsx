import { useEffect, useState, type ReactNode } from "react";
import { Menu } from "@base-ui/react/menu";
import { Tabs } from "@base-ui/react/tabs";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatEther, getAddress, isAddress, type Address } from "viem";
import { useAccount } from "wagmi";
import { AppLink } from "../components/Navigation";
import { formatAddress, formatEthAmount, formatRelativeTime } from "../lib/format.js";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";
import { activeExplorerUrl } from "../lib/web3";
import type { Navigate } from "../types";
import { FollowButton } from "../social/FollowButton";
import { TraderAvatar } from "../social/TraderAvatar";
import { NotificationPreferences } from "../social/NotificationPreferences";
import { SocialFeed } from "../social/SocialFeed";
import { TraderDirectory } from "../social/TraderDirectory";
import { socialApi, socialApiConfigured } from "../social/api";
import type { TraderProfile } from "../social/types";
import { useSocialAuth } from "../social/useSocialAuth";

export type ProfileTab = "holdings" | "activity" | "launches" | "settings";

function wethAmount(wei: string) {
  return Number(formatEther(BigInt(wei || "0")));
}

function signedWeth(value: string) {
  const amount = wethAmount(value);
  return `${amount >= 0 ? "+" : ""}${formatEthAmount(amount)} WETH`;
}

function EmptyState({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return <div className="profile-empty-state"><strong>{title}</strong>{children ? <p>{children}</p> : null}{action}</div>;
}

function ProfileEditor({ profile, onSaved }: {
  profile: TraderProfile;
  onSaved: () => void;
}) {
  const { ensureAuthenticated } = useSocialAuth();
  const [displayName, setDisplayName] = useState(profile.displayName ?? "");
  const [bio, setBio] = useState(profile.bio);
  const [discoverable, setDiscoverable] = useState(profile.discoverable);
  const dirty = displayName !== (profile.displayName ?? "") || bio !== profile.bio || discoverable !== profile.discoverable;
  const mutation = useMutation({
    mutationFn: async () => {
      await ensureAuthenticated();
      return socialApi.saveProfile({ displayName, bio, discoverable });
    },
    onSuccess: onSaved,
  });

  return <form className="profile-settings-card" aria-labelledby="profile-editor-title" onSubmit={(event) => { event.preventDefault(); mutation.mutate(); }}>
    <h2 id="profile-editor-title">Profile</h2>
    <div className="settings-field">
      <label htmlFor="trader-display-name">Display name</label>
      <input id="trader-display-name" maxLength={40} autoComplete="nickname" value={displayName} onChange={(event) => setDisplayName(event.target.value)} placeholder="Your .rise name is shown first" />
    </div>
    <label className="settings-toggle-row"><span className="settings-toggle-copy"><strong>Discoverable profile</strong><small>Allow other traders to find and follow you. Turning this off removes incoming follows.</small></span><input className="profile-switch" type="checkbox" role="switch" checked={discoverable} onChange={(event) => setDiscoverable(event.target.checked)} /></label>
    <div className="settings-field">
      <div className="settings-field-label"><label htmlFor="trader-bio">Bio</label><small aria-live="polite">{bio.length}/280</small></div>
      <textarea id="trader-bio" rows={3} maxLength={280} value={bio} onChange={(event) => setBio(event.target.value)} placeholder="How you trade, in a line or two" />
    </div>
    {mutation.error ? <p className="social-form-error" role="alert">{mutation.error.message}</p> : null}
    <button className="primary-button settings-save" type="submit" disabled={!dirty || mutation.isPending}>{mutation.isPending ? "Saving…" : "Save changes"}</button>
  </form>;
}

export function TraderProfilePage({ address: routeAddress, navigate, launches = null, initialTab = "holdings" }: {
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
  const [connectionView, setConnectionView] = useState<"followers" | "following" | null>(null);
  const isOwner = Boolean(traderAddress && walletAddress?.toLowerCase() === traderAddress.toLowerCase());
  const profile = useQuery({
    queryKey: ["social", "profile", traderAddress?.toLowerCase(), walletAddress?.toLowerCase()],
    queryFn: () => socialApi.profile(traderAddress!),
    enabled: socialApiConfigured && Boolean(traderAddress),
  });
  const rns = useQuery({
    queryKey: ["rns", "primary", traderAddress?.toLowerCase()],
    queryFn: ({ signal }) => fetchRnsPrimaryName(traderAddress!, signal),
    enabled: Boolean(traderAddress),
    staleTime: 60_000,
    retry: 1,
  });

  useEffect(() => setTab(initialTab), [traderAddress, initialTab]);

  if (!traderAddress) return <main className="page-status wrap"><h1>Trader not found</h1><p>This wallet address is invalid.</p><AppLink className="primary-button" route="social" navigate={navigate}>Back to Pulse</AppLink></main>;
  if (!socialApiConfigured) return <main className="page-status wrap"><h1>Social service is not connected</h1><p>Configure the VPS API before loading trader profiles.</p><AppLink className="primary-button" route="social" navigate={navigate}>Back to Pulse</AppLink></main>;
  if (profile.isLoading) return <TraderProfileSkeleton />;
  if (profile.isError || !profile.data) return <main className="page-status wrap"><h1>Profile unavailable</h1><p>{profile.error instanceof Error ? profile.error.message : "Try again shortly."}</p><button className="primary-button" type="button" onClick={() => void profile.refetch()}>Retry</button></main>;

  const data = profile.data;
  const name = rns.data ?? data.displayName ?? formatAddress(traderAddress);
  const positions = data.positions.map((position) => {
    const balance = wethAmount(position.balance_wei);
    const rate = Number(position.virtual_token_after) > 0
      ? Number(position.virtual_quote_after) / Number(position.virtual_token_after)
      : 0;
    const knownBasis = wethAmount(position.known_basis_balance_wei);
    return { position, balance, value: balance * rate, unknownBasis: position.exact_balance_indexed && knownBasis < balance };
  }).sort((a, b) => b.value - a.value);
  const portfolioValue = positions.reduce((total, item) => total + item.value, 0);
  const realizedNegative = BigInt(data.stats.realizedPnlWei) < 0n;
  const realizedReturn = data.stats.realizedReturnPct === null
    ? null
    : `${data.stats.realizedReturnPct >= 0 ? "+" : ""}${data.stats.realizedReturnPct.toFixed(1)}%`;

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

  return <main className="trader-profile-page wrap">
    {notice ? <p className="notice notice-dismissible" role="status"><span>{notice}</span><button type="button" onClick={() => setNotice("")} aria-label="Dismiss message">×</button></p> : null}

    <div className="profile-top">
      <header className="profile-hero" aria-labelledby="trader-profile-name">
        <TraderAvatar className="profile-hero-avatar" address={traderAddress} name={name} />
        <div className="profile-hero-copy">
          <h1 id="trader-profile-name">{name}</h1>
          <p className="profile-hero-meta">
            <a href={`${activeExplorerUrl}/address/${traderAddress}`} target="_blank" rel="noreferrer" title={traderAddress}>{formatAddress(traderAddress)} <span aria-hidden="true">↗</span></a>
          </p>
          {data.bio ? <p className="profile-hero-bio">{data.bio}</p> : null}
          <p className="profile-hero-social"><button type="button" onClick={() => setConnectionView(connectionView === "followers" ? null : "followers")} aria-expanded={connectionView === "followers"}><strong>{data.followers}</strong> followers</button><button type="button" onClick={() => setConnectionView(connectionView === "following" ? null : "following")} aria-expanded={connectionView === "following"}><strong>{data.following}</strong> following</button></p>
          {!isOwner ? <div className="profile-hero-actions">
            {data.discoverable ? <FollowButton trader={traderAddress} following={data.isFollowed} onError={setNotice} /> : null}
            <Menu.Root>
              <Menu.Trigger className="profile-icon-button" aria-label="More actions" title="More actions"><span aria-hidden="true">⋯</span></Menu.Trigger>
              <Menu.Portal>
                <Menu.Positioner className="profile-menu-positioner" sideOffset={8} align="start">
                  <Menu.Popup className="profile-menu">
                    <Menu.Item className="profile-menu-item" onClick={() => void toggleBlock()}>{data.isBlocked ? "Unblock" : "Block"}</Menu.Item>
                    <Menu.Item className="profile-menu-item danger" onClick={() => setReporting(true)}>Report</Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.Root>
          </div> : null}
        </div>
      </header>

      <section className="profile-summary" aria-label="Trading summary">
        <div className="profile-summary-value">
          <small>Portfolio value</small>
          <strong>{formatEthAmount(portfolioValue)} <span>WETH</span></strong>
          <p className={realizedNegative ? "negative" : "positive"}>{signedWeth(data.stats.realizedPnlWei)} realized{realizedReturn ? <> · {realizedReturn}</> : null}</p>
        </div>
        <dl className="profile-summary-stats">
          <div><dt>Volume</dt><dd>{formatEthAmount(wethAmount(data.stats.volumeWei))} WETH</dd></div>
          <div><dt>Trades</dt><dd>{data.stats.tradeCount.toLocaleString("en-US")}</dd></div>
          <div><dt>First trade</dt><dd>{data.stats.firstTrade ? formatRelativeTime(data.stats.firstTrade) : "—"}</dd></div>
        </dl>
      </section>
    </div>
    {connectionView ? <div className="profile-connections"><h2>{connectionView === "followers" ? "Followers" : "Following"}</h2><TraderDirectory key={`${traderAddress}-${connectionView}`} navigate={navigate} address={traderAddress} kind={connectionView} /></div> : null}

    {reporting ? <form id="trader-report-form" className="profile-settings-card trader-report-form" aria-label="Report this profile" onSubmit={(event) => { event.preventDefault(); void reportProfile(); }}>
      <div><label htmlFor="trader-report-reason">Reason</label><select id="trader-report-reason" value={reportReason} onChange={(event) => setReportReason(event.target.value)}><option value="spam">Spam</option><option value="impersonation">Impersonation</option><option value="manipulation">Suspected manipulation</option><option value="harmful_content">Harmful content</option><option value="other">Other</option></select></div>
      <div><label htmlFor="trader-report-details">Details <span>(optional)</span></label><textarea id="trader-report-details" maxLength={1000} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} /></div>
      <div className="profile-editor-actions"><button type="button" onClick={() => setReporting(false)}>Cancel</button><button className="primary-button" type="submit">Submit report</button></div>
    </form> : null}

    <Tabs.Root className="profile-tabs" value={tab} onValueChange={(value) => setTab(value as ProfileTab)}>
      <Tabs.List className="profile-section-nav" aria-label="Profile sections">
        <Tabs.Tab value="holdings">Holdings{positions.length ? <span>{positions.length}</span> : null}</Tabs.Tab>
        <Tabs.Tab value="activity">Activity</Tabs.Tab>
        {launches ? <Tabs.Tab value="launches">Launches</Tabs.Tab> : null}
        {isOwner ? <Tabs.Tab value="settings">Settings</Tabs.Tab> : null}
        <Tabs.Indicator className="profile-section-indicator" />
      </Tabs.List>

      <Tabs.Panel value="holdings" className="profile-section-panel">
        {!positions.length ? <EmptyState
          title="No holdings yet"
          action={isOwner ? <AppLink className="profile-secondary-action" route="markets" navigate={navigate}>Explore markets</AppLink> : null}
        >{isOwner ? "Tokens you buy on a curve show up here." : "This trader holds no curve tokens right now."}</EmptyState>
          : <ul className="profile-list">{positions.map(({ position, balance, value, unknownBasis }) => <li key={position.token_address}>
            <AppLink className="profile-row" route="market" params={{ address: position.token_address }} navigate={navigate}>
              <span className="profile-row-main"><strong>{position.token_name}</strong><small>{formatEthAmount(balance)} ${position.token_symbol}</small></span>
              <span className="profile-row-value"><strong>{formatEthAmount(value)} WETH</strong>{unknownBasis ? <small>Includes transfers in</small> : null}</span>
              <span className="profile-row-chevron" aria-hidden="true">›</span>
            </AppLink>
          </li>)}</ul>}
      </Tabs.Panel>

      <Tabs.Panel value="activity" className="profile-section-panel">
        <SocialFeed scope="global" trader={traderAddress} navigate={navigate} />
      </Tabs.Panel>

      {launches ? <Tabs.Panel value="launches" className="profile-section-panel">{launches}</Tabs.Panel> : null}

      {isOwner ? <Tabs.Panel value="settings" className="profile-section-panel profile-settings">
        <ProfileEditor profile={data} onSaved={() => { setNotice("Profile saved."); void queryClient.invalidateQueries({ queryKey: ["social", "profile", traderAddress.toLowerCase()] }); }} />
        <NotificationPreferences address={traderAddress} />
      </Tabs.Panel> : null}
    </Tabs.Root>
  </main>;
}

export function TraderProfileSkeleton() {
  return <main className="trader-profile-page wrap" aria-busy="true" aria-label="Loading profile">
    <div className="profile-hero"><span className="profile-hero-avatar skeleton" /><div className="profile-hero-copy"><span className="skeleton skeleton-line" /><span className="skeleton skeleton-line" /></div></div>
    <div className="profile-summary skeleton trader-profile-skeleton" />
  </main>;
}
