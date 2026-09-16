import { routeHref } from "../app/routeTree.js";

export function AppLink({ route, params, navigate, children, ...props }) {
  const href = routeHref(route, params);
  return (
    <a
      href={href}
      onClick={(event) => {
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

export function Brand({ navigate }) {
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

export function Header({ address, connectWallet, navigate, routeId }) {
  return (
    <header className="nav wrap">
      <Brand navigate={navigate} />
      <nav aria-label="Main navigation">
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
      <button className="wallet-button" onClick={connectWallet}>
        <span className={address ? "wallet-dot connected" : "wallet-dot"} />
        {address
          ? `${address.slice(0, 5)}…${address.slice(-4)}`
          : "Connect wallet"}
      </button>
    </header>
  );
}

export function Footer({ navigate }) {
  return (
    <footer className="footer wrap">
      <Brand navigate={navigate} />
      <p>Fair launches. Unexpected outcomes.</p>
      <span>Built on RISE</span>
    </footer>
  );
}
