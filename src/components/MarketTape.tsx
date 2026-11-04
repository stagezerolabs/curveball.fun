import type { ReactNode } from "react";

export type CurveTapeDisplay = {
  volume24h: string;
  bought24h: string;
  burnedTotal: string;
};

function CurveStats({ stats }: { stats?: CurveTapeDisplay }) {
  return (
    <>
      <span className="market-snapshot market-snapshot-curve">
        <span>$CURVE</span>
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="m2 12 5-5 3 3 6-6m0 0h-4m4 0v4" />
        </svg>
        <span>Volume</span>
        <strong>{stats?.volume24h ?? "—"}</strong>
        <span>24h</span>
      </span>
      <span className="market-snapshot market-snapshot-curve">
        <span>$CURVE Bought</span>
        <strong>{stats?.bought24h ?? "—"}</strong>
        <span>24h</span>
      </span>
      <span className="market-snapshot market-snapshot-curve">
        <span>$CURVE Burned</span>
        <strong>{stats?.burnedTotal ?? "—"}</strong>
        <span>total</span>
      </span>
    </>
  );
}

export function MarketTape({
  renderMarkets,
  curveStats,
}: {
  renderMarkets?: (interactive: boolean) => ReactNode;
  curveStats?: CurveTapeDisplay;
}) {
  return (
    <aside
      className={`market-snapshot-ticker${renderMarkets ? " has-markets" : ""}`}
      aria-label={renderMarkets ? "CURVE and market stats" : "CURVE token stats"}
      title="CURVE preview using SMOKE token data on RISE Testnet"
    >
      <div className="market-snapshot-track">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="market-snapshot-group"
            aria-hidden={index > 0 ? true : undefined}
            key={index}
          >
            <CurveStats stats={curveStats} />
            {renderMarkets?.(index === 0)}
          </div>
        ))}
      </div>
    </aside>
  );
}
