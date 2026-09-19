import { useEffect, useState } from "react";
import { formatEther } from "viem";
import { useStore } from "../app/useStore.js";
import { useTokenBalance } from "../sdk/react";
import { formatEthAmount, formatPercent } from "../lib/format.js";
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

  const quoteSymbol = token.quoteSymbol ?? config?.quoteSymbol ?? "ETH";
  const payingWith = side === "buy" ? quoteSymbol : token.symbol;
  const receiving = side === "buy" ? token.symbol : quoteSymbol;

  // Buying spends the quote token, selling spends the token itself.
  const balanceOf = side === "buy" ? config?.quoteToken : token.address;
  const { data: balance } = useTokenBalance(
    (balanceOf ?? undefined) as Address | undefined,
    address,
  );

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
    if (balance === undefined) return;
    const portion = (balance as bigint) * BigInt(percent) / 100n;
    setAmount(formatEther(portion));
  }

  if (token.graduated) {
    return (
      <section className="trade-panel">
        <p className="trade-graduated">
          <strong>This curve is complete.</strong> Liquidity has moved to Icarus —
          trade it there.
        </p>
        <a
          className="primary-button trade-submit"
          href={`https://icarus.finance/${token.address}`}
          target="_blank"
          rel="noreferrer"
        >
          Trade on Icarus
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

      <div className="amount-head">
        <label htmlFor="trade-amount">Amount</label>
        <div className="amount-presets">
          {PRESETS.map((percent) => (
            <button
              key={percent}
              type="button"
              disabled={balance === undefined}
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
        <Row label="Price" value={`${formatEthAmount(token.price)} ${quoteSymbol}`} />
        <Row label="Slippage limit" value={`${SLIPPAGE_BPS / 100}%`} />
        <Row
          label="Price impact"
          value={priceImpact === null ? "—" : formatPercent(priceImpact)}
          tone={priceImpact !== null && priceImpact > 5 ? "warn" : undefined}
        />
      </div>

      {address ? (
        <button
          className={`trade-submit ${side}`}
          disabled={isPending || !(input > 0)}
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
