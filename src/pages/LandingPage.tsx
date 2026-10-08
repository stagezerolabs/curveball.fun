import type { PointerEvent, ReactNode } from "react";
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

function moveCurveVisual(event: PointerEvent<HTMLDivElement>) {
  if (event.pointerType !== "mouse") return;

  const visual = event.currentTarget;
  const bounds = visual.getBoundingClientRect();
  const x = (event.clientX - bounds.left) / bounds.width;
  const y = (event.clientY - bounds.top) / bounds.height;

  visual.style.setProperty("--curve-tilt-x", `${(0.5 - y) * 7}deg`);
  visual.style.setProperty("--curve-tilt-y", `${(x - 0.5) * 9}deg`);
  visual.style.setProperty("--curve-pointer-x", `${x * 100}%`);
  visual.style.setProperty("--curve-pointer-y", `${y * 100}%`);
  visual.classList.add("is-tilting");
}

function resetCurveVisual(event: PointerEvent<HTMLDivElement>) {
  const visual = event.currentTarget;
  visual.style.setProperty("--curve-tilt-x", "0deg");
  visual.style.setProperty("--curve-tilt-y", "0deg");
  visual.style.setProperty("--curve-pointer-x", "72%");
  visual.style.setProperty("--curve-pointer-y", "18%");
  visual.classList.remove("is-tilting");
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
            Create a token on an open bonding curve. Trading starts immediately;
            graduation follows demand.
          </p>
          <div className="landing-actions">
            <ActionLink route="launch" navigate={navigate}>
              Create a token
            </ActionLink>
          </div>
        </div>

        <div
          className="curve-visual"
          role="group"
          aria-label="Illustrative CURVE market snapshot"
          onPointerMove={moveCurveVisual}
          onPointerLeave={resetCurveVisual}
        >
          <div className="visual-label">
            <span className="curve-market-token">
              <img
                src="https://api.dicebear.com/10.x/loops/svg?seed=CURVE"
                alt=""
              />
              <span>
                <strong>$CURVE</strong>
                <small>0xC0DE…B411</small>
              </span>
            </span>
          </div>
          <svg viewBox="0 0 560 410" role="img" aria-hidden="true">
            <defs>
              <linearGradient id="landing-area" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#fe5d26" stopOpacity=".34" />
                <stop offset="1" stopColor="#fe5d26" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path
              className="grid-line"
              d="M20 330H540M20 250H540M20 170H540M20 90H540"
            />
            <path
              className="curve-area"
              d="M20 344C150 344 238 318 307 267S420 113 540 55V370H20Z"
            />
            <path
              className="curve-line"
              d="M20 344C150 344 238 318 307 267S420 113 540 55"
            />
            <circle cx="400" cy="165" r="9" />
          </svg>
        </div>
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
