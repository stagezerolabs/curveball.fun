import { formatUnits } from "viem";

type LaunchPreviewProps = {
  name: string;
  symbol: string;
  creatorTaxBps: number;
  initialBuy: string;
  imageUrl?: string;
  supply?: bigint;
  curveSupply?: bigint;
  reserveBps: number;
  supplyUnavailable: boolean;
  version: string;
};

function formatSupply(supply: bigint) {
  const [whole, fraction = ""] = formatUnits(supply, 18).split(".");
  const decimal = fraction.replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${decimal ? `.${decimal}` : ""}`;
}

export function LaunchPreview({ name, symbol, creatorTaxBps, initialBuy, imageUrl, supply, curveSupply, reserveBps, supplyUnavailable, version }: LaunchPreviewProps) {
  const displayName = name.trim() || "Your token";
  const displaySymbol = symbol.trim().replace(/^\$/, "").toUpperCase() || "TOKEN";
  const buy = Number(initialBuy);
  const showTax = creatorTaxBps > 0;
  const showBuy = Number.isFinite(buy) && buy > 0;
  const reserved = supply != null && Number.isInteger(reserveBps) && reserveBps >= 0 && reserveBps <= 500 ? supply * BigInt(reserveBps) / 10_000n : null;
  const pool = supply != null && curveSupply != null && reserved != null ? supply - curveSupply - reserved : null;
  const showAllocation = curveSupply != null && reserved != null && pool != null;

  return (
    <aside className="launch-preview" aria-label="Token preview">
      <div className="launch-preview-heading">
        <span>Preview · {version}</span>
      </div>
      <div className={`launch-preview-card${showTax || showBuy || showAllocation ? " has-options" : ""}`}>
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
          <strong className="launch-preview-name">{displayName}</strong>
          <span className="launch-preview-symbol">${displaySymbol}</span>
          <div className="launch-preview-facts">
            <div>
              <span>Fixed supply</span>
              <strong>{supply == null ? supplyUnavailable ? "Unavailable" : "Loading…" : formatSupply(supply)}</strong>
            </div>
            <div><span>Paired with</span><strong>WETH</strong></div>
          </div>
          {(showTax || showBuy || showAllocation) && <div className="launch-preview-details">
            {showAllocation && <div><span>Curve sale</span><strong>{formatSupply(curveSupply)}</strong></div>}
            {showAllocation && <div><span>Holder reserve</span><strong>{formatSupply(reserved)}</strong></div>}
            {showAllocation && <div><span>Graduation pool</span><strong>{formatSupply(pool)}</strong></div>}
            {showTax && <div><span>Creator tax</span><strong>{(creatorTaxBps / 100).toFixed(2)}%</strong></div>}
            {showBuy && <div><span>Initial buy</span><strong>{initialBuy} WETH</strong></div>}
          </div>}
        </div>
      </div>
    </aside>
  );
}
