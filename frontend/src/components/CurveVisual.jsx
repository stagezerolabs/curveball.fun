export function CurveVisual() {
  return (
    <div className="curve-visual" aria-label="Illustration of a bonding curve">
      <div className="visual-label">
        <span>Bonding curve</span>
        <strong>Curve model</strong>
      </div>
      <svg viewBox="0 0 560 410" role="img" aria-hidden="true">
        <defs>
          <linearGradient id="area" x1="0" y1="0" x2="0" y2="1">
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
        <circle className="pulse" cx="400" cy="165" r="18" />
      </svg>
      <div className="floating-stat price-stat">
        <span>Illustrative price</span>
        <strong>0.0048 ETH</strong>
        <small>+18.6%</small>
      </div>
      <div className="floating-stat cap-stat">
        <span>Example progress</span>
        <strong>68%</strong>
      </div>
    </div>
  );
}
