import {
  createElement,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { ArrowIcon } from "../components/ArrowIcon";
import { AppLink, RiseLogo } from "../components/Navigation";
import { LandingProtocolStats } from "../components/LandingProtocolStats";
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
    <AppLink
      className="action-button landing-cta-button"
      route={route}
      navigate={navigate}
    >
      {children} <ArrowIcon />
    </AppLink>
  );
}

export function LandingPage({ navigate }: { navigate: Navigate }) {
  const pageRef = useRef<HTMLElement>(null);
  const storyRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);
  const [burst, setBurst] = useState(false);

  useEffect(() => {
    const page = pageRef.current;
    if (
      !page ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !("IntersectionObserver" in window)
    )
      return;
    const elements = page.querySelectorAll<HTMLElement>(".landing-reveal");
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.12, rootMargin: "0px 0px -40px 0px" },
    );
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
        Math.min(
          1,
          (start - story.getBoundingClientRect().top) / (start - end),
        ),
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
            Discover projects launching on{" "}
            <span className="landing-inline-rise">
              <span className="visually-hidden">RISE</span>
              <RiseLogo />
            </span>
            <br />
            Explore live markets and support the ones you care about.
          </p>
          <div className="landing-actions">
            <ActionLink route="markets" navigate={navigate}>
              Launch app
            </ActionLink>
            <a className="landing-secondary-button" href="#landing-faq-title">
              Read the docs
            </a>
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
          {burst && (
            <span className="landing-story-confetti">
              {Array.from({ length: 9 }, (_, index) => (
                <i
                  key={index}
                  onAnimationEnd={
                    index === 0 ? () => setBurst(false) : undefined
                  }
                />
              ))}
            </span>
          )}
        </div>
        <div className="landing-steps">
          <article>
            <span className="landing-step-number">01</span>
            <h3>Launch</h3>
            <p>
              Name your token, choose a ticker, and launch it on its own curve.
            </p>
          </article>
          <article>
            <span className="landing-step-number">02</span>
            <h3>Trade</h3>
            <p>
              Buy and sell as the market cap moves. Creators can earn a share of
              trading fees.
            </p>
          </article>
          <article>
            <span className="landing-step-number">03</span>
            <h3>Graduate</h3>
            <p>
              When the curve sells out, liquidity moves to that market's
              selected venue.
            </p>
          </article>
        </div>
      </section>

      <section
        className="landing-section landing-faq wrap"
        aria-labelledby="landing-faq-title"
      >
        <div className="landing-section-heading landing-reveal">
          <span className="landing-section-kicker">Good to know</span>
          <h2 id="landing-faq-title">The basics, at a glance.</h2>
        </div>
        <div className="landing-faq-list landing-reveal">
          <details>
            <summary>How does the market work?</summary>
            <p>
              Each token starts on its own curve. Buyers trade WETH for tokens,
              sellers trade tokens for WETH, and the market cap moves with each
              trade. Market progress shows how much of the curve supply has
              sold.
            </p>
          </details>
          <details>
            <summary>What do creators choose at launch?</summary>
            <p>
              A name, ticker, artwork, and optional initial buy. The launch form
              shows any creator tax and launch fee before your wallet confirms.
            </p>
          </details>
          <details>
            <summary>Where do trading fees go?</summary>
            <p>
              Curve fees are split between the creator, buyback vault, and
              protocol treasury. Each market shows its exact fee and split;
              buybacks happen separately from trades.
            </p>
          </details>
          <details>
            <summary>What happens after the curve sells out?</summary>
            <p>
              Bonding completes and the backend keeper prepares the venue pool.
              Remaining tokens and WETH move to the venue selected when the
              token launched. The pool address appears on the market page after
              confirmation, and trading continues in the Icarus pool.
            </p>
          </details>
          <details>
            <summary>Do I need WETH to buy or launch?</summary>
            <p>
              Curve markets use WETH. The app can wrap ETH for a buy or a paid
              launch and will ask for wallet approval when required. Keep some
              ETH for network gas.
            </p>
          </details>
        </div>
      </section>

      <section
        className="landing-section landing-final wrap"
        aria-labelledby="landing-final-title"
      >
        <div className="landing-reveal">
          <h2 id="landing-final-title">Ready to follow a curve?</h2>
        </div>
        <div className="landing-actions landing-reveal">
          <ActionLink route="markets" navigate={navigate}>
            Launch app
          </ActionLink>
          <a className="landing-secondary-button" href="#landing-faq-title">
            Read the docs
          </a>
        </div>
      </section>
    </main>
  );
}
