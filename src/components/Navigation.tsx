import { forwardRef, useEffect, useState } from "react";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useQuery } from "@tanstack/react-query";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import type { Address } from "viem";
import { NavSearch } from "./NavSearch";
import { routeHref } from "../app/routeTree";
import { formatAddress } from "../lib/format.js";
import type { Navigate } from "../types";
import { activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { fetchRnsPrimaryName } from "../lib/rnsPrimary";
import type { Theme } from "../lib/theme";

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

function WalletNavButton({ address, displayName }: { address?: Address; displayName?: string | null }) {
  const { data: primaryName } = useQuery({
    queryKey: ["rns", "primary", address?.toLowerCase()],
    queryFn: ({ signal }) => fetchRnsPrimaryName(address!, signal),
    enabled: Boolean(address),
    staleTime: 60_000,
    refetchOnWindowFocus: "always",
    retry: 1,
  });

  return <ConnectButton.Custom>
    {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
      const connected = mounted && Boolean(account && chain);
      const wrongNetwork = connected && Boolean(chain?.unsupported);
      const walletLabel = primaryName ?? displayName ?? account?.displayName;
      return <button
        className="wallet-button"
        type="button"
        disabled={!mounted}
        onClick={() => {
          if (wrongNetwork) openChainModal?.();
          else if (connected) openAccountModal?.();
          else openConnectModal?.();
        }}
        aria-label={wrongNetwork ? "Switch wallet network" : connected ? `Manage wallet ${primaryName ? `${primaryName}, ` : ""}${address ?? account?.address}` : "Connect wallet"}
        title={connected && !wrongNetwork ? walletLabel : undefined}
      >
        <svg className="wallet-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 5.5A2.5 2.5 0 0 1 5.5 3H15v3H5.5A2.5 2.5 0 0 0 3 8.5v6A2.5 2.5 0 0 0 5.5 17H17V7H5.5" />
          <path d="M17 10h-4a2 2 0 0 0 0 4h4" />
        </svg>
        <span className="wallet-label">
          {wrongNetwork ? "Wrong network" : connected ? walletLabel : "Connect wallet"}
        </span>
      </button>;
    }}
  </ConnectButton.Custom>;
}

export function Header({
  address,
  navigate,
  routeId,
  theme,
  onThemeToggle,
}: {
  address?: Address;
  navigate: Navigate;
  routeId: string;
  theme: Theme;
  onThemeToggle: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

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
  const marketsClass = ["markets", "market"].includes(routeId) ? "active" : "";
  const profileClass = routeId === "profile" ? "active" : "";

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
        className={`nav-link ${profileClass}`}
        route="profile"
        navigate={go}
        aria-current={profileClass ? "page" : undefined}
      >
        Profile
      </AppLink>
    </>
  );

  return (
    <>
      <header className="nav wrap">
        <Brand navigate={go} />
        <nav className="nav-primary" aria-label="Main navigation">
          {primaryLinks}
        </nav>
        <div className="nav-actions">
          <NavSearch navigate={go} />
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          <AppLink className="nav-create" route="launch" navigate={go}>Create token</AppLink>
          <WalletNavButton address={address} displayName={address ? `${address.slice(0, 5)}…${address.slice(-4)}` : null} />
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

export function LandingHeader({ navigate }: { navigate: Navigate }) {
  return (
    <header className="landing-nav wrap">
      <Brand navigate={navigate} />
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
          <AppLink route="launch" navigate={navigate}>Launch</AppLink>
        </nav>

        <nav className="landing-footer-column" aria-label="Network">
          <h2>Network</h2>
          <span>RISE Testnet</span>
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
            <code>{formatAddress(launchpadAddress)}</code>
            <strong><i aria-hidden="true">✓</i> Verified</strong>
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
