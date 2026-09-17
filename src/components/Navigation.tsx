import { useBalance } from "wagmi";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import type { Address } from "viem";
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
  return (
    <header className="nav wrap">
      <Brand navigate={navigate} />
      <nav aria-label="Main navigation">
        <AppLink
          className={routeId === "home" ? "active" : ""}
          route="home"
          navigate={navigate}
        >
          Explore
        </AppLink>
        <AppLink
          className={["markets", "market"].includes(routeId) ? "active" : ""}
          route="markets"
          navigate={navigate}
        >
          Markets
        </AppLink>
        <AppLink
          className={routeId === "launch" ? "active" : ""}
          route="launch"
          navigate={navigate}
        >
          Launch
        </AppLink>
      </nav>
      <span className="wallet-group">
        {address && balance && (
          <span className="wallet-balance">
            {formatEthAmount(Number(balance.formatted))} ETH
          </span>
        )}
        <button className="wallet-button" onClick={connectWallet}>
          <span className={address ? "wallet-dot connected" : "wallet-dot"} />
          {address
            ? `${address.slice(0, 5)}…${address.slice(-4)}`
            : "Connect wallet"}
        </button>
      </span>
    </header>
  );
}

export function Footer({ navigate }: { navigate: Navigate }) {
  return (
    <footer className="footer wrap">
      <Brand navigate={navigate} />
      <p>Fair launches. Unexpected outcomes.</p>
      <span>Built on RISE</span>
    </footer>
  );
}
