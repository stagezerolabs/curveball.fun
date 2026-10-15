import { createElement, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowIcon } from "../components/ArrowIcon";
import { AppLink, RiseLogo } from "../components/Navigation";
import { LandingProtocolStats } from "../components/LandingProtocolStats";
import { activeChainId } from "../lib/web3";
import { RISE_TESTNET_CHAIN_ID } from "../sdk/curveballSdk";
import type { Navigate } from "../types";

let storyProgressComplete = false;

function ActionLink({
  route,
  navigate,
  children,
}: {
  route: string;
  navigate: Navigate;
  children: ReactNode;
}) {
  return (
    <AppLink className="action-button landing-cta-button" route={route} navigate={navigate}>
      {children} <ArrowIcon />
    </AppLink>
  );
}

export function LandingPage({ navigate }: { navigate: Navigate }) {
  const isTestnet = activeChainId === RISE_TESTNET_CHAIN_ID;
  const pageRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    const page = pageRef.current;
    if (!page || window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("IntersectionObserver" in window)) return;
    const elements = page.querySelectorAll<HTMLElement>(".landing-reveal");
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    }, { threshold: 0.12, rootMargin: "0px 0px -40px 0px" });
    elements.forEach((element) => observer.observe(element));
    page.classList.add("motion-ready");
    return () => {
      observer.disconnect();
      page.classList.remove("motion-ready");
    };
  }, []);

  useEffect(() => {
    const story = storyRef.current;
    const progress = progressRef.current;
    if (!story || !progress) return;
    if (storyProgressComplete) {
      progress.style.setProperty("--landing-progress", "1");
      return;
    }
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame: number | null = null;
    const updateProgress = () => {
      frame = null;
      const start = window.innerHeight * 0.28;
      const end = -window.innerHeight * 0.06;
      const amount = Math.max(
        0,
        Math.min(1, (start - story.getBoundingClientRect().top) / (start - end)),
      );
      progress.style.setProperty("--landing-progress", String(amount));
      if (amount === 1) {
        storyProgressComplete = true;
        setBurst(true);
        window.removeEventListener("scroll", scheduleUpdate);
        window.removeEventListener("resize", scheduleUpdate);
      }
    };
    const scheduleUpdate = () => {
      if (frame === null) frame = window.requestAnimationFrame(updateProgress);
    };

    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    updateProgress();
    return () => {
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <main className="landing-page" ref={pageRef}>
      <section className="landing-hero wrap">
        <div className="landing-hero-copy">
          <h1>
            Launch on the <em>curve.</em>
          </h1>
          <p className="landing-lede">
            Discover projects launching on <span className="landing-inline-rise"><span className="visually-hidden">RISE</span><RiseLogo /></span><br />Explore live markets and
            support the ones you care about.
          </p>
          <div className="landing-actions">
            <ActionLink route="markets" navigate={navigate}>
              Launch app
            </ActionLink>
            <AppLink
              className="landing-secondary-button"
              route="stats"
              navigate={navigate}
            >
              Check stats
            </AppLink>
          </div>
        </div>

        {createElement("ascii-art", {
          piece: "planet",
          label: "Animated ringed planet",
        })}
      </section>

      <LandingProtocolStats />

      <section
        className="landing-story"
        aria-labelledby="landing-steps-title"
        ref={storyRef}
      >
        <h2 id="landing-steps-title" className="landing-story-title">
          <span>Many curves.</span>
          <em>Open to everyone.</em>
        </h2>
        <div className="landing-story-progress" aria-hidden="true">
          <span className="landing-story-progress-fill" ref={progressRef} />
          {burst && <span className="landing-story-confetti">
            {Array.from({ length: 9 }, (_, index) => <i key={index} onAnimationEnd={index === 0 ? () => setBurst(false) : undefined} />)}
          </span>}
        </div>
        <div className="landing-steps">
          <article>
            <span className="landing-step-number">01</span>
            <h3>Launch</h3>
            <p>Name your token, choose a ticker, and launch it on its own curve.</p>
          </article>
          <article>
            <span className="landing-step-number">02</span>
            <h3>Trade</h3>
            <p>Buy and sell as the price moves. Creators can earn a share of trading fees.</p>
          </article>
          <article>
            <span className="landing-step-number">03</span>
            <h3>Graduate</h3>
            <p>When the curve sells out, liquidity moves to an open pool so trading can continue.</p>
          </article>
        </div>
      </section>

      <section className="landing-section landing-curve wrap" aria-labelledby="landing-curve-title">
        <div className="landing-section-heading landing-reveal">
          <span className="landing-section-kicker">The market</span>
          <h2 id="landing-curve-title">What happens on the curve?</h2>
          <p>Each token starts in its own market. Buyers put in WETH and receive tokens; sellers return tokens for WETH. The curve sets the quote for each trade, so the price changes as the balance of tokens and WETH changes.</p>
        </div>
        <div className="landing-curve-notes landing-reveal">
          <div>
            <span>01 / Price</span>
            <p>Buying moves the price up the curve. Selling moves it back down. A quote is a snapshot, so the final execution also depends on the trade size and slippage limit.</p>
          </div>
          <div>
            <span>02 / Progress</span>
            <p>The percentage on a market shows how much of its curve supply has sold. It is a path toward graduation, not a return estimate or a promise that the token will rise.</p>
          </div>
          <div>
            <span>03 / Market cap</span>
            <p>Market cap is an estimate based on the current token price and total supply. It is not the amount of WETH in the curve or money available to withdraw.</p>
          </div>
        </div>
      </section>

      <section className="landing-section landing-launch-info" aria-labelledby="landing-launch-title">
        <div className="wrap landing-info-layout">
          <div className="landing-section-heading landing-reveal">
            <span className="landing-section-kicker">For creators</span>
            <h2 id="landing-launch-title">A launch starts with a few choices.</h2>
            <p>Choose a name and ticker, add artwork, and decide whether to make an initial buy. The launch page publishes your artwork and metadata before asking your wallet to confirm the onchain transaction.</p>
            <AppLink className="text-link" route="launch" navigate={navigate}>See the launch form <span aria-hidden="true">→</span></AppLink>
          </div>
          <dl className="landing-info-list landing-reveal">
            <div><dt>Name, ticker & artwork</dt><dd>These identify your token in markets. Check them before confirming; the launch records its metadata onchain.</dd></div>
            <div><dt>Creator tax</dt><dd>Optional and shown in the form. It is separate from the trading fee, and the factory limits how high it can be.</dd></div>
            <div><dt>Launch fee</dt><dd>{isTestnet ? "The current testnet factory charges 0.0004 WETH for each launch. " : "This factory may charge a launch fee. "}The form reads the fee from the contract and shows the total before you submit.</dd></div>
            <div><dt>Wallet confirmation</dt><dd>Your wallet signs the launch. If needed, the app also asks to wrap ETH or approve WETH for the fee and any initial buy.</dd></div>
          </dl>
        </div>
      </section>

      <section className="landing-section landing-fees wrap" aria-labelledby="landing-fees-title">
        <div className="landing-section-heading landing-reveal">
          <span className="landing-section-kicker">Trading fees</span>
          <h2 id="landing-fees-title">Every market shows where its fees go.</h2>
          <p>Curve trades charge a fee on the WETH side. The factory records that market’s fee and split when the token launches, so later changes to factory defaults do not rewrite an existing market. Open a market to see its exact values.</p>
        </div>
        <div className="landing-fee-path landing-reveal" aria-label="Trading fee destinations">
          <article><span>01</span><h3>Creator</h3><p>The creator’s share accrues for the wallet recorded at launch.</p></article>
          <article><span>02</span><h3>Buyback vault</h3><p>A share funds controlled purchases of that market’s token. A fee contribution does not mean an instant buyback on every trade.</p></article>
          <article><span>03</span><h3>Protocol treasury</h3><p>The remaining share goes to the market’s recorded treasury.</p></article>
        </div>
        <p className="landing-section-note">The one-time launch fee is separate from curve trading fees. Pool trading after graduation has its own venue fee.</p>
      </section>

      <section className="landing-section landing-graduation" aria-labelledby="landing-graduation-title">
        <div className="wrap landing-info-layout">
          <div className="landing-section-heading landing-reveal">
            <span className="landing-section-kicker">After the curve</span>
            <h2 id="landing-graduation-title">Sold out is a milestone, not the end.</h2>
            <p>When the curve supply sells out, anyone can start the graduation process. The factory checks that a suitable Icarus pool can be created, then moves the remaining token supply and available WETH into that pool.</p>
          </div>
          <div className="landing-graduation-detail landing-reveal">
            <h3>What changes for holders?</h3>
            <p>Once the pool is created, the market is marked graduated and trading continues through Icarus. Its liquidity position is held by the protocol locker, while pool fees are routed to the creator, treasury, and buyback vault.</p>
            <h3>What if the pool is not ready?</h3>
            <p>Graduation can be deferred if the pool checks fail. The market stays on the curve and can be retried. The market page shows when graduation is pending or complete.</p>
            <AppLink className="text-link" route="markets" navigate={navigate}>Explore market progress <span aria-hidden="true">→</span></AppLink>
          </div>
        </div>
      </section>

      <section className="landing-section landing-faq wrap" aria-labelledby="landing-faq-title">
        <div className="landing-section-heading landing-reveal">
          <span className="landing-section-kicker">Good to know</span>
          <h2 id="landing-faq-title">Questions before you trade or launch.</h2>
        </div>
        <div className="landing-faq-list landing-reveal">
          <details><summary>Can I sell before graduation?</summary><p>Yes, while the curve is trading, you can sell tokens back into it. A sold-out curve stops new buys while graduation is prepared; check the market page for its current state and available actions.</p></details>
          <details><summary>Do I need WETH to buy or launch?</summary><p>Curve markets use WETH. The app can wrap ETH for a buy or a paid launch and will ask for wallet approval when required. Keep some ETH for network gas.</p></details>
          <details><summary>Can a creator change the token supply or fee split later?</summary><p>No. The token has a fixed supply, and the market’s fee settings are recorded at launch. The creator does not control minting, reserves, or graduation.</p></details>
          <details><summary>Can a creator withdraw the graduated pool’s liquidity?</summary><p>No. The pool’s liquidity position is minted to the protocol locker, not the creator’s wallet. The creator can receive their recorded share of trading fees.</p></details>
          <details><summary>When does the buyback happen?</summary><p>Fees first accrue to the buyback vault. A separate transaction can use those funds under the vault’s price and impact limits; it is not automatic on each trade.</p></details>
          <details><summary>How do creators receive trading fees?</summary><p>Curve fees accrue for the recorded creator and can be claimed through the market page. After graduation, anyone can trigger a pool fee claim, but the funds still go to the recorded recipients.</p></details>
        </div>
      </section>

      <section className="landing-section landing-final wrap" aria-labelledby="landing-final-title">
        <div className="landing-reveal">
          <span className="landing-section-kicker">{isTestnet ? "RISE Testnet" : "RISE"}</span>
          <h2 id="landing-final-title">Ready to follow a curve?</h2>
          <p>{isTestnet ? "Curveball currently runs on RISE Testnet. Tokens and balances here are for testing, and activity is not real income. Explore a market’s live details before making a trade." : "Explore the live markets and read each market’s fee and graduation details before making a trade."}</p>
        </div>
        <div className="landing-actions landing-reveal">
          <ActionLink route="markets" navigate={navigate}>Launch app</ActionLink>
          <AppLink className="landing-secondary-button" route="stats" navigate={navigate}>Check stats</AppLink>
        </div>
      </section>
    </main>
  );
}
