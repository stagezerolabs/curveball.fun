import { useEffect, useState } from "react";
import { useBalance } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import type { Address } from "viem";
import { NavSearch } from "./NavSearch";
import { routeHref } from "../app/routeTree";
import { formatEthAmount } from "../lib/format.js";
import type { Navigate } from "../types";
import { activeExplorerUrl } from "../lib/web3";
import type { Theme } from "../lib/theme";

type AppLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  route: string;
  params?: Record<string, string>;
  navigate: Navigate;
  children: ReactNode;
};

export function AppLink({
  route,
  params,
  navigate,
  children,
  ...props
}: AppLinkProps) {
  const href = routeHref(route, params);
  return (
    <a
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
}

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

function WalletNavButton({ address, displayName }: { address?: Address; displayName?: string | null }) {
  return <ConnectButton.Custom>
    {({ account, chain, mounted, openConnectModal, openAccountModal, openChainModal }) => {
      const connected = mounted && Boolean(account && chain);
      const wrongNetwork = connected && Boolean(chain?.unsupported);
      return <button
        className="wallet-button"
        type="button"
        disabled={!mounted}
        onClick={() => {
          if (wrongNetwork) openChainModal?.();
          else if (connected) openAccountModal?.();
          else openConnectModal?.();
        }}
        aria-label={wrongNetwork ? "Switch wallet network" : connected ? `Manage wallet ${address ?? account?.address}` : "Connect wallet"}
      >
        <span className={connected ? "wallet-dot connected" : "wallet-dot"} />
        <span className="wallet-label">
          {wrongNetwork ? "Wrong network" : connected ? displayName ?? account?.displayName : "Connect wallet"}
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
  const { data: balance } = useBalance({ address });
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
  const homeClass = routeId === "home" ? "active" : "";
  const marketsClass = ["markets", "market"].includes(routeId) ? "active" : "";

  const links = (
    <>
      <AppLink
        className={`nav-link ${homeClass}`}
        route="home"
        navigate={go}
      >
        Explore
      </AppLink>
      <AppLink
        className={`nav-link ${marketsClass}`}
        route="markets"
        navigate={go}
      >
        Markets
      </AppLink>
      {address && <AppLink className={`nav-link ${routeId === "profile" ? "active" : ""}`} route="profile" navigate={go}>Profile</AppLink>}
      <AppLink
        className="primary-button nav-create"
        route="launch"
        navigate={go}
      >
        + Create
      </AppLink>
    </>
  );

  return (
    <>
      <header className="nav wrap">
        <Brand navigate={go} />
        <NavSearch navigate={go} />
        <div className="nav-actions">
          {links}
          <ThemeToggle theme={theme} onToggle={onThemeToggle} />
          {address && balance && (
            <span className="wallet-balance">
              {formatEthAmount(Number(balance.formatted))} ETH
            </span>
          )}
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
          {links}
        </nav>
      )}
    </>
  );
}

export function LandingHeader({
  address,
  navigate,
  theme,
  onThemeToggle,
}: {
  address?: Address;
  navigate: Navigate;
  theme: Theme;
  onThemeToggle: () => void;
}) {
  return (
    <header className="landing-nav wrap">
      <Brand navigate={navigate} />
      <nav aria-label="Main navigation">
        <AppLink route="home" navigate={navigate}>
          Markets
        </AppLink>
        <AppLink route="launch" navigate={navigate}>
          Launch
        </AppLink>
        {address && <AppLink route="profile" navigate={navigate}>Profile</AppLink>}
      </nav>
      <div className="landing-nav-actions">
        <ThemeToggle theme={theme} onToggle={onThemeToggle} />
        <WalletNavButton address={address} displayName={address ? `${address.slice(0, 5)}…${address.slice(-4)}` : null} />
      </div>
    </header>
  );
}

export function Footer({ navigate }: { navigate: Navigate }) {
  return (
    <footer className="footer wrap">
      <div className="footer-top">
        <div className="footer-brand">
          <Brand navigate={navigate} />
          <p>Fair launches. Unexpected outcomes.</p>
        </div>
        <nav className="footer-links" aria-label="Footer">
          <AppLink route="home" navigate={navigate}>
            Explore
          </AppLink>
          <AppLink route="markets" navigate={navigate}>
            Markets
          </AppLink>
          <AppLink route="launch" navigate={navigate}>
            Launch
          </AppLink>
          <a
            href={activeExplorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            Explorer
          </a>
        </nav>
      </div>
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} Curveball</span>
        <span>Built on RISE</span>
      </div>
    </footer>
  );
}

export function LandingFooter({ navigate }: { navigate: Navigate }) {
  return (
    <footer className="landing-footer wrap">
      <Brand navigate={navigate} />
      <p>Fair launches. Unexpected outcomes.</p>
      <span>Built on RISE</span>
    </footer>
  );
}
