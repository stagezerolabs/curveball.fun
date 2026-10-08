type LaunchPreviewProps = {
  name: string;
  symbol: string;
  creatorTaxBps: number;
  initialBuy: string;
  imageUrl?: string;
  showV2Options: boolean;
};

export function LaunchPreview({ name, symbol, creatorTaxBps, initialBuy, imageUrl, showV2Options }: LaunchPreviewProps) {
  const displayName = name.trim() || "Your token";
  const displaySymbol = symbol.trim().replace(/^\$/, "").toUpperCase() || "TOKEN";
  const buy = Number(initialBuy);

  return (
    <aside className="launch-preview" aria-label="Live token preview">
      <div className="launch-preview-heading">
        <span>Preview</span>
      </div>
      <div className="launch-preview-card">
        <div className="launch-preview-art">
          {imageUrl ? <img src={imageUrl} alt="Selected token artwork preview" /> : (
            <svg viewBox="0 0 48 48" aria-hidden="true">
              <rect x="7" y="8" width="34" height="32" rx="3" />
              <circle cx="31" cy="18" r="3" />
              <path d="m8 34 10-10 8 8 5-5 10 10" />
            </svg>
          )}
        </div>
        <div className="launch-preview-body">
          <div className="launch-preview-name-row">
            <strong className="launch-preview-name">{displayName}</strong>
            <span className="launch-preview-dot" aria-hidden="true" />
          </div>
          <span className="launch-preview-symbol">${displaySymbol}</span>
          <span className="launch-preview-address">Address assigned at launch</span>
          <div className="launch-preview-market">
            <div><strong>—</strong><span>Market cap</span></div>
            <div><strong>—</strong><span>Bonding status</span></div>
          </div>
          <div className="launch-preview-progress" aria-hidden="true"><span /></div>
          <span className="launch-preview-progress-label">Available after launch</span>
          <div className="launch-preview-details">
            <div><span>Paired with</span><strong>WETH</strong></div>
            {showV2Options && <div><span>Creator tax</span><strong>{(creatorTaxBps / 100).toFixed(2)}%</strong></div>}
            {showV2Options && Number.isFinite(buy) && buy > 0 && <div><span>Initial buy</span><strong>{initialBuy} WETH</strong></div>}
          </div>
        </div>
      </div>
    </aside>
  );
}
