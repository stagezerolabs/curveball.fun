import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { launchpadAbi } from "../sdk/contracts";
import { v2FactoryAbi } from "../sdk/v2Contracts";
import { activeChainId, activeContractVersion, activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { getBetaReadEnabled, selectMarketState } from "../lib/marketState";
import { useStore } from "../app/useStore.js";
import { useTokenBalance } from "../sdk/react";
import { formatEthAmount, formatPercent, formatUsd } from "../lib/format.js";
import {
  getBuyFundingState,
  TradeFundingStatus,
} from "./TradeFundingStatus";
import { NATIVE_GAS_RESERVE } from "../sdk/wagmiSdk";
import type { Address } from "viem";
import type { LaunchpadConfig, Token } from "../types";

const SLIPPAGE_BPS = 300; // useStore sends minOut at 97% of the quote.
const PRESETS = [25, 50, 100];

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: string;
}) {
  return (
    <div className="trade-row">
      <span>{label}</span>
      <strong className={tone}>{value}</strong>
    </div>
  );
}

export function TradePanel({
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
  const {
    amount,
    setAmount,
    side,
    setSide,
    trade,
    isPending,
    tradeMessage,
    quotePreview,
    quoting,
    fetchQuote,
  } = useStore();
  const [explain, setExplain] = useState(false);
  const betaReadEnabled = getBetaReadEnabled({
    contractVersion: activeContractVersion,
    chainId: activeChainId,
    walletConnected: Boolean(address),
    hasLaunchpadAddress: Boolean(launchpadAddress),
  });
  const { data: publicOpen } = useReadContract({
    address: launchpadAddress ?? undefined, abi: activeContractVersion === "v2" ? v2FactoryAbi : launchpadAbi,
    functionName: "publicLaunchOpen", chainId: activeChainId,
    query: { enabled: betaReadEnabled.publicLaunchOpen },
  });
  const { data: invited } = useReadContract({
    address: launchpadAddress ?? undefined, abi: activeContractVersion === "v2" ? v2FactoryAbi : launchpadAbi,
    functionName: "invited", args: [address!], chainId: activeChainId,
    query: { enabled: betaReadEnabled.invited },
  });
  const { state, hasBetaAccess, canBuy } = selectMarketState({
    contractVersion: activeContractVersion,
    chainId: activeChainId,
    walletConnected: Boolean(address),
    publicLaunchOpen: publicOpen,
    invited,
    graduated: token.graduated,
    pending: token.pending,
    progress: token.progress,
  });

  const quoteSymbol = token.quoteSymbol ?? config?.quoteSymbol ?? "ETH";
  const payingWith = side === "buy" ? quoteSymbol : token.symbol;
  const receiving = side === "buy" ? token.symbol : quoteSymbol;

  // Buying spends the quote token, selling spends the token itself.
  const balanceOf = side === "buy" ? config?.quoteToken : token.address;
  const { data: assetBalance } = useTokenBalance(
    (balanceOf ?? undefined) as Address | undefined,
    address,
  );
  const { data: nativeBalance } = useBalance({ address });

  useEffect(() => {
    if (token.graduated) return undefined;
    const timeout = setTimeout(() => fetchQuote(token), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, token.address, token.graduated]);

  const received = quotePreview !== null ? Number(formatEther(quotePreview)) : null;
  const atLeast = received === null ? null : received * (1 - SLIPPAGE_BPS / 10_000);

  // Execution price vs the current spot price: how far this size moves the curve.
  const input = Number(amount);
  const buyFunding =
    side === "buy"
      ? getBuyFundingState(amount, assetBalance, nativeBalance?.value)
      : null;
  const presetBalance =
    side === "buy" && assetBalance !== undefined && nativeBalance
      ? assetBalance +
        (nativeBalance.value > NATIVE_GAS_RESERVE
          ? nativeBalance.value - NATIVE_GAS_RESERVE
          : 0n)
      : assetBalance;
  const executionPrice =
    received && input > 0
      ? side === "buy"
        ? input / received
        : received / input
      : null;
  const priceImpact =
    executionPrice && token.price
      ? Math.abs(executionPrice / token.price - 1) * 100
      : null;

  function applyPreset(percent: number) {
    if (presetBalance === undefined) return;
    const portion = presetBalance * BigInt(percent) / 100n;
    setAmount(formatEther(portion));
  }

  if (state === "graduated") {
    return (
      <section className="trade-panel">
        <p className="trade-graduated">
          <strong>This curve is complete.</strong> A basic volatile {token.symbol}/WETH pool was created on Icarus. Pool creation does not grant a gauge or IRS emissions.
        </p>
        {token.pool && <a href={`${activeExplorerUrl}/address/${token.pool}`} target="_blank" rel="noreferrer">View Icarus pool {token.pool}</a>}
        <a
          className="primary-button trade-submit"
          href="https://icarus.finance/"
          target="_blank"
          rel="noreferrer"
        >
          Open Icarus to swap
        </a>
      </section>
    );
  }

  return (
    <section className="trade-panel" aria-label="Trade">
      <div className="side-toggle" role="group" aria-label="Buy or sell">
        <button
          className={side === "buy" ? "active buy" : ""}
          aria-pressed={side === "buy"}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          className={side === "sell" ? "active sell" : ""}
          aria-pressed={side === "sell"}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
      </div>

      {token.pending && <p className="notice" role="status">Graduation is ready. Anyone can create the Icarus pool. Selling remains available until then.</p>}
      {activeContractVersion === "v2" && !token.pending && (token.progress ?? 0) >= 100 && side === "buy" && <p className="notice" role="status">This curve is sold out. Buying will resume in the graduated pool; selling remains available for now.</p>}
      {!hasBetaAccess && side === "buy" && publicOpen === false && invited === false && <p className="notice" role="status">This deployed factory is still invite-only. Selling remains open.</p>}

      <div className="amount-head">
        <label htmlFor="trade-amount">Amount</label>
        <div className="amount-presets">
          {PRESETS.map((percent) => (
            <button
              key={percent}
              type="button"
              disabled={presetBalance === undefined}
              onClick={() => applyPreset(percent)}
            >
              {percent === 100 ? "Max" : `${percent}%`}
            </button>
          ))}
        </div>
      </div>

      <div className="amount-shell">
        <input
          id="trade-amount"
          type="number"
          min="0"
          step="any"
          inputMode="decimal"
          autoComplete="off"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
        <span className="amount-unit">{payingWith}</span>
      </div>

      {side === "buy" && (
        <TradeFundingStatus
          amount={amount}
          wethBalance={assetBalance}
          nativeBalance={nativeBalance?.value}
        />
      )}

      <div className="trade-summary" aria-live="polite">
        <Row
          label="You receive"
          value={
            quoting
              ? "…"
              : received === null
                ? "—"
                : `${formatEthAmount(received)} ${receiving}`
          }
        />
        <Row
          label="At least"
          value={
            atLeast === null ? "—" : `${formatEthAmount(atLeast)} ${receiving}`
          }
        />
        <Row label="Price" value={formatUsd(token.priceUsd)} />
        <Row label="Slippage limit" value={`${SLIPPAGE_BPS / 100}%`} />
        {activeContractVersion === "v2" && <Row label="Curve fee + creator tax" value={token.feeBps == null ? "—" : `${((token.feeBps + (token.creatorTaxBps ?? 0)) / 100).toFixed(2)}%`} />}
        <Row
          label="Price impact"
          value={priceImpact === null ? "—" : formatPercent(priceImpact)}
          tone={priceImpact !== null && priceImpact > 5 ? "warn" : undefined}
        />
      </div>

      {address ? (
        <button
          className={`trade-submit ${side}`}
          disabled={isPending || !(input > 0) || buyFunding?.canFund === false || (side === "buy" && !canBuy)}
          onClick={() => trade(side, token)}
        >
          {isPending ? "Pending…" : side === "buy" ? "Buy" : "Sell"}
        </button>
      ) : (
        <button className="trade-submit connect" onClick={connectWallet}>
          Connect wallet
        </button>
      )}
      {!address && <p className="trade-hint">Connect wallet to trade.</p>}
      {tradeMessage && !isPending && (
        <p className="trade-hint success" role="status">
          {tradeMessage}
        </p>
      )}

      <div className="trade-explain">
        <button
          type="button"
          aria-expanded={explain}
          onClick={() => setExplain((open) => !open)}
        >
          How this trade is priced
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="7" />
            <path d="M10 9v5M10 6.5v.01" />
          </svg>
        </button>
        {explain && (
          <p>
            Every trade runs against a constant-product bonding curve held by the
            launchpad — no order book and no counterparty. The price moves with
            each buy and sell, so larger orders pay more. Your transaction
            reverts if the result lands below the slippage limit.
          </p>
        )}
      </div>
    </section>
  );
}
