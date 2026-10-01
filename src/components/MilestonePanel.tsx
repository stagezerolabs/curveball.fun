import { useStore } from "../app/useStore.js";
import { formatPercent, formatUsd } from "../lib/format.js";
import type { Address } from "viem";
import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import { v2EscrowAbi } from "../sdk/v2Contracts";
import { activeChainId } from "../lib/web3";
import type { LaunchpadConfig, Token } from "../types";
import { activeContractVersion } from "../lib/web3";

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
  const { isPending, claimPoolFees, claimEscrow, advanceGraduation } = useStore() as {
    isPending: boolean;
    claimPoolFees: (locker: string, pool: string) => Promise<void>;
    claimEscrow: (token: Address, asset: Address, recipient: Address) => Promise<void>;
    advanceGraduation: (token: Token) => Promise<void>;
  };

  const progress = token.graduated ? 100 : (token.progress ?? 0);
  const creatorShare =
    (token.creatorShareBps ?? config?.creatorShareBps) === null || (token.creatorShareBps ?? config?.creatorShareBps) === undefined
      ? null
      : (token.creatorShareBps ?? config!.creatorShareBps!) / 100;
  const buybackShare = activeContractVersion === "v2"
    ? token.buybackShareBps == null ? null : token.buybackShareBps / 100
    : 0;
  const treasuryShare = creatorShare === null || buybackShare === null ? null : 100 - creatorShare - buybackShare;
  const escrow = config?.escrow as Address | undefined;
  const quote = config?.quoteToken as Address | undefined;
  const { data: quoteOwed } = useReadContract({
    address: escrow, abi: v2EscrowAbi, functionName: "claimable",
    args: [token.address, quote!, token.creator], chainId: activeChainId,
    query: { enabled: activeContractVersion === "v2" && Boolean(escrow && quote) },
  });
  const { data: tokenOwed } = useReadContract({
    address: escrow, abi: v2EscrowAbi, functionName: "claimable",
    args: [token.address, token.address, token.creator], chainId: activeChainId,
    query: { enabled: activeContractVersion === "v2" && Boolean(escrow) },
  });

  return (
    <section className="milestone-panel" aria-label="Graduation and fees">
      <header className="panel-head">
        <h2>Milestone</h2>
        <span className={token.graduated ? "milestone-tag done" : "milestone-tag"}>
          {token.graduated ? "Graduated" : token.pending ? "Graduation pending" : "On the curve"}
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

      {activeContractVersion === "v2" && !token.graduated && progress >= 100 && <div className="claim-block">
        <p className="panel-note">{token.pending ? "Curve reserves are ready for an Icarus pool." : "The curve is sold out and ready to prepare graduation."}</p>
        <button className="primary-button claim-button" disabled={!address || isPending} onClick={() => advanceGraduation(token)}>
          {token.pending ? "Create Icarus pool" : "Prepare graduation"}
        </button>
      </div>}

      <h3 className="panel-subhead">Where pool fees go</h3>
      {creatorShare === null || treasuryShare === null || buybackShare === null ? (
        <p className="panel-note">
          Fee split unavailable — the launchpad could not be read.
        </p>
      ) : (
        <>
          <div className="split-bar" aria-hidden="true">
            <span className="split-creator" style={{ width: `${creatorShare}%` }} />
            <span className="split-treasury" style={{ width: `${treasuryShare}%` }} />
            {buybackShare > 0 && <span className="split-buyback" style={{ width: `${buybackShare}%` }} />}
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
            {buybackShare > 0 && <li><i className="split-buyback" aria-hidden="true" />Buyback vault<strong>{buybackShare}%</strong></li>}
          </ul>
        </>
      )}

      {token.graduated && (
        <div className="claim-block">
          <h3 className="panel-subhead">Pool fees</h3>
          <p className="panel-note">
            {activeContractVersion === "v2"
              ? "Trading fees collect in the locked LP position. Anyone can route them to the creator, treasury, and buyback vault."
              : "Trading fees collect in the locked LP position. Anyone can release them to the creator and treasury."}
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

      {activeContractVersion === "v2" && <div className="claim-block">
        <h3 className="panel-subhead">Creator fee credits</h3>
        <p className="panel-note">Claims always pay the launch creator. Anyone may trigger them.</p>
        {quoteOwed !== undefined && quoteOwed > 0n && quote && <button className="primary-button claim-button" disabled={!address || isPending} onClick={() => claimEscrow(token.address, quote, token.creator)}>
          Claim {formatEther(quoteOwed)} WETH
        </button>}
        {tokenOwed !== undefined && tokenOwed > 0n && <button className="primary-button claim-button" disabled={!address || isPending} onClick={() => claimEscrow(token.address, token.address, token.creator)}>
          Claim {formatEther(tokenOwed)} {token.symbol}
        </button>}
      </div>}
    </section>
  );
}
