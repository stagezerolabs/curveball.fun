import { createElement, useEffect, useRef, type ReactNode } from "react";
import { Button } from "@radix-ui/themes";
import { ArrowIcon } from "../components/ArrowIcon";
import { AppLink, RiseLogo } from "../components/Navigation";
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
    <Button asChild size="3" className="radix-action landing-cta-button">
      <AppLink route={route} navigate={navigate}>
        {children} <ArrowIcon />
      </AppLink>
    </Button>
  );
}

export function LandingPage({ navigate }: { navigate: Navigate }) {
  const storyRef = useRef<HTMLElement>(null);
  const progressRef = useRef<HTMLSpanElement>(null);

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
    <main className="landing-page">
      <section className="landing-hero wrap">
        <div className="landing-hero-copy">
          <div className="eyebrow landing-rise-eyebrow">
            Built on <RiseLogo />
          </div>
          <h1>
            Launch on the <em>curve.</em>
          </h1>
          <p className="landing-lede">
            Discover projects launching on RISE. Explore live markets and
            support the ones you care about.
          </p>
          <div className="landing-actions">
            <ActionLink route="markets" navigate={navigate}>
              Explore markets
            </ActionLink>
            <AppLink
              className="landing-secondary-button"
              route="launch"
              navigate={navigate}
            >
              Create a token
            </AppLink>
          </div>
        </div>

        {createElement("ascii-art", {
          piece: "planet",
          label: "Animated ringed planet",
        })}
      </section>

      <section
        className="landing-story"
        aria-labelledby="landing-steps-title"
        ref={storyRef}
      >
        <h2 id="landing-steps-title" className="landing-story-title">
          <span>One curve.</span>
          <em>Open to everyone.</em>
        </h2>
        <div className="landing-story-progress" aria-hidden="true">
          <span ref={progressRef} />
        </div>
        <div className="landing-steps">
          <article>
            <span className="landing-step-number">01</span>
            <h3>Launch</h3>
            <p>Start on the curve.</p>
          </article>
          <article>
            <span className="landing-step-number">02</span>
            <h3>Trade</h3>
            <p>Let the market move.</p>
          </article>
          <article>
            <span className="landing-step-number">03</span>
            <h3>Graduate</h3>
            <p>Enter open liquidity.</p>
          </article>
        </div>
      </section>
    </main>
  );
}
