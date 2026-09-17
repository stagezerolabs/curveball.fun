import { useEffect, useState } from "react";
import { useBalance } from "wagmi";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import type { Address } from "viem";
import { NavSearch } from "./NavSearch";
import { routeHref } from "../app/routeTree";
import { formatEthAmount } from "../lib/format.js";
import type { Navigate } from "../types";

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
      route="home"
      navigate={navigate}
      aria-label="Curveball home"
    >
      <span className="brand-mark" aria-hidden="true">
        <i />
      </span>
      curveball<span>.fun</span>
    </AppLink>
  );
}

export function Header({
  address,
  connectWallet,
  navigate,
  routeId,
}: {
  address?: Address;
  connectWallet: () => void;
  navigate: Navigate;
  routeId: string;
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
          {address && balance && (
            <span className="wallet-balance">
              {formatEthAmount(Number(balance.formatted))} ETH
            </span>
          )}
          <button className="wallet-button" onClick={connectWallet}>
            <span className={address ? "wallet-dot connected" : "wallet-dot"} />
            {address ? `${address.slice(0, 5)}…${address.slice(-4)}` : "Connect wallet"}
          </button>
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
            href="https://explorer.risechain.com"
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
