import { useState } from "react";
import { formatUnits } from "viem";
import { FlipCard } from "./FlipCard";

type LaunchPreviewProps = {
  name: string;
  symbol: string;
  creatorTaxBps: number;
  walletCapBps?: number;
  buybackShareBps?: number;
  buybackUnavailable: boolean;
  imageUrl?: string;
  onChooseImage: () => void;
  onRemoveImage: () => void;
  supply?: bigint;
  curveSupply?: bigint;
  supplyUnavailable: boolean;
};

function formatSupply(supply: bigint) {
  const [whole, fraction = ""] = formatUnits(supply, 18).split(".");
  const decimal = fraction.replace(/0+$/, "");
  return `${BigInt(whole).toLocaleString("en-US")}${decimal ? `.${decimal}` : ""}`;
}

export function LaunchPreview({
  name,
  symbol,
  creatorTaxBps,
  walletCapBps,
  buybackShareBps,
  buybackUnavailable,
  imageUrl,
  onChooseImage,
  onRemoveImage,
  supply,
  curveSupply,
  supplyUnavailable,
}: LaunchPreviewProps) {
  const [artworkShown, setArtworkShown] = useState(true);
  const displayName = name.trim() || "Your token";
  const displaySymbol =
    symbol.trim().replace(/^\$/, "").toUpperCase() || "TOKEN";
  const pool =
    supply != null && supply > 0n && curveSupply != null
      ? ((supply - curveSupply) * curveSupply) / supply
      : null;
  const graduationBurn =
    supply != null && curveSupply != null && pool != null
      ? supply - curveSupply - pool
      : null;
  const showAllocation =
    curveSupply != null && pool != null && graduationBurn != null;

  return (
    <aside className="launch-preview" aria-label="Token preview">
      <div className="launch-preview-heading">
        <span>Preview</span>
        {imageUrl ? (
          <button
            type="button"
            className="launch-preview-remove"
            onClick={onRemoveImage}
          >
            Remove image
          </button>
        ) : null}
      </div>
      <div className="launch-preview-card-wrap">
        <FlipCard
          className="launch-preview-flip"
          ariaLabel={
            artworkShown
              ? "Flip token preview to view details"
              : "Flip token preview to view artwork"
          }
          defaultFlipped
          onFlipChange={setArtworkShown}
          axis="y"
          flipOnClick
          draggable
          dragDistance={0}
          tilt
          tiltMax={12}
          glare
          glareOpacity={0.22}
          hoverScale={1.03}
          perspective={1100}
          stiffness={170}
          damping={20}
          radius={16}
          background="var(--panel)"
          color="var(--ink)"
          shadow
          shadowColor="#000000"
          shadowOpacity={0.45}
          front={
            <div className="launch-preview-card">
              <div className="launch-preview-body">
                <div className="launch-preview-summary">
                  <div className="launch-preview-supply">
                    <span>Fixed supply</span>
                    <strong>
                      {supply == null
                        ? supplyUnavailable
                          ? "Unavailable"
                          : "Loading…"
                        : formatSupply(supply)}
                    </strong>
                  </div>
                  <div className="launch-preview-pair">
                    <span>Paired with</span>
                    <strong>WETH</strong>
                  </div>
                </div>
                {showAllocation && (
                  <section className="launch-preview-allocation" aria-label="Estimated token allocation">
                    <dl className="launch-preview-allocation-list">
                      <div>
                        <dt>Curve sale</dt>
                        <dd>{formatSupply(curveSupply)}</dd>
                      </div>
                      <div>
                        <dt>Graduation pool</dt>
                        <dd>{formatSupply(pool)}</dd>
                      </div>
                      <div>
                        <dt>Graduation burn</dt>
                        <dd>{formatSupply(graduationBurn)}</dd>
                      </div>
                    </dl>
                  </section>
                )}
                <dl className="launch-preview-fees">
                  {walletCapBps !== undefined && walletCapBps < 10_000 && (
                    <div>
                      <dt>Curve wallet cap</dt>
                      <dd>{walletCapBps / 100}%</dd>
                    </div>
                  )}
                  <div>
                    <dt>Creator tax</dt>
                    <dd>{creatorTaxBps / 100}%</dd>
                  </div>
                  <div>
                    <dt>Buyback</dt>
                    <dd>
                      {buybackShareBps === undefined
                        ? buybackUnavailable
                          ? "Unavailable"
                          : "Loading…"
                        : <>{buybackShareBps / 100}% <small>of trading fee</small></>}
                    </dd>
                  </div>
                </dl>
                <div className="launch-preview-identity">
                  <div className="launch-preview-identity-art" aria-hidden="true">
                    {imageUrl ? (
                      <img src={imageUrl} alt="" />
                    ) : (
                      <span>{displaySymbol.slice(0, 1)}</span>
                    )}
                  </div>
                  <div className="launch-preview-identity-copy">
                    <strong>{displayName}</strong>
                    <span>${displaySymbol}</span>
                  </div>
                </div>
              </div>
            </div>
          }
          back={
            <div className="launch-preview-back">
              <div className="launch-preview-back-art">
                {imageUrl && <img src={imageUrl} alt="" />}
              </div>
              <div className="launch-preview-back-caption">
                <strong>{displayName}</strong>
                <span>${displaySymbol}</span>
              </div>
            </div>
          }
        />
        {artworkShown && (
          <button
            type="button"
            className={`launch-preview-image-button${imageUrl ? " has-image" : ""}`}
            onClick={onChooseImage}
          >
            {imageUrl ? "Change preview image" : "Add image"}
          </button>
        )}
      </div>
    </aside>
  );
}
