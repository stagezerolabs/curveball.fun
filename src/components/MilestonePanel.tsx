import { useStore } from "../app/useStore.js";
import { formatPercent } from "../lib/format.js";
import type { Address } from "viem";
import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import { curveFeeEscrowAbi, curveLaunchpadAbi } from "../sdk/contracts";
import {
  activeChainId,
  activeExplorerUrl,
  launchpadAddress,
} from "../lib/web3";
import { getMarketDisplayStatus, selectTradeState } from "../lib/marketState";
import { factoryForToken } from "../lib/marketFactories";
import type { Token } from "../types";
import { UsdAmount } from "./UsdAmount";

function getTargetMarketCap(token: Token) {
  if (token.targetPrice == null) return null;
  try {
    const supply = token.supply
      ? Number(formatEther(BigInt(token.supply)))
      : token.price && token.marketCap != null
        ? token.marketCap / token.price
        : null;
    return supply == null || !Number.isFinite(supply)
      ? null
      : token.targetPrice * supply;
  } catch {
    return null;
  }
}

export function MilestonePanel({
  token,
  address,
}: {
  token: Token;
  address?: Address;
}) {
  const { isPending, claimPoolFees, claimEscrow, runBuyback, graduateMarket } =
    useStore() as {
      isPending: boolean;
      claimPoolFees: (pool: Address, factory?: Address) => Promise<void>;
      claimEscrow: (asset: Address, factory?: Address) => Promise<void>;
      runBuyback: (token: Address, factory?: Address) => Promise<void>;
      graduateMarket: (token: Address, factory?: Address) => Promise<void>;
    };

  const progress = token.progress ?? 0;
  const marketStatus = getMarketDisplayStatus(token);
  const marketFactory = launchpadAddress
    ? factoryForToken(token.factory)
    : undefined;
  const { data: escrow } = useReadContract({
    address: marketFactory,
    abi: curveLaunchpadAbi,
    functionName: "escrow",
    chainId: activeChainId,
    query: { enabled: Boolean(marketFactory) },
  });
  const { data: quote } = useReadContract({
    address: marketFactory,
    abi: curveLaunchpadAbi,
    functionName: "quoteToken",
    chainId: activeChainId,
    query: { enabled: Boolean(marketFactory) },
  });
  const { canGraduate } = selectTradeState({
    ...token,
    paused: false,
    nowSeconds: Math.floor(Date.now() / 1_000),
  });
  const isCreator = Boolean(
    address && address.toLowerCase() === token.creator.toLowerCase(),
  );
  const creatorShare =
    token.creatorShareBps == null ? null : token.creatorShareBps / 100;
  const buybackShare =
    token.buybackShareBps == null ? null : token.buybackShareBps / 100;
  const treasuryShare =
    creatorShare === null || buybackShare === null
      ? null
      : 100 - creatorShare - buybackShare;
  // The escrow owes a creator per asset across all of its launches, and pays only the creator.
  const { data: quoteOwed, refetch: refetchQuoteOwed } = useReadContract({
    address: escrow,
    abi: curveFeeEscrowAbi,
    functionName: "claimable",
    args: [token.creator, quote!],
    chainId: activeChainId,
    query: { enabled: Boolean(escrow && quote) },
  });
  const { data: tokenOwed, refetch: refetchTokenOwed } = useReadContract({
    address: escrow,
    abi: curveFeeEscrowAbi,
    functionName: "claimable",
    args: [token.creator, token.address],
    chainId: activeChainId,
    query: { enabled: Boolean(escrow) },
  });
  const { data: buybackBalance, refetch: refetchBuyback } = useReadContract({
    address: escrow,
    abi: curveFeeEscrowAbi,
    functionName: "buybackBalance",
    args: [token.address],
    chainId: activeChainId,
    query: { enabled: Boolean(escrow && token.graduated) },
  });
  const hasQuotePayment = quoteOwed !== undefined && quoteOwed > 0n;
  const hasTokenPayment = tokenOwed !== undefined && tokenOwed > 0n;
  const creatorPaymentChecked =
    quoteOwed !== undefined && tokenOwed !== undefined;
  const creatorPaid =
    creatorPaymentChecked && !hasQuotePayment && !hasTokenPayment;
  const targetMarketCap = getTargetMarketCap(token);

  return (
    <section className="milestone-panel" aria-label="Graduation and fees">
      <header className="panel-head">
        <h2>Milestone</h2>
        {!token.graduated && (
          <span className="milestone-tag">
            {marketStatus.kind === "live" ? "On the curve" : marketStatus.label}
          </span>
        )}
      </header>

      {!token.graduated && (
        <>
          <div className="milestone-bar-row">
            <span>Progress to graduation</span>
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
        </>
      )}

      <dl className="milestone-figures">
        {token.graduationTargetWeth && (
          <div>
            <dt>Pool WETH at graduation</dt>
            <dd>{token.graduationTargetWeth} WETH</dd>
          </div>
        )}
        <div>
          <dt>Graduation market cap</dt>
          <dd>
            <UsdAmount weth={targetMarketCap} compact />
          </dd>
        </div>
        <div>
          <dt>Current market cap</dt>
          <dd>
            <UsdAmount weth={token.marketCap} compact />
          </dd>
        </div>
      </dl>

      {canGraduate && (
        <div className="claim-block">
          <p className="panel-note">
            Bonding is complete. The keeper seeds the pool automatically; anyone
            can also graduate the market now. The pool address appears here once
            graduation is confirmed.
          </p>
          {address && (
            <button
              type="button"
              className="primary-button claim-button"
              disabled={isPending}
              onClick={() => graduateMarket(token.address, marketFactory)}
            >
              {isPending ? "Graduating…" : "Graduate now"}
            </button>
          )}
        </div>
      )}
      {token.lifecycle === "aborted" && !canGraduate && (
        <div className="claim-block">
          <p className="panel-note">
            Graduation was aborted after its timeout. Trading continues on the
            curve, and the market graduates on its next sellout.
          </p>
        </div>
      )}

      {token.graduated && token.pool && (
        <div className="claim-block">
          <h3 className="panel-subhead">Pool</h3>
          <a
            className="milestone-pool-link"
            href={`${activeExplorerUrl}/address/${token.pool}`}
            target="_blank"
            rel="noreferrer"
            aria-label={`View pool ${token.pool} on the explorer`}
          >
            <code>{token.pool}</code> <span aria-hidden="true">↗</span>
          </a>
        </div>
      )}

      <h3 className="panel-subhead">Where pool fees go</h3>
      {creatorShare === null ||
      treasuryShare === null ||
      buybackShare === null ? (
        <p className="panel-note">
          Fee split unavailable — the launchpad could not be read.
        </p>
      ) : (
        <>
          <div className="split-bar" aria-hidden="true">
            <span
              className="split-creator"
              style={{ width: `${creatorShare}%` }}
            />
            <span
              className="split-treasury"
              style={{ width: `${treasuryShare}%` }}
            />
            {buybackShare > 0 && (
              <span
                className="split-buyback"
                style={{ width: `${buybackShare}%` }}
              />
            )}
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
            {buybackShare > 0 && (
              <li>
                <i className="split-buyback" aria-hidden="true" />
                Buyback and burn<strong>{buybackShare}%</strong>
              </li>
            )}
          </ul>
        </>
      )}

      {token.graduated && (
        <div className="claim-block">
          <h3 className="panel-subhead">Pool fees</h3>
          <p className="panel-note">
            Trading fees collect in the locked LP position. Anyone can route
            them to the creator, treasury, and buyback.
          </p>
          {address ? (
            <button
              type="button"
              className="primary-button claim-button"
              disabled={isPending || !token.pool}
              onClick={() =>
                token.pool && claimPoolFees(token.pool, marketFactory)
              }
            >
              {isPending ? "Claiming…" : "Claim pool fees"}
            </button>
          ) : (
            <p className="panel-note">
              Connect from the navigation to claim pool fees.
            </p>
          )}
        </div>
      )}

      {token.graduated &&
        buybackBalance !== undefined &&
        buybackBalance > 0n && (
          <div className="claim-block">
            <h3 className="panel-subhead">Buyback</h3>
            <p className="panel-note">
              {formatEther(buybackBalance)} WETH waits to buy {token.symbol}{" "}
              from the pool and burn it, in small chunks at most once an hour. A
              buyback skips without spending when the pool price strays from its
              recent average.
            </p>
            {address && (
              <button
                type="button"
                className="primary-button claim-button"
                disabled={isPending}
                onClick={async () => {
                  await runBuyback(token.address, marketFactory);
                  await refetchBuyback();
                }}
              >
                {isPending ? "Running…" : "Run buyback"}
              </button>
            )}
          </div>
        )}

      <div className="claim-block">
        <h3 className="panel-subhead">Creator fees</h3>
        {!creatorPaymentChecked && !hasQuotePayment && !hasTokenPayment && (
          <p className="panel-note" role="status">
            Checking creator payment…
          </p>
        )}
        {creatorPaid && (
          <p className="creator-paid-status" role="status">
            <span aria-hidden="true">✓</span> Creator paid
          </p>
        )}
        {(hasQuotePayment || hasTokenPayment) && !isCreator && (
          <p className="panel-note">
            The creator has{" "}
            {hasQuotePayment ? `${formatEther(quoteOwed)} WETH` : ""}
            {hasQuotePayment && hasTokenPayment ? " and " : ""}
            {hasTokenPayment
              ? `${formatEther(tokenOwed)} ${token.symbol}`
              : ""}{" "}
            waiting, across all of their launches. Only the creator's wallet can
            claim it.
          </p>
        )}
        {hasQuotePayment && quote && isCreator && (
          <button
            type="button"
            className="primary-button claim-button"
            disabled={isPending}
            onClick={async () => {
              await claimEscrow(quote, marketFactory);
              await refetchQuoteOwed();
            }}
          >
            {isPending
              ? "Claiming…"
              : `Claim ${formatEther(quoteOwed)} WETH (all your launches)`}
          </button>
        )}
        {hasTokenPayment && isCreator && (
          <button
            type="button"
            className="primary-button claim-button"
            disabled={isPending}
            onClick={async () => {
              await claimEscrow(token.address, marketFactory);
              await refetchTokenOwed();
            }}
          >
            {isPending
              ? "Claiming…"
              : `Claim ${formatEther(tokenOwed)} ${token.symbol}`}
          </button>
        )}
      </div>
    </section>
  );
}
