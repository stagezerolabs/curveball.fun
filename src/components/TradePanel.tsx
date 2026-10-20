import { useEffect, useState } from "react";
import { usePrivy } from "@privy-io/react-auth";
import { Collapsible } from "@base-ui/react/collapsible";
import type { ReactNode } from "react";
import { formatEther, parseEther } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { curveLaunchpadAbi, erc20Abi } from "../sdk/contracts";
import { activeChainId, launchpadAddress } from "../lib/web3";
import { factoryForToken } from "../lib/marketFactories";
import { selectTradeState } from "../lib/marketState";
import { useStore } from "../app/useStore.js";
import { formatEthAmount, formatPercent } from "../lib/format.js";
import {
  getBuyFundingState,
  TradeFundingStatus,
} from "./TradeFundingStatus";
import { NATIVE_GAS_RESERVE } from "../sdk/sdk";
import type { Address } from "viem";
import type { Token } from "../types";
import { tradeButtonLabel } from "../lib/tradeProgress";

const SLIPPAGE_BPS = 300; // useStore sends minOut at 97% of the quote.
const PRESETS = [25, 50, 100];

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
    quoting,
    fetchQuote,
  } = useStore();
  const [explain, setExplain] = useState(false);
  const { ready: privyReady, authenticated, login } = usePrivy();
  const marketFactory = launchpadAddress ? factoryForToken(token.factory) : undefined;
  const { data: paused } = useReadContract({
    address: marketFactory, abi: curveLaunchpadAbi,
    functionName: "paused", chainId: activeChainId,
    query: { enabled: Boolean(marketFactory), refetchInterval: 30_000 },
  });
  const { data: quoteToken } = useReadContract({
    address: marketFactory,
    abi: curveLaunchpadAbi,
    functionName: "quoteToken",
    chainId: activeChainId,
    query: { enabled: Boolean(marketFactory) },
  });
  const { state, canBuy, canSell, sellAborts } = selectTradeState({
    ...token,
    paused: paused === true,
    nowSeconds: Math.floor(Date.now() / 1_000),
  });

  const quoteSymbol = token.quoteSymbol ?? "WETH";
  const payingWith = side === "buy" ? (quoteSymbol === "WETH" ? "ETH" : quoteSymbol) : token.symbol;
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
    if (token.graduated) return undefined;
    const timeout = setTimeout(() => fetchQuote(token), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, token.address, token.graduated]);

  const received = quotePreview !== null ? Number(formatEther(quotePreview)) : null;
  const atLeast = received === null ? null : received * (1 - SLIPPAGE_BPS / 10_000);

  // Compare the execution rate with the current curve rate to show order impact.
  const input = Number(amount);
  let inputWei = 0n;
  try { inputWei = parseEther(amount || "0"); } catch { /* Invalid input remains disabled. */ }
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
    executionRate && token.price
      ? Math.abs(executionRate / token.price - 1) * 100
      : null;

  function applyPreset(percent: number) {
    if (presetBalance === undefined) return;
    const portion = presetBalance * BigInt(percent) / 100n;
    setAmount(formatEther(portion));
  }

  if (state === "graduated") {
    return null;
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

      {state === "ready" && <p className="notice" role="status">Bonding is complete. Trading pauses while the pool is seeded; this market moves to its pool once graduation is confirmed.</p>}
      {sellAborts && <p className="notice" role="status">Graduation is overdue. Selling is open again: your sale also aborts the stuck graduation, and the market graduates on its next sellout.</p>}
      {state === "aborted" && <p className="notice" role="status">Graduation was aborted after its timeout. Trading continues, and the market graduates on its next sellout.</p>}
      {paused === true && side === "buy" && state !== "ready" && <p className="notice" role="status">Buying is paused by the guardian. Selling stays open.</p>}

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
        <Row label="At least" value={atLeast === null ? "—" : `${formatEthAmount(atLeast)} ${receiving}`} />
        <Row label="Slippage limit" value={`${SLIPPAGE_BPS / 100}%`} />
        <Row label="Curve fee + creator tax" value={token.feeBps == null ? "—" : `${((token.feeBps + (token.creatorTaxBps ?? 0)) / 100).toFixed(2)}%`} />
        <Row
          label="Trade impact"
          value={tradeImpact === null ? "—" : formatPercent(tradeImpact)}
          tone={tradeImpact !== null && tradeImpact > 5 ? "warn" : undefined}
        />
      </div>

      {address ? (
        <button
          type="button"
          className={`trade-submit ${tradeProgress?.side ?? side}${tradeProgress ? " processing" : ""}`}
          aria-busy={Boolean(tradeProgress)}
          disabled={isPending || inputWei <= 0n || buyFunding?.canFund === false || (side === "buy" ? !canBuy : !canSell)}
          onClick={() => trade(side, token)}
        >
          <span aria-live="polite" aria-atomic="true">{tradeProgress ? tradeButtonLabel(tradeProgress.side, tradeProgress.phase) : tradeButtonLabel(side, null)}</span>
        </button>
      ) : authenticated ? (
        // Session restored but wagmi is still syncing the wallet: a working
        // "Sign in" button here would call login() on an active session and
        // surface the wallet's "already logged in" warning.
        <button className={`trade-submit ${side}`} type="button" disabled aria-busy="true">
          Connecting session…
        </button>
      ) : (
        <button className={`trade-submit ${side}`} type="button" disabled={!privyReady} onClick={login}>
          Sign in to trade
        </button>
      )}
      {tradeMessage && !isPending && (
        <p className="trade-hint success" role="status">
          {tradeMessage}
        </p>
      )}

      <Collapsible.Root open={explain} onOpenChange={setExplain} className="trade-explain">
        <Collapsible.Trigger type="button">
          How curve trades work
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="7" />
            <path d="M10 9v5M10 6.5v.01" />
          </svg>
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <p>
            Every trade runs against a constant-product bonding curve held by the
            launchpad — no order book and no counterparty. The exchange rate
            changes with each buy and sell, so larger orders move the curve
            further. Your transaction
            reverts if the result lands below the slippage limit.
          </p>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  );
}
