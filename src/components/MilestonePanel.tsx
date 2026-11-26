import { useEffect, useRef, useState } from "react";
import { useStore } from "../app/useStore.js";
import { formatEthAmount, formatPercent } from "../lib/format.js";
import type { Address } from "viem";
import { formatEther } from "viem";
import { useReadContract } from "wagmi";
import { curveFeeEscrowAbi, curveLaunchpadAbi } from "../sdk/contracts";
import { activeChainId, launchpadAddress } from "../lib/web3";
import { selectTradeState } from "../lib/marketState";
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

function InfoIcon() {
  return (
    <svg
      className="fee-split-info"
      viewBox="0 0 16 16"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 7.25v3.5M8 5.1v.05" />
    </svg>
  );
}

export function MilestonePanel({
  token,
  address,
}: {
  token: Token;
  address?: Address;
}) {
  const [openDetail, setOpenDetail] = useState<"progress" | "fees" | null>(
    null,
  );
  const panelRef = useRef<HTMLElement>(null);
  const progressOpen = openDetail === "progress";
  const feeSplitOpen = openDetail === "fees";
  const toggleDetail = (detail: "progress" | "fees") =>
    setOpenDetail((open) => (open === detail ? null : detail));

  useEffect(() => {
    if (!openDetail) return;
    const close = (event: Event) => {
      if (event instanceof KeyboardEvent && event.key !== "Escape") return;
      if (
        event instanceof PointerEvent &&
        panelRef.current?.contains(event.target as Node)
      )
        return;
      setOpenDetail(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [openDetail]);
  const { isPending, claimPoolFees, claimEscrow, graduateMarket } =
    useStore() as {
      isPending: boolean;
      claimPoolFees: (pool: Address, factory?: Address) => Promise<void>;
      claimEscrow: (asset: Address, factory?: Address) => Promise<void>;
      graduateMarket: (token: Address, factory?: Address) => Promise<void>;
    };

  const progress = token.progress ?? 0;
  const quoteTarget = token.graduationTargetWeth
    ? Number(token.graduationTargetWeth)
    : null;
  const hasQuoteTarget = quoteTarget !== null && Number.isFinite(quoteTarget) && quoteTarget > 0;
  const quoteRaised = token.curveLiquidityWeth;
  const quoteProgress =
    hasQuoteTarget && quoteRaised != null && Number.isFinite(quoteRaised)
      ? (quoteRaised / quoteTarget) * 100
      : null;
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
    query: { enabled: Boolean(isCreator && escrow && quote) },
  });
  const { data: tokenOwed, refetch: refetchTokenOwed } = useReadContract({
    address: escrow,
    abi: curveFeeEscrowAbi,
    functionName: "claimable",
    args: [token.creator, token.address],
    chainId: activeChainId,
    query: { enabled: Boolean(isCreator && escrow) },
  });
  const hasQuotePayment = quoteOwed !== undefined && quoteOwed > 0n;
  const hasTokenPayment = tokenOwed !== undefined && tokenOwed > 0n;
  const targetMarketCap = getTargetMarketCap(token);

  return (
    <section
      ref={panelRef}
      className="milestone-panel"
      aria-label="Graduation and fees"
    >
      {!token.graduated ? (
        <div
          className={`fee-split${progressOpen ? " open" : ""}`}
        >
          <button
            type="button"
            className="fee-split-trigger"
            aria-controls="milestone-details"
            aria-expanded={progressOpen}
            onClick={() => toggleDetail("progress")}
          >
            <span className="fee-split-heading">
              <span>Curve tokens sold</span>
              <span className="fee-split-meta">
                <strong>{formatPercent(progress)}</strong>
                <InfoIcon />
              </span>
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
          </button>
          <dl className="fee-split-popover milestone-details" id="milestone-details">
            <div>
              <dt>Current cap</dt>
              <dd>
                <UsdAmount weth={token.marketCap} compact />
              </dd>
            </div>
            {hasQuoteTarget && (
              quoteProgress !== null ? (
                <>
                  <div>
                    <dt>Net WETH raised</dt>
                    <dd>
                      {formatEthAmount(quoteRaised)} / {formatEthAmount(quoteTarget)} WETH
                    </dd>
                  </div>
                  <div>
                    <dt>WETH target filled</dt>
                    <dd>{formatPercent(quoteProgress)}</dd>
                  </div>
                </>
              ) : (
                <div>
                  <dt>Graduation target</dt>
                  <dd>{formatEthAmount(quoteTarget)} WETH</dd>
                </div>
              )
            )}
            <div>
              <dt>Market cap at graduation</dt>
              <dd>
                <UsdAmount weth={targetMarketCap} compact />
              </dd>
            </div>
          </dl>
        </div>
      ) : (
        <div className="milestone-bar-row">
          <span>Market cap</span>
          <strong>
            <UsdAmount weth={token.marketCap} compact />
          </strong>
        </div>
      )}

      {canGraduate && (
        <div className="claim-block">
          <p className="panel-note">
            Bonding is complete. The keeper seeds the pool automatically; anyone
            can also graduate the market now.
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

      {creatorShare === null ||
      treasuryShare === null ||
      buybackShare === null ? (
        <p className="panel-note">
          Fee split unavailable — the launchpad could not be read.
        </p>
      ) : (
        <div className={`fee-split${feeSplitOpen ? " open" : ""}`}>
          <button
            type="button"
            className="fee-split-trigger"
            aria-label={`Fee split: ${creatorShare}% creator, ${treasuryShare}% treasury, ${buybackShare}% buyback and burn`}
            aria-controls="fee-split-details"
            aria-expanded={feeSplitOpen}
            onClick={() => toggleDetail("fees")}
          >
            <span className="fee-split-heading">
              <span>Where fees go</span>
              <span className="fee-split-meta">
                <InfoIcon />
              </span>
            </span>
            <span className="split-bar" aria-hidden="true">
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
            </span>
          </button>
          <div className="fee-split-popover" id="fee-split-details">
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
            <p>Claimed pool fees are distributed to these destinations.</p>
          </div>
        </div>
      )}

      {token.graduated && isCreator && (
        <div className="claim-block">
          <h3 className="panel-subhead">Pool fees</h3>
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
        </div>
      )}

      {isCreator && (hasQuotePayment || hasTokenPayment) && (
        <div className="claim-block">
          <h3 className="panel-subhead">Creator fees</h3>
          {hasQuotePayment && quote && (
            <>
              <p className="panel-note" title={`${formatEther(quoteOwed)} WETH`}>
                Available: {formatEthAmount(Number(formatEther(quoteOwed)))} WETH
                across all your launches.
              </p>
              <button
                type="button"
                className="primary-button claim-button"
                disabled={isPending}
                onClick={async () => {
                  await claimEscrow(quote, marketFactory);
                  await refetchQuoteOwed();
                }}
              >
                {isPending ? "Claiming…" : "Claim WETH fees"}
              </button>
            </>
          )}
          {hasTokenPayment && (
            <>
              <p className="panel-note" title={`${formatEther(tokenOwed)} ${token.symbol}`}>
                Available: {formatEthAmount(Number(formatEther(tokenOwed)))}{" "}
                {token.symbol}.
              </p>
              <button
                type="button"
                className="primary-button claim-button"
                disabled={isPending}
                onClick={async () => {
                  await claimEscrow(token.address, marketFactory);
                  await refetchTokenOwed();
                }}
              >
                {isPending ? "Claiming…" : `Claim ${token.symbol} fees`}
              </button>
            </>
          )}
        </div>
      )}
    </section>
  );
}
