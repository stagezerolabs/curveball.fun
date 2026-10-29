const mockCurveStats = {
  volume24hUsd: "$48.6K",
  bought24hCurve: "122.8K",
  burnedCurve: "13.7K",
};

export function MarketTape() {
  const items = (
    <>
      <span className="market-snapshot">
        <span>$CURVE</span>
        <svg viewBox="0 0 18 18" fill="none" aria-hidden="true">
          <path d="m2 12 5-5 3 3 6-6m0 0h-4m4 0v4" />
        </svg>
        <span>Volume</span>
        <strong>{mockCurveStats.volume24hUsd}</strong>
        <span>24h</span>
      </span>
      <span className="market-snapshot">
        <span>$CURVE Bought</span>
        <strong>{mockCurveStats.bought24hCurve}</strong>
        <span>24h</span>
      </span>
      <span className="market-snapshot">
        <span>$CURVE Burned</span>
        <strong>{mockCurveStats.burnedCurve}</strong>
        <span>total</span>
      </span>
    </>
  );

  return (
    <aside className="market-snapshot-ticker" aria-label="CURVE token stats">
      <div className="market-snapshot-track">
        {Array.from({ length: 4 }, (_, index) => (
          <div
            className="market-snapshot-group"
            aria-hidden={index > 0 ? true : undefined}
            key={index}
          >
            {items}
          </div>
        ))}
      </div>
    </aside>
  );
}
