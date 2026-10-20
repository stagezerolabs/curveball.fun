import { formatEther, type Address } from "viem";
import { useAccount, useReadContract } from "wagmi";
import { useStore } from "../app/useStore.js";
import { activeChainId, activeExplorerUrl } from "../lib/web3";
import { CURVE_SUPPLY, TOKEN_SUPPLY } from "../sdk/sdk";
import { curveHolderReserveAbi, curveLaunchpadAbi } from "../sdk/contracts";
import type { Token } from "../types";

function displayAmount(value: bigint) {
  return Number(formatEther(value)).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * A launch's holder reserve: minted at launch and, once the token graduates, claimable by every curve
 * buyer in proportion to the tokens they bought on the curve. The share follows the launchpad's
 * ledger, which keeps moving with curve trades until graduation and is frozen after it.
 */
export function HolderAirdropPanel({ token }: { token: Token }) {
  const { address: wallet } = useAccount();
  const { isPending, claimReserve } = useStore() as {
    isPending: boolean;
    claimReserve: (token: Address, factory?: Address) => Promise<void>;
  };
  const launchpad = token.factory;
  const { data: reserve } = useReadContract({
    address: launchpad, abi: curveLaunchpadAbi, functionName: "reserve", chainId: activeChainId,
    query: { enabled: Boolean(launchpad) },
  });
  const { data: reserved } = useReadContract({
    address: reserve, abi: curveHolderReserveAbi, functionName: "reserveOf", args: [token.address], chainId: activeChainId,
    query: { enabled: Boolean(reserve) },
  });
  const { data: held } = useReadContract({
    address: launchpad, abi: curveLaunchpadAbi, functionName: "held", args: [token.address, wallet!], chainId: activeChainId,
    query: { enabled: Boolean(launchpad && wallet) },
  });
  const { data: claimed, refetch: refetchClaimed } = useReadContract({
    address: reserve, abi: curveHolderReserveAbi, functionName: "claimed", args: [token.address, wallet!], chainId: activeChainId,
    query: { enabled: Boolean(reserve && wallet) },
  });
  const { data: claimable, refetch: refetchClaimable } = useReadContract({
    address: reserve, abi: curveHolderReserveAbi, functionName: "claimable", args: [token.address, wallet!], chainId: activeChainId,
    query: { enabled: Boolean(reserve && wallet && token.graduated) },
  });

  if (reserved === undefined) {
    return <section className="claim-block holder-reserve-panel" aria-busy="true"><h3 className="panel-subhead">Holder reserve</h3><p className="panel-note">Reading the holder reserve…</p></section>;
  }
  if (reserved === 0n) {
    return <section className="claim-block holder-reserve-panel"><h3 className="panel-subhead">Holder reserve</h3><p className="panel-note">This launch has no holder reserve.</p></section>;
  }

  const share = held !== undefined ? reserved * held / CURVE_SUPPLY : null;
  const percentOfSupply = Number(reserved * 10_000n / TOKEN_SUPPLY) / 100;
  return (
    <section className="claim-block holder-reserve-panel" aria-labelledby={`reserve-${token.address}`}>
      <h3 id={`reserve-${token.address}`} className="panel-subhead">Holder reserve</h3>
      <p className="panel-note">
        {displayAmount(reserved)} {token.symbol} ({percentOfSupply}% of supply) is held for curve buyers. After graduation, each
        wallet claims a share in proportion to the tokens it bought on the curve.
        {reserve && <> <a className="reserve-link" href={`${activeExplorerUrl}/address/${reserve}`} target="_blank" rel="noreferrer">View reserve <span aria-hidden="true">↗</span></a></>}
      </p>
      {!wallet ? <p className="panel-note">Connect a wallet to see your share.</p>
        : !token.graduated ? (
          <p className="panel-note" role="status">
            {share && share > 0n
              ? `Your share at current curve holdings: ${displayAmount(share)} ${token.symbol}. It follows your curve buys and sells until graduation, when claims open.`
              : "Buy on the curve before graduation to earn a share. Claims open at graduation."}
          </p>
        ) : claimed ? (
          <p className="creator-paid-status" role="status"><span aria-hidden="true">✓</span> You claimed your share</p>
        ) : claimable !== undefined && claimable > 0n ? (
          <button type="button" className="primary-button claim-button" disabled={isPending} onClick={async () => {
            await claimReserve(token.address, launchpad);
            await Promise.all([refetchClaimed(), refetchClaimable()]);
          }}>
            {isPending ? "Claiming…" : `Claim ${displayAmount(claimable)} ${token.symbol}`}
          </button>
        ) : <p className="panel-note">This wallet bought nothing on the curve, so it has no share to claim.</p>}
    </section>
  );
}
