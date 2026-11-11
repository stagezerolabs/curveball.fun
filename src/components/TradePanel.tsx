import { useEffect } from "react";
import { usePrivy } from "@privy-io/react-auth";
import type { ReactNode } from "react";
import { formatEther, parseAbi, parseEther } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { curveLaunchpadAbi, erc20Abi } from "../sdk/contracts";
import {
  activeChainId,
  activeSwapAdapterAddress,
  launchpadAddress,
} from "../lib/web3";
import { factoryForToken } from "../lib/marketFactories";
import {
  poolTradeAvailability,
  selectTradeState,
  tradeQuoteKey,
  tradeVenueForMarket,
} from "../lib/marketState";
import { useStore } from "../app/useStore.js";
import { formatEthAmount, formatPercent } from "../lib/format.js";
import { getBuyFundingState, TradeFundingStatus } from "./TradeFundingStatus";
import { NATIVE_GAS_RESERVE } from "../sdk/sdk";
import type { Address } from "viem";
import type { Token } from "../types";
import { tradeButtonLabel } from "../lib/tradeProgress";
import { UsdAmount } from "./UsdAmount";

const SLIPPAGE_BPS = 300; // useStore sends minOut at 97% of the quote.
const PRESETS = [25, 50, 100];
const icarusFactoryAbi = parseAbi([
  "function isPaused() view returns (bool)",
  "function getFee(address pool, bool stable) view returns (uint256)",
]);

function Row({
  label,
  value,
  tone,
}: {
  label: string;
  value: ReactNode;
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
}: {
  token: Token;
  address?: Address;
}) {
  const {
    amount,
    setAmount,
    side,
    setSide,
    trade,
    isPending,
    tradeMessage,
    tradeProgress,
    quotePreview,
    quoteContext,
    quoting,
    fetchQuote,
  } = useStore();
  const { ready: privyReady, authenticated, login } = usePrivy();
  const marketFactory = launchpadAddress
    ? factoryForToken(token.factory)
    : undefined;
  const venue = tradeVenueForMarket(token);
  const poolMode = venue === "pool";
  const graduatedVenue = venue !== "curve";
  const { data: antiSnipeBps } = useReadContract({
    address: marketFactory,
    abi: curveLaunchpadAbi,
    functionName: "antiSnipeTaxBps",
    args: [token.address],
    chainId: activeChainId,
    query: {
      enabled: venue === "curve" && Boolean(marketFactory),
      refetchInterval: 1_000,
    },
  });
  const { data: walletCapacity } = useReadContract({
    address: marketFactory, abi: curveLaunchpadAbi,
    functionName: "remainingWalletCapacity",
    args: address ? [token.address, address] : undefined,
    chainId: activeChainId,
    query: { enabled: venue === "curve" && Boolean(marketFactory && address), refetchInterval: 10_000 },
  });
  const { data: paused } = useReadContract({
    address: marketFactory,
    abi: curveLaunchpadAbi,
    functionName: "paused",
    chainId: activeChainId,
    query: { enabled: Boolean(marketFactory), refetchInterval: 30_000 },
  });
  const { data: quoteToken } = useReadContract({
    address: marketFactory,
    abi: curveLaunchpadAbi,
    functionName: "quoteToken",
    chainId: activeChainId,
    query: { enabled: Boolean(marketFactory) },
  });
  const { data: icarusFactory } = useReadContract({
    address: marketFactory,
    abi: curveLaunchpadAbi,
    functionName: "icarusFactory",
    chainId: activeChainId,
    query: { enabled: venue !== "curve" && Boolean(marketFactory) },
  });
  const { data: poolPaused, isError: poolPauseError } = useReadContract({
    address: icarusFactory,
    abi: icarusFactoryAbi,
    functionName: "isPaused",
    chainId: activeChainId,
    query: {
      enabled: poolMode && Boolean(icarusFactory),
      refetchInterval: 15_000,
    },
  });
  const { data: poolFeeBps } = useReadContract({
    address: icarusFactory,
    abi: icarusFactoryAbi,
    functionName: "getFee",
    args: token.pool ? [token.pool, false] : undefined,
    chainId: activeChainId,
    query: {
      enabled: poolMode && Boolean(icarusFactory && token.pool),
      refetchInterval: 30_000,
    },
  });
  const { state, canBuy, canSell, sellAborts } = selectTradeState({
    ...token,
    paused: paused === true,
    nowSeconds: Math.floor(Date.now() / 1_000),
  });
  const poolAvailability = poolTradeAvailability({
    venue,
    paused: poolPauseError ? undefined : poolPaused,
    adapter: activeSwapAdapterAddress,
  });
  const poolQuoteReady =
    poolMode &&
    quotePreview !== null &&
    !quoting &&
    quoteContext === tradeQuoteKey(token, side, amount);
  const canBuyNow = graduatedVenue
    ? poolAvailability === "open" && poolQuoteReady
    : canBuy && walletCapacity !== 0n;
  const canSellNow = graduatedVenue
    ? poolAvailability === "open" && poolQuoteReady
    : canSell;

  const quoteSymbol = token.quoteSymbol ?? "WETH";
  const payingWith =
    side === "buy"
      ? quoteSymbol === "WETH"
        ? "ETH"
        : quoteSymbol
      : token.symbol;
  const receiving = side === "buy" ? token.symbol : quoteSymbol;

  // Buying spends the quote token, selling spends the token itself.
  const balanceOf = side === "buy" ? quoteToken : token.address;
  const { data: assetBalance } = useReadContract({
    address: balanceOf ?? undefined,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    query: { enabled: Boolean(balanceOf && address), refetchInterval: 15_000 }, // indexer-backed app: 5s RPC polling is churn, not freshness
  });
  const { data: nativeBalance } = useBalance({ address });

  useEffect(() => {
    const timeout = setTimeout(() => fetchQuote(token), 300);
    const refresh = poolMode
      ? setInterval(() => fetchQuote(token), 15_000)
      : venue === "curve" &&
          side === "buy" &&
          antiSnipeBps !== undefined &&
          antiSnipeBps > 0n
        ? setInterval(() => fetchQuote(token), 1_000)
        : undefined;
    return () => {
      clearTimeout(timeout);
      if (refresh !== undefined) clearInterval(refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, token.address, token.pool, venue, antiSnipeBps]);

  const visibleQuote = graduatedVenue && !poolQuoteReady ? null : quotePreview;
  const received =
    visibleQuote !== null ? Number(formatEther(visibleQuote)) : null;
  const atLeast =
    received === null ? null : received * (1 - SLIPPAGE_BPS / 10_000);

  // Compare the execution rate with the current curve rate to show order impact.
  const input = Number(amount);
  let inputWei = 0n;
  try {
    inputWei = parseEther(amount || "0");
  } catch {
    /* Invalid input remains disabled. */
  }
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
  const executionRate =
    received && input > 0
      ? side === "buy"
        ? input / received
        : received / input
      : null;
  const tradeImpact =
    !graduatedVenue && executionRate && token.price
      ? Math.abs(executionRate / token.price - 1) * 100
      : null;

  function applyPreset(percent: number) {
    if (presetBalance === undefined) return;
    const portion = (presetBalance * BigInt(percent)) / 100n;
    setAmount(formatEther(portion));
  }

  return (
    <section className="trade-panel" aria-label="Trade">
      <div className="side-toggle" role="group" aria-label="Buy or sell">
        <button
          type="button"
          className={side === "buy" ? "active buy" : ""}
          aria-pressed={side === "buy"}
          onClick={() => setSide("buy")}
        >
          Buy
        </button>
        <button
          type="button"
          className={side === "sell" ? "active sell" : ""}
          aria-pressed={side === "sell"}
          onClick={() => setSide("sell")}
        >
          Sell
        </button>
      </div>

      {poolAvailability === "pool-pending" && (
        <p className="notice" role="status">
          Graduation is complete. Waiting for the Icarus pool address before
          trading opens.
        </p>
      )}
      {poolAvailability === "adapter-unavailable" && (
        <p className="notice" role="status">
          Icarus trading is not configured here yet. The pool can be viewed in
          Icarus.
        </p>
      )}
      {poolAvailability === "paused" && (
        <p className="notice" role="status">
          Icarus has paused basic-pool swaps. Trading will resume when the pool
          is unpaused.
        </p>
      )}
      {poolAvailability === "checking" && (
        <p className="notice" role="status">
          {poolPauseError
            ? "Could not verify Icarus swap availability."
            : "Checking Icarus swap availability…"}
        </p>
      )}
      {state === "ready" && (
        <p className="notice" role="status">
          Bonding is complete. Trading pauses while the pool is seeded; this
          market moves to its pool once graduation is confirmed.
        </p>
      )}
      {sellAborts && (
        <p className="notice" role="status">
          Graduation is overdue. Selling is open again: your sale also aborts
          the stuck graduation, and the market graduates on its next sellout.
        </p>
      )}
      {state === "aborted" && (
        <p className="notice" role="status">
          Graduation was aborted after its timeout. Trading continues, and the
          market graduates on its next sellout.
        </p>
      )}
      {venue === "curve" &&
        paused === true &&
        side === "buy" &&
        state !== "ready" && (
          <p className="notice" role="status">
            Buying is paused by the guardian. Selling stays open.
          </p>
        )}

      <div className="trade-entry">
        <div className="amount-head">
          <label htmlFor="trade-amount">You pay</label>
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
            style={{
              fontSize:
                amount.length > 18
                  ? "20px"
                  : amount.length > 12
                    ? "24px"
                    : undefined,
            }}
            onChange={(event) => setAmount(event.target.value)}
          />
          <span className="amount-unit">{payingWith}</span>
        </div>
        {side === "buy" && Number.isFinite(input) && input > 0 && (
          <small className="trade-entry-usd">
            ≈ <UsdAmount weth={input} /> at the current ETH/USD rate
          </small>
        )}
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
                : <>
                    {formatEthAmount(received)} {receiving}
                    {side === "sell" ? <> (≈ <UsdAmount weth={received} />)</> : null}
                  </>
          }
        />
        <Row
          label="At least"
          value={
            atLeast === null ? "—" : <>
              {formatEthAmount(atLeast)} {receiving}
              {side === "sell" ? <> (≈ <UsdAmount weth={atLeast} />)</> : null}
            </>
          }
        />
        <Row label="Slippage limit" value={`${SLIPPAGE_BPS / 100}%`} />
        <Row
          label={graduatedVenue ? "Pool fee" : "Curve fee + creator tax"}
          value={
            graduatedVenue
              ? poolFeeBps === undefined
                ? "—"
                : `${(Number(poolFeeBps) / 100).toFixed(2)}%`
              : token.feeBps == null
                ? "—"
                : `${((token.feeBps + (token.creatorTaxBps ?? 0)) / 100).toFixed(2)}%`
          }
        />
        {!graduatedVenue && (
          <Row
            label="Trade impact"
            value={tradeImpact === null ? "—" : formatPercent(tradeImpact)}
            tone={tradeImpact !== null && tradeImpact > 5 ? "warn" : undefined}
          />
        )}
      </div>

      {address ? (
        <button
          type="button"
          className={`trade-submit ${tradeProgress?.side ?? side}${tradeProgress ? " processing" : ""}`}
          aria-busy={Boolean(tradeProgress)}
          disabled={
            isPending ||
            inputWei <= 0n ||
            buyFunding?.canFund === false ||
            (side === "buy" ? !canBuyNow : !canSellNow)
          }
          onClick={() => trade(side, token)}
        >
          <span aria-live="polite" aria-atomic="true">
            {tradeProgress
              ? tradeButtonLabel(tradeProgress.side, tradeProgress.phase)
              : tradeButtonLabel(side, null)}
          </span>
        </button>
      ) : authenticated ? (
        // Session restored but wagmi is still syncing the wallet: a working
        // "Sign in" button here would call login() on an active session and
        // surface the wallet's "already logged in" warning.
        <button
          className={`trade-submit ${side}`}
          type="button"
          disabled
          aria-busy="true"
        >
          Connecting session…
        </button>
      ) : (
        <button
          className={`trade-submit ${side}`}
          type="button"
          disabled={!privyReady}
          onClick={login}
        >
          Sign in to trade
        </button>
      )}
      {tradeMessage && !isPending && (
        <p className="trade-hint success" role="status">
          {tradeMessage}
        </p>
      )}
      {graduatedVenue && (
        <div className="trade-powered-by">
          <span>Powered by</span>
          <a
            href="https://icarus.finance/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Visit Icarus Finance (opens in a new tab)"
          >
            <span className="trade-powered-mark" aria-hidden="true">
              <img src="/icarus-mark.svg" alt="" />
            </span>
            <strong>Icarus</strong>
          </a>
        </div>
      )}
    </section>
  );
}
