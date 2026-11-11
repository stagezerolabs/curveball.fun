import type { ReactNode } from "react";
import { AppLink } from "../components/Navigation";
import type { Navigate } from "../types";
import { documentedNetworks, type DocumentedContract } from "./docsContracts";

const chapters = [
  {
    slug: null,
    label: "Start here",
    description: "What Curveball is and where to begin.",
  },
  {
    slug: "trading",
    label: "Trading",
    description: "Understand quotes, funding, and the two venues.",
  },
  {
    slug: "graduation",
    label: "Graduation",
    description: "What happens when a curve sells out.",
  },
  {
    slug: "fees",
    label: "Fees & earnings",
    description: "Launch costs, trading fees, and creator claims.",
  },
  {
    slug: "contracts",
    label: "Contracts",
    description: "Protocol addresses on RISE Mainnet.",
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
          <section className="docs-section" aria-labelledby="docs-explore-title">
            <h1 id="docs-explore-title">Explore the documentation.</h1>
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
        </>
      );
    case "graduation":
      return (
        <>
          <section className="docs-section"><h2>Three states to watch.</h2><div className="docs-steps docs-steps-vertical"><div><span>01</span><strong>Curve complete</strong><p>The curve sells out and trading pauses while the market is ready to graduate.</p></div><div><span>02</span><strong>Pool seeded</strong><p>Anyone can call graduation. WETH and reserved tokens seed a volatile Icarus pool at the curve's closing price.</p></div><div><span>03</span><strong>Open trading</strong><p>The pool becomes the venue. Curveball locks its LP position permanently, routes its fees through the escrow, and burns tokens not used in the pool.</p></div></div></section>
          <section className="docs-section"><h2>If graduation stalls.</h2><p>After seven days, an overdue market can abort graduation. Curve trading resumes, and the market can graduate after a later sellout. The market page shows its current status and available actions.</p></section>
        </>
      );
    case "fees":
      return (
        <>
          <section className="docs-section"><h2>Where value goes.</h2><div className="docs-two-up"><div><span className="docs-overline">Launch</span><h3>Anti-spam fee</h3><p>A launch fee is paid in WETH and sent to the protocol treasury. The launch review shows the exact amount and a USD estimate.</p></div><div><span className="docs-overline">Curve trades</span><h3>Trading fee and creator tax</h3><p>The market's fee and any creator tax are shown in the trade panel. An additional opening tax applies to buys during the first few seconds after launch.</p></div><div><span className="docs-overline">After graduation</span><h3>Pool fees</h3><p>Icarus sets its pool swap fee. Curveball's locked LP earns its share, which flows through the fee escrow.</p></div><div><span className="docs-overline">Distribution</span><h3>Creator, protocol, buyback</h3><p>Escrow splits eligible fees among the creator, protocol treasury, and shared buyback treasury. The market page shows its split.</p></div></div></section>
          <section className="docs-section"><h2>Claiming creator fees.</h2><p>Creators can claim available WETH fees through the market page. Claims are wallet transactions; the button shows the exact token amount to receive. Buyback funds are used to buy and burn the selected graduated CURVE token when that program is active.</p></section>
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
            </section>
          ))}
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
        </aside>
        <article className="docs-article">
          {chapterIndex > 0 && <h1 className="visually-hidden">{chapter.label}</h1>}
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
