import { createElement, type ReactNode } from "react";
import { Button } from "@radix-ui/themes";
import { ArrowIcon } from "../components/ArrowIcon";
import { AppLink, RiseLogo } from "../components/Navigation";
import type { Navigate } from "../types";

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

      <section className="landing-steps wrap" aria-labelledby="landing-steps-title">
        <h2 id="landing-steps-title" className="visually-hidden">How Curveball works</h2>
        <article>
          <span>01</span>
          <h3>Launch</h3>
          <p>Create a token. Its starting price follows the curve.</p>
        </article>
        <article>
          <span>02</span>
          <h3>Trade</h3>
          <p>Every buy and sell moves the price on-chain.</p>
        </article>
        <article>
          <span>03</span>
          <h3>Graduate</h3>
          <p>When the target is met, trading moves to open liquidity.</p>
        </article>
      </section>

    </main>
  );
}
