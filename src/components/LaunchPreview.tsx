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
          {imageUrl ? <img src={imageUrl} alt="Selected token artwork preview" /> : <span aria-hidden="true">{displaySymbol.slice(0, 1)}</span>}
        </div>
        <div className="launch-preview-body">
          <strong className="launch-preview-name">{displayName}</strong>
          <span className="launch-preview-symbol">${displaySymbol}</span>
          <div className="launch-preview-details">
            <div><span>Paired with</span><strong>WETH</strong></div>
            {showV2Options && <div><span>Creator tax</span><strong>{(creatorTaxBps / 100).toFixed(2)}%</strong></div>}
            {showV2Options && Number.isFinite(buy) && buy > 0 && <div><span>Initial buy</span><strong>{initialBuy} WETH</strong></div>}
          </div>
        </div>
      </div>
      <p>This shows how your token will appear. Market cap and bonding status appear after launch.</p>
    </aside>
  );
}
