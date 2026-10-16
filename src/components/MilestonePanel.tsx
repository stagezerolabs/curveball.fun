import { useStore } from "../app/useStore.js";
import { formatPercent } from "../lib/format.js";
import type { Address } from "viem";
import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import { escrowAbi, factoryAbi } from "../sdk/contracts";
import { activeChainId, activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { getMarketDisplayStatus } from "../lib/marketState";
import { factoryForToken } from "../lib/marketFactories";
import type { Token } from "../types";
import { UsdAmount } from "./UsdAmount";

export function MilestonePanel({
  token,
  address,
}: {
  token: Token;
  address?: Address;
}) {
  const { isPending, claimPoolFees, claimEscrow } = useStore() as {
    isPending: boolean;
    claimPoolFees: (locker: string, pool: string, factory?: Address) => Promise<void>;
    claimEscrow: (token: Address, asset: Address, recipient: Address, factory?: Address) => Promise<void>;
  };

  const progress = token.graduated ? 100 : (token.progress ?? 0);
  const marketStatus = getMarketDisplayStatus(token);
  const marketFactory = launchpadAddress ? factoryForToken(token.factory) : undefined;
  const { data: locker } = useReadContract({ address: marketFactory, abi: factoryAbi, functionName: "locker", chainId: activeChainId, query: { enabled: Boolean(marketFactory) } });
  const { data: escrow } = useReadContract({ address: marketFactory, abi: factoryAbi, functionName: "escrow", chainId: activeChainId, query: { enabled: Boolean(marketFactory) } });
  const { data: quote } = useReadContract({ address: marketFactory, abi: factoryAbi, functionName: "quote", chainId: activeChainId, query: { enabled: Boolean(marketFactory) } });
  const creatorShare = token.creatorShareBps == null ? null : token.creatorShareBps / 100;
  const buybackShare = token.buybackShareBps == null ? null : token.buybackShareBps / 100;
  const treasuryShare = creatorShare === null || buybackShare === null ? null : 100 - creatorShare - buybackShare;
  const { data: quoteOwed } = useReadContract({
    address: escrow, abi: escrowAbi, functionName: "claimable",
    args: [token.address, quote!, token.creator], chainId: activeChainId,
    query: { enabled: Boolean(escrow && quote) },
  });
  const { data: tokenOwed } = useReadContract({
    address: escrow, abi: escrowAbi, functionName: "claimable",
    args: [token.address, token.address, token.creator], chainId: activeChainId,
    query: { enabled: Boolean(escrow) },
  });

  return (
    <section className="milestone-panel" aria-label="Graduation and fees">
      <header className="panel-head">
        <h2>Milestone</h2>
        <span className={token.graduated ? "milestone-tag done" : "milestone-tag"}>
          {marketStatus.kind === "live" ? "On the curve" : marketStatus.label}
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
        {token.graduationTargetWeth && <div><dt>Pool WETH at graduation</dt><dd>{token.graduationTargetWeth} WETH</dd></div>}
        <div>
          <dt>Target price</dt>
          <dd><UsdAmount weth={token.targetPrice} /></dd>
        </div>
        <div>
          <dt>Now trading at</dt>
          <dd><UsdAmount weth={token.price} /></dd>
        </div>
      </dl>

      {!token.graduated && progress >= 100 && <div className="claim-block">
        <p className="panel-note">Bonding is complete. The pool is being prepared automatically. Its address will appear here after graduation is confirmed.</p>
      </div>}

      {token.graduated && token.pool && <div className="claim-block">
        <h3 className="panel-subhead">{token.mockVenue ? "Mock venue pool" : "Venue pool"}</h3>
        <a className="milestone-pool-link" href={`${activeExplorerUrl}/address/${token.pool}`} target="_blank" rel="noreferrer" aria-label={`View pool ${token.pool} on the explorer`}>
          <code>{token.pool}</code> <span aria-hidden="true">↗</span>
        </a>
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

      {token.graduated && !token.mockVenue && (
        <div className="claim-block">
          <h3 className="panel-subhead">Pool fees</h3>
          <p className="panel-note">
            Trading fees collect in the locked LP position. Anyone can route them to the creator, treasury, and buyback vault.
          </p>
          {address ? (
            <button
              type="button"
              className="primary-button claim-button"
              disabled={isPending || !locker || !token.pool}
              onClick={() =>
                claimPoolFees(locker ?? "", token.pool ?? "", marketFactory)
              }
            >
              {isPending ? "Claiming…" : "Claim pool fees"}
            </button>
          ) : <p className="panel-note">Connect from the navigation to claim pool fees.</p>}
        </div>
      )}

      <div className="claim-block">
        <h3 className="panel-subhead">Creator fee credits</h3>
        <p className="panel-note">Claims always pay the launch creator. Anyone may trigger them.</p>
        {quoteOwed !== undefined && quoteOwed > 0n && quote && <button type="button" className="primary-button claim-button" disabled={!address || isPending} onClick={() => claimEscrow(token.address, quote, token.creator, marketFactory)}>
          Claim {formatEther(quoteOwed)} WETH
        </button>}
        {tokenOwed !== undefined && tokenOwed > 0n && <button type="button" className="primary-button claim-button" disabled={!address || isPending} onClick={() => claimEscrow(token.address, token.address, token.creator, marketFactory)}>
          Claim {formatEther(tokenOwed)} {token.symbol}
        </button>}
      </div>
    </section>
  );
}
