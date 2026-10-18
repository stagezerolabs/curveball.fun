import { forwardRef, useEffect, useLayoutEffect, useRef, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useAccount, usePublicClient, useSwitchChain } from "wagmi";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import type { Address } from "viem";
import { routeHref } from "../app/routeTree";
import { formatAddress } from "../lib/format.js";
import type { Navigate } from "../types";
import { activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";
import type { Theme } from "../lib/theme";
import { useStore } from "../app/useStore.js";
import { activeChainId } from "../lib/web3";
import type { CreatorTokenClient } from "../creatorTokens";
import type { Token } from "../types";
import { AccountPopover } from "./AccountPopover";
import { NotificationsPopover } from "./NotificationsPopover";

const RISK_NOTICE_DISMISSED_KEY = "curveball:risk-notice-dismissed";

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  route: string;
  params?: Record<string, string>;
  navigate: Navigate;
  children: ReactNode;
};

export const AppLink = forwardRef<HTMLAnchorElement, AppLinkProps>(function AppLink({
  route,
  params,
  navigate,
  children,
  ...props
}, ref) {
  const href = routeHref(route, params);
  return (
    <a
      ref={ref}
      href={href}
      onClick={(event: MouseEvent<HTMLAnchorElement>) => {
        if (
          event.button ||
          event.metaKey ||
          event.ctrlKey ||
          event.shiftKey ||
          event.altKey
        )
          return;
        event.preventDefault();
        navigate(route, params);
      }}
      {...props}
    >
      {children}
    </a>
  );
});

export function Brand({ navigate }: { navigate: Navigate }) {
  return (
    <AppLink
      className="brand"
      route="landing"
      navigate={navigate}
      aria-label="Curveball home"
    >
      <span className="brand-mark" aria-hidden="true">
        <i />
      </span>
      curveball
    </AppLink>
  );
}

export function ThemeToggle({
  theme,
  onToggle,
}: {
  theme: Theme;
  onToggle: () => void;
}) {
  const next = theme === "light" ? "dark" : "light";
  return (
    <button
      className="theme-toggle"
      type="button"
      onClick={onToggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <svg className="theme-icon sun" viewBox="0 0 20 20" aria-hidden="true">
        <circle cx="10" cy="10" r="3.2" />
        <path d="M10 1.7v2M10 16.3v2M1.7 10h2M16.3 10h2M4.1 4.1l1.4 1.4M14.5 14.5l1.4 1.4M15.9 4.1l-1.4 1.4M5.5 14.5l-1.4 1.4" />
      </svg>
      <svg className="theme-icon moon" viewBox="0 0 20 20" aria-hidden="true">
        <path d="M16.8 12.7A7 7 0 0 1 7.3 3.2a7 7 0 1 0 9.5 9.5Z" />
      </svg>
    </button>
  );
}

export function RiseLogo() {
  return (
    <svg viewBox="0 0 86 26" aria-hidden="true">
      <path d="M17.2463 0H0V4.33328H17.2463C18.6069 4.33328 19.7101 5.3035 19.7101 6.49997V8.66667H7.54247C3.37686 8.66667 0 11.6261 0 15.2768V25.9999H4.92753V15.8101L17.3978 25.9994H24.6387L8.7278 12.9999H19.7101V8.68775H24.6387V6.49997C24.6387 2.91012 21.328 0 17.2463 0Z" />
      <path d="M33.1856 0H28.2368V25.9999H33.1856V0Z" />
      <path d="M36.8108 8.61542C36.8108 12.2053 40.1215 15.1154 44.2032 15.1154H52.5487C53.9093 15.1154 55.0124 16.0923 55.0124 17.2889L55.0123 19.4999C55.0123 20.6965 53.9091 21.6666 52.5486 21.6666H36.8108V25.9999H52.5486C56.6304 25.9999 59.941 23.0898 59.941 19.4999L59.9411 17.2889C59.9411 13.699 56.6305 10.7889 52.5487 10.7889H44.2032C42.8427 10.7889 41.7395 9.81201 41.7395 8.61542L41.7396 6.49997C41.7396 5.3035 42.8428 4.33328 44.2034 4.33328H58.4326V0H44.2034C40.1215 0 36.8109 2.91012 36.8109 6.49997L36.8108 8.61542Z" />
      <path d="M62.6989 6.49997L62.6988 8.68775H67.6275L67.6276 6.49997C67.6276 5.3035 68.7308 4.33328 70.0914 4.33328H86V0H70.0914C66.0095 0 62.6989 2.91012 62.6989 6.49997Z" />
      <path d="M70.2621 10.7889H84.3243V15.1154L70.2621 15.1222C68.9015 15.1222 67.7984 16.0923 67.7984 17.2889L67.7984 19.5C67.7984 20.6965 68.9016 21.6666 70.2622 21.6666H86V26H70.2622C66.1804 26 62.8697 23.0898 62.8697 19.5L62.8696 17.2889C62.8696 13.6989 66.1803 10.7889 70.2621 10.7889Z" />
    </svg>
  );
}

function WalletNavButton({ address, displayName, navigate, profileActive = false }: { address?: Address; displayName?: string | null; navigate: Navigate; profileActive?: boolean }) {
  const { ready, authenticated, login } = usePrivy();
  const { chainId } = useAccount();
  const { switchChain } = useSwitchChain();
  const { data: primaryName } = useQuery({
    queryKey: ["rns", "primary", address?.toLowerCase()],
    queryFn: ({ signal }) => fetchRnsPrimaryName(address!, signal),
    enabled: Boolean(address),
    staleTime: 60_000,
    refetchOnWindowFocus: "always",
    retry: 1,
  });

  const wrongNetwork = authenticated && Boolean(address && chainId && chainId !== activeChainId);
  const walletLabel = primaryName ?? displayName ?? (address ? `${address.slice(0, 5)}…${address.slice(-4)}` : "Sign in");
  const label = <span className="privy-pill-label">
    <svg className="wallet-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H15v3H5.5A2.5 2.5 0 0 0 3 8.5v6A2.5 2.5 0 0 0 5.5 17H17V7H5.5" />
      <path d="M17 10h-4a2 2 0 0 0 0 4h4" />
    </svg>
    <span className="wallet-label">{walletLabel}</span>
  </span>;

  if (!authenticated) {
    return <button className="wallet-button" type="button" disabled={!ready} onClick={login} aria-label="Sign in to Curveball">
      {label}
    </button>;
  }

  if (wrongNetwork) {
    return <button className="wallet-button" type="button" onClick={() => switchChain({ chainId: activeChainId })} aria-label="Switch wallet to the Curveball network">
      <svg className="wallet-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H15v3H5.5A2.5 2.5 0 0 0 3 8.5v6A2.5 2.5 0 0 0 5.5 17H17V7H5.5" />
        <path d="M17 10h-4a2 2 0 0 0 0 4h4" />
      </svg>
      <span className="wallet-label">Switch network</span>
    </button>;
  }

  if (!address) return null;
  return <AccountPopover address={address} label={walletLabel} navigate={navigate} profileActive={profileActive} />;
}

function HeaderSearch({ navigate }: { navigate: Navigate }) {
  const client = usePublicClient({ chainId: activeChainId });
  const { tokens, loadMarkets } = useStore() as {
    tokens: Token[];
    loadMarkets: (client?: CreatorTokenClient) => Promise<Token[]>;
  };
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);
  const results = query.trim()
    ? tokens.filter((token) => `${token.name} ${token.symbol} ${token.address}`.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6)
    : [];
  const select = (token: Token) => {
    setQuery("");
    setFocused(false);
    navigate("market", { address: token.address });
  };

  return (
    <div className="header-search" onBlur={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false);
    }}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
        <circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" />
      </svg>
      <input
        type="search"
        aria-label="Search coins"
        placeholder="Search coins"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => {
          setFocused(true);
          void loadMarkets(client as unknown as CreatorTokenClient | undefined).catch(() => undefined);
        }}
        onKeyDown={(event) => {
          if (event.key === "Escape") { setFocused(false); event.currentTarget.blur(); }
          if (event.key === "Enter" && results[0]) select(results[0]);
        }}
      />
      {focused && query.trim() && (
        <div className="header-search-results" role="status">
          {results.length ? results.map((token) => (
            <button key={token.address} type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => select(token)}>
              <strong>{token.name}</strong><span>${token.symbol}</span>
            </button>
          )) : <p>No matching coins</p>}
        </div>
      )}
    </div>
  );
}

export function Header({
  address,
  isAdmin,
  navigate,
  routeId,
  theme,
  onThemeToggle,
}: {
  address?: Address;
  isAdmin: boolean;
  navigate: Navigate;
  routeId: string;
  theme: Theme;
  onThemeToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [announcementVisible, setAnnouncementVisible] = useState(() => {
    try {
      return window.sessionStorage.getItem(RISK_NOTICE_DISMISSED_KEY) !== "true";
    } catch {
      return true;
    }
  });
  const primaryNavRef = useRef<HTMLElement>(null);
  const activePillRef = useRef<HTMLSpanElement>(null);
  const pillReadyRef = useRef(false);

  useLayoutEffect(() => {
    const nav = primaryNavRef.current;
    const pill = activePillRef.current;
    if (!nav || !pill) return;
    const positionPill = () => {
      const selected = nav.querySelector<HTMLElement>(".nav-link.active");
      if (!selected || nav.clientWidth === 0) {
        pill.style.opacity = "0";
        return;
      }
      const navBox = nav.getBoundingClientRect();
      const selectedBox = selected.getBoundingClientRect();
      pill.style.width = `${selectedBox.width}px`;
      pill.style.height = `${selectedBox.height}px`;
      pill.style.transform = `translate3d(${selectedBox.left - navBox.left}px, ${selectedBox.top - navBox.top}px, 0)`;
      pill.style.opacity = "1";
    };
    if (!pillReadyRef.current) pill.style.transition = "none";
    positionPill();
    const frame = requestAnimationFrame(() => {
      pill.style.removeProperty("transition");
      pillReadyRef.current = true;
    });
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(positionPill);
    observer?.observe(nav);
    window.addEventListener("resize", positionPill);
    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", positionPill);
    };
  }, [routeId, address]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const go: Navigate = (route, params) => {
    setMenuOpen(false);
    navigate(route, params);
  };
  const dismissAnnouncement = () => {
    setAnnouncementVisible(false);
    try {
      window.sessionStorage.setItem(RISK_NOTICE_DISMISSED_KEY, "true");
    } catch { /* The notice stays hidden until this page is reloaded. */ }
  };
  const marketsClass = ["markets", "market"].includes(routeId) ? "active" : "";
  const socialClass = ["social", "trader"].includes(routeId) ? "active" : "";
  const profileClass = routeId === "profile" || routeId === "profileSettings" ? "active" : "";
  const adminClass = routeId === "admin" ? "active" : "";

  const primaryLinks = (
    <>
      <AppLink
        className={`nav-link ${marketsClass}`}
        route="markets"
        navigate={go}
        aria-current={marketsClass ? "page" : undefined}
      >
        Explore
      </AppLink>
      <AppLink
        className={`nav-link ${socialClass}`}
        route="social"
        navigate={go}
        aria-current={socialClass ? "page" : undefined}
      >
        Social
      </AppLink>
      <AppLink
        className={`nav-link ${profileClass}`}
        route="profile"
        navigate={go}
        aria-current={profileClass ? "page" : undefined}
      >
        Profile
      </AppLink>
      {isAdmin && <AppLink className={`nav-link ${adminClass}`} route="admin" navigate={go} aria-current={adminClass ? "page" : undefined}>Admin</AppLink>}
    </>
  );

  return (
    <>
      {announcementVisible && <aside className="announcement-bar" aria-label="Trading risk notice">
        <div className="announcement-inner">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d="M12 3 22 20H2L12 3Z" /><path d="M12 9v5" /><circle cx="12" cy="17" r=".8" fill="currentColor" stroke="none" /></svg>
          <p><span className="announcement-desktop-copy">Token market caps can move fast. Trade carefully.</span><span className="announcement-mobile-copy">Market caps move fast. Trade carefully.</span></p>
          <button className="announcement-close" type="button" aria-label="Dismiss announcement" onClick={dismissAnnouncement}>×</button>
        </div>
      </aside>}
      <header className="nav wrap">
        <Brand navigate={go} />
        <HeaderSearch navigate={go} />
        <nav ref={primaryNavRef} className="nav-primary" aria-label="Main navigation">
          <span ref={activePillRef} className="nav-active-pill" aria-hidden="true" />
          <AppLink className={`nav-link ${marketsClass}`} route="markets" navigate={go} aria-current={marketsClass ? "page" : undefined}>Explore</AppLink>
          <AppLink className={`nav-link ${socialClass}`} route="social" navigate={go} aria-current={socialClass ? "page" : undefined}>Social</AppLink>
          {isAdmin && <AppLink className={`nav-link ${adminClass}`} route="admin" navigate={go} aria-current={adminClass ? "page" : undefined}>Admin</AppLink>}
        </nav>
        <div className="nav-actions">
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          <AppLink className="nav-create" route="launch" navigate={go} aria-current={routeId === "launch" ? "page" : undefined}><span aria-hidden="true">＋</span> Create</AppLink>
          <WalletNavButton address={address} displayName={address ? `${address.slice(0, 5)}…${address.slice(-4)}` : null} navigate={go} profileActive={Boolean(profileClass)} />
          {address ? <NotificationsPopover address={address} navigate={go} /> : null}
        </div>
        <button
          className="nav-menu"
          type="button"
          aria-label={menuOpen ? "Close menu" : "Open menu"}
          aria-expanded={menuOpen}
          aria-controls="nav-sheet"
          onClick={() => setMenuOpen((open) => !open)}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            {menuOpen ? (
              <path d="M5 5 15 15M15 5 5 15" />
            ) : (
              <path d="M3 6h14M3 10h14M3 14h14" />
            )}
          </svg>
        </button>
      </header>
      {menuOpen && (
        <nav id="nav-sheet" className="nav-sheet wrap" aria-label="Main navigation">
          {primaryLinks}
          <AppLink className="nav-create" route="launch" navigate={go}>Create token</AppLink>
          <div className="nav-sheet-theme"><span>Appearance</span><ThemeToggle theme={theme} onToggle={onThemeToggle} /></div>
        </nav>
      )}
    </>
  );
}

export function LandingHeader({ address, isAdmin, navigate, theme, onThemeToggle }: { address?: Address; isAdmin: boolean; navigate: Navigate; theme: Theme; onThemeToggle: () => void }) {
  return (
    <header className="landing-nav wrap">
      <Brand navigate={navigate} />
      <div className="landing-nav-actions">
        {isAdmin && <AppLink className="nav-link" route="admin" navigate={navigate}>Admin</AppLink>}
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        <WalletNavButton address={address} displayName={address ? `${address.slice(0, 5)}…${address.slice(-4)}` : null} navigate={navigate} />
      </div>
    </header>
  );
}

export function LandingFooter({ navigate }: { navigate: Navigate }) {
  return (
    <footer className="landing-footer wrap">
      <div className="landing-footer-grid">
        <div className="landing-footer-brand">
          <Brand navigate={navigate} />
          <p>Launch on the curve</p>
        </div>

        <nav className="landing-footer-column" aria-label="Product">
          <h2>Product</h2>
          <AppLink route="markets" navigate={navigate}>Markets</AppLink>
          <AppLink route="stats" navigate={navigate}>Stats</AppLink>
          <AppLink route="launch" navigate={navigate}>Launch</AppLink>
        </nav>

        <nav className="landing-footer-column" aria-label="Network">
          <h2>Network</h2>
          <span>RISE Mainnet</span>
          <a href={activeExplorerUrl} target="_blank" rel="noreferrer">
            Explorer ↗
          </a>
        </nav>
      </div>

      {launchpadAddress && (
        <div className="landing-footer-contracts">
          <h2>Contract</h2>
          <a
            href={`${activeExplorerUrl}/address/${launchpadAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            <span>Launchpad</span>
            <svg className="landing-contract-check" viewBox="0 0 20 20" role="img" aria-label="Official Curveball contract">
              <circle cx="10" cy="10" r="9" fill="currentColor" />
              <path d="m6 10 2.5 2.5L14 7" fill="none" stroke="var(--on-solid)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            <code>{formatAddress(launchpadAddress)}</code>
          </a>
        </div>
      )}

      <div className="landing-footer-bottom">
        <span className="landing-footer-credit">
          © {new Date().getFullYear()} Curveball · Built on
          <a
            href="https://risechain.com/"
            target="_blank"
            rel="noreferrer"
            aria-label="RISE"
          >
            <RiseLogo />
          </a>
        </span>
      </div>
    </footer>
  );
}
