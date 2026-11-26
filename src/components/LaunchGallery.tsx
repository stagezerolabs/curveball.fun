import { UsdAmount } from "./UsdAmount";
import { formatEthAmount, formatPercent } from "../lib/format.js";
import { graduationStats } from "../lib/graduationStats";
import { getMarketDisplayStatus } from "../lib/marketState";
import type { Token } from "../types";

/** A creator's launches by name; the grid wraps so any count fits. */
export function LaunchGallery({
  tokens,
  selected,
  onSelect,
}: {
  tokens: Token[];
  selected: string | undefined;
  onSelect: (token: Token) => void;
}) {
  return (
    <ul className="launch-gallery" aria-label="Your launches">
      {tokens.map((token) => {
        const status = getMarketDisplayStatus(token);
        const isSelected =
          selected?.toLowerCase() === token.address.toLowerCase();
        return (
          <li key={token.address}>
            <button
              type="button"
              className={isSelected ? "launch-tile selected" : "launch-tile"}
              aria-pressed={isSelected}
              title={`${token.name} · ${status.label}`}
              onClick={() => onSelect(token)}
            >
              <span
                className={`launch-tile-dot ${status.kind}`}
                aria-hidden="true"
              />
              {token.name}
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Graduation progress for the selected launch, the same figures the market shows. */
export function LaunchSummary({ token }: { token: Token }) {
  const status = getMarketDisplayStatus(token);
  const { progress, quoteTarget, quoteRaised, quoteProgress, targetMarketCap } =
    graduationStats(token);
  return (
    <section className="launch-summary" aria-labelledby="launch-summary-name">
      <header className="launch-summary-header">
        <h2 id="launch-summary-name">{token.name}</h2>
        <p>
          <span>${token.symbol}</span>
          <span className={`launch-status ${status.kind}`}>{status.label}</span>
        </p>
      </header>
      {token.graduated ? null : (
        <div className="launch-summary-progress">
          <span>
            Curve tokens sold
            <strong>{formatPercent(progress)}</strong>
          </span>
          <span
            className="milestone-bar"
            role="progressbar"
            aria-valuenow={Math.round(progress)}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-label="Curve tokens sold"
          >
            <span style={{ width: formatPercent(progress) }} />
          </span>
        </div>
      )}
      <dl className="launch-summary-stats">
        <div>
          <dt>Current cap</dt>
          <dd>
            <UsdAmount weth={token.marketCap} compact />
          </dd>
        </div>
        {token.graduated ? null : quoteTarget !== null &&
          quoteProgress !== null ? (
          <>
            <div>
              <dt>Net WETH raised</dt>
              <dd>
                {formatEthAmount(quoteRaised)} / {formatEthAmount(quoteTarget)}{" "}
                WETH
              </dd>
            </div>
            <div>
              <dt>WETH target filled</dt>
              <dd>{formatPercent(quoteProgress)}</dd>
            </div>
          </>
        ) : quoteTarget !== null ? (
          <div>
            <dt>Graduation target</dt>
            <dd>{formatEthAmount(quoteTarget)} WETH</dd>
          </div>
        ) : null}
        {token.graduated ? null : (
          <div>
            <dt>Market cap at graduation</dt>
            <dd>
              <UsdAmount weth={targetMarketCap} compact />
            </dd>
          </div>
        )}
      </dl>
    </section>
  );
}
