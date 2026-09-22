import { useStore } from "../app/useStore.js";
import { formatPercent, formatUsd } from "../lib/format.js";
import type { Address } from "viem";
import type { LaunchpadConfig, Token } from "../types";

export function MilestonePanel({
  token,
  address,
  config,
  connectWallet,
}: {
  token: Token;
  address?: Address;
  config: LaunchpadConfig | null;
  connectWallet: () => void;
}) {
  const { isPending, claimPoolFees } = useStore() as {
    isPending: boolean;
    claimPoolFees: (locker: string, pool: string) => Promise<void>;
  };

  const progress = token.graduated ? 100 : (token.progress ?? 0);
  const creatorShare =
    config?.creatorShareBps === null || config?.creatorShareBps === undefined
      ? null
      : config.creatorShareBps / 100;
  const treasuryShare = creatorShare === null ? null : 100 - creatorShare;

  return (
    <section className="milestone-panel" aria-label="Graduation and fees">
      <header className="panel-head">
        <h2>Milestone</h2>
        <span className={token.graduated ? "milestone-tag done" : "milestone-tag"}>
          {token.graduated ? "Graduated" : "On the curve"}
        </span>
      </header>

      <div className="milestone-bar-row">
        <span>{token.graduated ? "Graduated" : "Progress to graduation"}</span>
        <strong>{formatPercent(progress)}</strong>
      </div>
      <div
        className="milestone-bar"
        role="progressbar"
        aria-valuenow={Math.round(progress)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="Progress to graduation"
      >
        <span style={{ width: formatPercent(progress) }} />
      </div>

      <dl className="milestone-figures">
        <div>
          <dt>Target price</dt>
          <dd>
            {config?.targetPrice && token.ethUsd
              ? formatUsd(config.targetPrice * token.ethUsd)
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Now trading at</dt>
          <dd>{formatUsd(token.priceUsd)}</dd>
        </div>
      </dl>

      <h3 className="panel-subhead">Where pool fees go</h3>
      {creatorShare === null ? (
        <p className="panel-note">
          Fee split unavailable — the launchpad could not be read.
        </p>
      ) : (
        <>
          <div className="split-bar" aria-hidden="true">
            <span className="split-creator" style={{ width: `${creatorShare}%` }} />
            <span className="split-treasury" style={{ width: `${treasuryShare}%` }} />
          </div>
          <ul className="split-legend">
            <li>
              <i className="split-creator" aria-hidden="true" />
              Creator
              <strong>{creatorShare}%</strong>
            </li>
            <li>
              <i className="split-treasury" aria-hidden="true" />
              Treasury
              <strong>{treasuryShare}%</strong>
            </li>
          </ul>
        </>
      )}

      {token.graduated && (
        <div className="claim-block">
          <h3 className="panel-subhead">Pool fees</h3>
          <p className="panel-note">
            Trading fees collect in the locked LP position. Anyone can release
            them — they always pay the creator and treasury, never the caller.
          </p>
          {address ? (
            <button
              className="primary-button claim-button"
              disabled={isPending || !config?.locker || !token.pool}
              onClick={() =>
                claimPoolFees(config?.locker ?? "", token.pool ?? "")
              }
            >
              {isPending ? "Claiming…" : "Claim pool fees"}
            </button>
          ) : (
            <button className="primary-button claim-button" onClick={connectWallet}>
              Connect a wallet to claim
            </button>
          )}
        </div>
      )}
    </section>
  );
}
