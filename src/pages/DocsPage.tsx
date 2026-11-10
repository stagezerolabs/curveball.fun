import type { ReactNode } from "react";
import { AppLink } from "../components/Navigation";
import { activeChain, activeExplorerUrl, launchpadAddress } from "../lib/web3";
import type { Navigate } from "../types";
import { documentedNetworks, type DocumentedContract } from "./docsContracts";

const chapters = [
  {
    slug: null,
    label: "Start here",
    title: "A market starts with a curve.",
    description: "What Curveball is and where to begin.",
    lead: "Curveball lets anyone launch a token, trade it on a bonding curve, and follow its path into an open liquidity pool on RISE.",
  },
  {
    slug: "launching",
    label: "Launching",
    title: "Launch a token.",
    description: "Create a market and review its first transaction.",
    lead: "Choose the token details, review the WETH cost, and confirm the launch in your wallet. The market is live as soon as the transaction succeeds.",
  },
  {
    slug: "trading",
    label: "Trading",
    title: "Trade through the curve and beyond.",
    description: "Understand quotes, funding, and the two venues.",
    lead: "Every market starts on its own curve. After graduation, trading moves to its Icarus pool. The market page shows the venue and a fresh quote before you sign.",
  },
  {
    slug: "graduation",
    label: "Graduation",
    title: "From curve to pool.",
    description: "What happens when a curve sells out.",
    lead: "A completed curve pauses trading while its WETH and remaining tokens seed an Icarus pool. The pool then becomes the market's trading venue.",
  },
  {
    slug: "fees",
    label: "Fees & earnings",
    title: "Follow every fee.",
    description: "Launch costs, trading fees, and creator claims.",
    lead: "Curveball shows the fees for each market. The amount and recipient depend on the action, so review the launch form or trade panel before signing.",
  },
  {
    slug: "pulse",
    label: "Pulse & profiles",
    title: "Find the people behind the trades.",
    description: "Follow wallets and read their market activity.",
    lead: "Pulse connects market activity to wallets you follow. Trader profiles show public activity and use a wallet's primary .rise name when one is available.",
  },
  {
    slug: "contracts",
    label: "Contracts",
    title: "Verify every deployment.",
    description: "Protocol addresses on RISE Mainnet and Testnet.",
    lead: "Use these recorded addresses to inspect Curveball's deployed contracts and the external contracts its markets use.",
  },
  {
    slug: "safety",
    label: "Before you trade",
    title: "Know what you are signing.",
    description: "Wallet checks and the limits of USD estimates.",
    lead: "Transactions settle in tokens on RISE. Read the wallet prompt, check the market state, and understand the difference between a USD estimate and the amount you will actually spend.",
  },
] as const;

type Chapter = (typeof chapters)[number];

function ContractList({ contracts, explorer }: { contracts: readonly DocumentedContract[]; explorer: string }) {
  return (
    <div className="docs-contract-list">
      {contracts.map((contract) => (
        <div className="docs-contract" key={contract.address}>
          <div>
            <strong>{contract.name}</strong>
            <p>{contract.purpose}</p>
          </div>
          <a href={`${explorer}/address/${contract.address}?tab=contract`} target="_blank" rel="noreferrer">
            <code>{contract.address}</code><span aria-hidden="true">↗</span>
          </a>
        </div>
      ))}
    </div>
  );
}

function DocLink({
  chapter,
  navigate,
  children,
  className,
  active = false,
}: {
  chapter: Chapter;
  navigate: Navigate;
  children: ReactNode;
  className?: string;
  active?: boolean;
}) {
  return (
    <AppLink
      className={className}
      route={chapter.slug ? "docsPage" : "docs"}
      params={chapter.slug ? { slug: chapter.slug } : undefined}
      navigate={navigate}
      aria-current={active ? "page" : undefined}
    >
      {children}
    </AppLink>
  );
}

function DocsContent({ slug, navigate }: { slug: Chapter["slug"]; navigate: Navigate }) {
  switch (slug) {
    case null:
      return (
        <>
          <section className="docs-highlight" aria-label="How Curveball works">
            <span className="docs-highlight-kicker">The market lifecycle</span>
            <div className="docs-steps">
              <div><span>01</span><strong>Launch</strong><p>A creator starts a token and its curve.</p></div>
              <div><span>02</span><strong>Trade</strong><p>Buyers and sellers move the market on the curve.</p></div>
              <div><span>03</span><strong>Graduate</strong><p>A sold-out curve becomes an Icarus pool.</p></div>
            </div>
          </section>
          <section className="docs-section" aria-labelledby="docs-explore-title">
            <h2 id="docs-explore-title">Explore the documentation.</h2>
            <div className="docs-card-grid">
              {chapters.slice(1).map((chapter, index) => (
                <DocLink key={chapter.slug} chapter={chapter} navigate={navigate} className="docs-topic-card">
                  <span className="docs-topic-number">{String(index + 1).padStart(2, "0")}</span>
                  <strong>{chapter.label}</strong>
                  <span>{chapter.description}</span>
                  <span className="docs-topic-arrow" aria-hidden="true">↗</span>
                </DocLink>
              ))}
            </div>
          </section>
          <section className="docs-section docs-split">
            <div>
              <span className="docs-overline">Built on RISE</span>
              <h2>One token. Two trading phases.</h2>
            </div>
            <p>
              Curveball's launchpad handles the initial sale. Once the curve sells out,
              the market graduates to a pool with open liquidity. Market pages keep the
              lifecycle, current venue, fees, and transaction links together.
            </p>
          </section>
        </>
      );
    case "launching":
      return (
        <>
          <section className="docs-section">
            <h2>What you choose.</h2>
            <p>Enter a token name and ticker, add artwork, and choose an optional initial buy. The form also shows the creator tax allowed by the current launchpad and the launch fee before confirmation.</p>
            <ol className="docs-numbered">
              <li><strong>Connect a wallet on RISE.</strong><span>Keep ETH for network gas. The app can wrap ETH into WETH when a paid launch needs it.</span></li>
              <li><strong>Complete the token form.</strong><span>Review the artwork, ticker, creator tax, and optional first buy.</span></li>
              <li><strong>Review and sign.</strong><span>The cost dialog shows an approximate USD value and the exact WETH amounts your wallet will spend.</span></li>
            </ol>
          </section>
          <aside className="docs-note"><strong>One transaction starts the market.</strong><p>A successful launch creates the token and its bonding curve. An optional initial buy is included in the launch transaction.</p></aside>
          <section className="docs-section docs-split"><div><h2>Ready to create?</h2></div><p>The launch form reads current contract settings. Use its displayed fee and limits rather than assuming a fixed amount from a guide. <AppLink route="launch" navigate={navigate}>Open the launch form ↗</AppLink></p></section>
        </>
      );
    case "trading":
      return (
        <>
          <section className="docs-section">
            <h2>Check the venue.</h2>
            <div className="docs-two-up">
              <div><span className="docs-overline">Before graduation</span><h3>Bonding curve</h3><p>Buy with WETH and sell tokens back to the curve. The displayed price changes as the curve's reserves change. Buying may wrap ETH into WETH and require token approval.</p></div>
              <div><span className="docs-overline">After graduation</span><h3>Icarus pool</h3><p>Trades use the market's Icarus pool through Curveball's swap adapter. Pool availability and the current pool fee appear in the trade panel.</p></div>
            </div>
          </section>
          <section className="docs-section"><h2>Before you confirm.</h2><p>Enter the amount you pay, wait for the quote, and check the estimated amount received, minimum output, fee, and trade impact. A quote can change before the transaction lands. Curve buys in the first seconds after launch carry an additional opening tax; the panel refreshes those quotes quickly.</p><p>Some markets limit a wallet's net curve purchases. The panel shows remaining capacity when that limit applies; selling to the curve frees capacity.</p></section>
          <aside className="docs-note"><strong>USD is a display estimate.</strong><p>The wallet transaction uses ETH, WETH, or the market token. Dollar values use the current ETH/USD rate and are not the settlement asset.</p></aside>
        </>
      );
    case "graduation":
      return (
        <>
          <section className="docs-section"><h2>Three states to watch.</h2><div className="docs-steps docs-steps-vertical"><div><span>01</span><strong>Curve complete</strong><p>The curve sells out and trading pauses while the market is ready to graduate.</p></div><div><span>02</span><strong>Pool seeded</strong><p>Anyone can call graduation. WETH and reserved tokens seed a volatile Icarus pool at the curve's closing price.</p></div><div><span>03</span><strong>Open trading</strong><p>The pool becomes the venue. Curveball locks its LP position permanently, routes its fees through the escrow, and burns tokens not used in the pool.</p></div></div></section>
          <section className="docs-section"><h2>If graduation stalls.</h2><p>After seven days, an overdue market can abort graduation. Curve trading resumes, and the market can graduate after a later sellout. The market page shows its current status and available actions.</p></section>
          <aside className="docs-note"><strong>Target and progress are market specific.</strong><p>Read the graduation target and curve progress on the market page. A change to a future-market default does not rewrite existing markets.</p></aside>
        </>
      );
    case "fees":
      return (
        <>
          <section className="docs-section"><h2>Where value goes.</h2><div className="docs-two-up"><div><span className="docs-overline">Launch</span><h3>Anti-spam fee</h3><p>A launch fee is paid in WETH and sent to the protocol treasury. The launch review shows the exact amount and a USD estimate.</p></div><div><span className="docs-overline">Curve trades</span><h3>Trading fee and creator tax</h3><p>The market's fee and any creator tax are shown in the trade panel. An additional opening tax applies to buys during the first few seconds after launch.</p></div><div><span className="docs-overline">After graduation</span><h3>Pool fees</h3><p>Icarus sets its pool swap fee. Curveball's locked LP earns its share, which flows through the fee escrow.</p></div><div><span className="docs-overline">Distribution</span><h3>Creator, protocol, buyback</h3><p>Escrow splits eligible fees among the creator, protocol treasury, and shared buyback treasury. The market page shows its split.</p></div></div></section>
          <section className="docs-section"><h2>Claiming creator fees.</h2><p>Creators can claim available WETH fees through the market page. Claims are wallet transactions; the button shows the exact token amount to receive. Buyback funds are used to buy and burn the selected graduated CURVE token when that program is active.</p></section>
        </>
      );
    case "pulse":
      return (
        <>
          <section className="docs-section"><h2>Activity with context.</h2><p>Pulse shows recent market activity and the trades of wallets you follow. Follow a trader to bring their activity into the Following view. Profiles show holdings, trades, launches, and performance derived from indexed market events.</p><div className="docs-two-up"><div><span className="docs-overline">Identity</span><h3>Wallet first</h3><p>A profile belongs to a wallet. If that wallet has an active primary .rise name, Curveball shows it; otherwise the shortened wallet address appears.</p></div><div><span className="docs-overline">Participation</span><h3>Follow and react</h3><p>Signing in lets a wallet follow traders and add context to its own trades. Public market activity remains visible even when a trader has not signed in.</p></div></div></section>
          <aside className="docs-note"><strong>A .rise name is a primary-name record.</strong><p>Owning a name alone does not select it as your wallet's primary name. Set or update that record with the name provider, then allow the app's name cache to refresh.</p></aside>
        </>
      );
    case "contracts":
      return (
        <>
          {documentedNetworks.map((network) => (
            <section className="docs-section docs-network" key={network.chainId}>
              <span className="docs-overline">Chain ID {network.chainId}</span>
              <h2>{network.name}</h2>
              <p>Curveball protocol deployments</p>
              <ContractList contracts={network.protocol} explorer={network.explorer} />
              <h3>External contracts used by Curveball</h3>
              <ContractList contracts={network.dependencies} explorer={network.explorer} />
              {network.exampleMarket.length > 0 && (
                <>
                  <h3>Recorded test market</h3>
                  <ContractList contracts={network.exampleMarket} explorer={network.explorer} />
                </>
              )}
            </section>
          ))}
          <aside className="docs-note">
            <strong>Market contracts have their own addresses.</strong>
            <p>Each created token and graduated pool is deployed separately. Open a market page to follow its token, pool, and transaction links. The testnet deployment is an earlier release and has a Holder reserve instead of a Buyback treasury.</p>
          </aside>
        </>
      );
    case "safety":
      return (
        <>
          <section className="docs-section"><h2>Check before signing.</h2><ol className="docs-numbered"><li><strong>Confirm the network.</strong><span>Curveball runs on {activeChain.name}. A wallet prompt on a different network is not the market transaction shown here.</span></li><li><strong>Read the token amounts.</strong><span>USD figures are estimates using the current ETH/USD rate. Wallet prompts and claims use exact ETH, WETH, or token amounts.</span></li><li><strong>Review the market state.</strong><span>Prices move, quotes expire, and liquidity may change. Check the minimum received and current fee again before confirming.</span></li></ol></section>
          <section className="docs-section docs-split"><div><h2>Verify the contract.</h2></div><div><p>Use the explorer to inspect transactions and contracts. The launchpad address is shown in the site footer.</p>{launchpadAddress ? <a href={`${activeExplorerUrl}/address/${launchpadAddress}`} target="_blank" rel="noreferrer">View the launchpad on the explorer ↗</a> : null}<p><AppLink route="docsPage" params={{ slug: "contracts" }} navigate={navigate}>See all deployed contracts ↗</AppLink></p><p><a href="https://portfolio.0xguard.com/784" target="_blank" rel="noreferrer">Read the 0xGuard audit ↗</a></p></div></section>
        </>
      );
  }
}

export function DocsPage({ navigate, slug }: { navigate: Navigate; slug?: string }) {
  const chapterIndex = chapters.findIndex((chapter) => chapter.slug === (slug ?? null));
  if (chapterIndex < 0)
    return (
      <main className="docs-not-found wrap">
        <span className="docs-overline">Documentation</span>
        <h1>That page is not here.</h1>
        <p>Choose a topic from the documentation home.</p>
        <AppLink route="docs" navigate={navigate}>Browse docs ↗</AppLink>
      </main>
    );

  const chapter = chapters[chapterIndex];
  const previous = chapters[chapterIndex - 1];
  const next = chapters[chapterIndex + 1];

  return (
    <main className="docs-page wrap">
      <nav className="docs-breadcrumb" aria-label="Breadcrumb">
        <AppLink route="landing" navigate={navigate}>Curveball</AppLink>
        <span aria-hidden="true">/</span>
        <DocLink chapter={chapters[0]} navigate={navigate}>Docs</DocLink>
        <span aria-hidden="true">/</span>
        <span aria-current="page">{chapter.label}</span>
      </nav>
      <div className="docs-layout">
        <aside className="docs-sidebar">
          <span className="docs-sidebar-label">Documentation</span>
          <nav aria-label="Documentation topics">
            {chapters.map((item, index) => (
              <DocLink
                key={item.slug ?? "start"}
                chapter={item}
                navigate={navigate}
                className={`docs-sidebar-link${index === chapterIndex ? " active" : ""}`}
                active={index === chapterIndex}
              >
                <span>{String(index + 1).padStart(2, "0")}</span>
                {item.label}
              </DocLink>
            ))}
          </nav>
          <AppLink className="docs-sidebar-app" route="markets" navigate={navigate}>
            Explore markets <span aria-hidden="true">↗</span>
          </AppLink>
        </aside>
        <article className="docs-article">
          <header className="docs-article-header">
            <span className="docs-overline">Curveball docs · {String(chapterIndex + 1).padStart(2, "0")}</span>
            <h1>{chapter.title}</h1>
            <p>{chapter.lead}</p>
            {chapterIndex === 0 && (
              <AppLink className="docs-hero-cta" route="markets" navigate={navigate}>
                Explore markets <span aria-hidden="true">↗</span>
              </AppLink>
            )}
          </header>
          <div className="docs-article-body">
            <DocsContent slug={chapter.slug} navigate={navigate} />
          </div>
          <nav className="docs-pagination" aria-label="Documentation pages">
            {previous ? <DocLink chapter={previous} navigate={navigate} className="docs-pagination-link"><span>← Previous</span><strong>{previous.label}</strong></DocLink> : <span />}
            {next ? <DocLink chapter={next} navigate={navigate} className="docs-pagination-link next"><span>Next →</span><strong>{next.label}</strong></DocLink> : <span />}
          </nav>
        </article>
      </div>
    </main>
  );
}
