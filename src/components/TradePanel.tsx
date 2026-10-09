import { useEffect, useState } from "react";
import { Button } from "@radix-ui/themes";
import { Collapsible } from "@base-ui/react/collapsible";
import type { ReactNode } from "react";
import { formatEther, parseEther } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { launchpadAbi } from "../sdk/contracts";
import { v2FactoryAbi } from "../sdk/v2Contracts";
import { activeChainId, activeContractVersion, activeExplorerUrl, launchpadAddress } from "../lib/web3";
import { getBetaReadEnabled, selectMarketState } from "../lib/marketState";
import { useStore } from "../app/useStore.js";
import { useTokenBalance } from "../sdk/react";
import { formatEthAmount, formatPercent } from "../lib/format.js";
import {
  getBuyFundingState,
  TradeFundingStatus,
} from "./TradeFundingStatus";
import { NATIVE_GAS_RESERVE } from "../sdk/wagmiSdk";
import type { Address } from "viem";
import type { Token } from "../types";
import { UsdAmount } from "./UsdAmount";
import { asdPayment, quoteAsdBuy } from "../sdk/asdPayment";
import { PaymentTokenPicker, type PaymentTokenOption } from "./PaymentTokenPicker";

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
    tradeWithAsd,
    tradeWithMockQuote,
    isPending,
    tradeMessage,
    quotePreview,
    quoting,
    fetchQuote,
    tokens,
  } = useStore();
  const [explain, setExplain] = useState(false);
  const [payment, setPayment] = useState<"WETH" | "ASD">("WETH");
  const [asdQuote, setAsdQuote] = useState<Awaited<ReturnType<typeof quoteAsdBuy>> | null>(null);
  const [asdQuoteError, setAsdQuoteError] = useState("");
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
  const { data: quoteToken } = useReadContract({
    address: launchpadAddress ?? undefined,
    abi: activeContractVersion === "v2" ? v2FactoryAbi : launchpadAbi,
    functionName: "quote",
    chainId: activeChainId,
    query: { enabled: Boolean(launchpadAddress) },
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

  const quoteSymbol = token.quoteSymbol ?? "WETH";
  const asdAvailable = Boolean(asdPayment && token.address.toLowerCase() !== asdPayment.token.toLowerCase());
  const asdMarketToken = tokens.find((candidate: Token) => candidate.address.toLowerCase() === asdPayment?.token.toLowerCase()) as Token | undefined;
  const paymentOptions: PaymentTokenOption<"WETH" | "ASD">[] = [
    { value: "WETH", symbol: "WETH", name: "Wrapped Ether", address: typeof quoteToken === "string" ? quoteToken : undefined },
    ...(asdAvailable ? [{ value: "ASD" as const, symbol: "ASD", name: asdMarketToken?.name ?? "ASD test token", imageUrl: asdMarketToken?.imageUrl, address: asdPayment?.token }] : []),
  ];
  const asdBuy = side === "buy" && payment === "ASD" && asdAvailable;
  const payingWith = side === "buy" ? asdBuy ? "ASD" : quoteSymbol : token.symbol;
  const receiving = side === "buy" ? token.symbol : quoteSymbol;

  // Buying spends the quote token, selling spends the token itself.
  const balanceOf = side === "buy" ? asdBuy ? asdPayment?.token : quoteToken : token.address;
  const { data: assetBalance } = useTokenBalance(
    (balanceOf ?? undefined) as Address | undefined,
    address,
  );
  const { data: nativeBalance } = useBalance({ address });
  const { data: mockQuoteBalance } = useTokenBalance(asdPayment?.mockQuote, address);

  useEffect(() => {
    if (token.graduated || asdBuy) return undefined;
    const timeout = setTimeout(() => fetchQuote(token), 300);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, side, token.address, token.graduated, asdBuy]);

  useEffect(() => {
    if (!asdBuy || !amount || token.graduated) { setAsdQuote(null); setAsdQuoteError(""); return; }
    let current = true;
    setAsdQuote(null);
    setAsdQuoteError("");
    const timeout = setTimeout(() => {
      let input: bigint;
      try { input = parseEther(amount); }
      catch { if (current) setAsdQuoteError("Enter a valid ASD amount."); return; }
      quoteAsdBuy(token.address, input)
        .then((result) => { if (current) setAsdQuote(result); })
        .catch((error: unknown) => { if (current) setAsdQuoteError(error instanceof Error ? error.message : "ASD quote unavailable."); });
    }, 300);
    return () => { current = false; clearTimeout(timeout); };
  }, [asdBuy, amount, token.address, token.graduated]);

  const received = asdBuy ? asdQuote ? Number(formatEther(asdQuote.tokensOut)) : null : quotePreview !== null ? Number(formatEther(quotePreview)) : null;
  const atLeast = asdBuy ? asdQuote ? Number(formatEther(asdQuote.minimumTokens)) : null : received === null ? null : received * (1 - SLIPPAGE_BPS / 10_000);

  // Execution price vs the current spot price: how far this size moves the curve.
  const input = Number(amount);
  let inputWei = 0n;
  try { inputWei = parseEther(amount || "0"); } catch { /* Invalid input remains disabled. */ }
  const insufficientAsd = asdBuy && assetBalance !== undefined && inputWei > assetBalance;
  const buyFunding =
    side === "buy" && !asdBuy
      ? getBuyFundingState(amount, assetBalance, nativeBalance?.value)
      : null;
  const presetBalance =
    side === "buy" && !asdBuy && assetBalance !== undefined && nativeBalance
      ? assetBalance +
        (nativeBalance.value > NATIVE_GAS_RESERVE
          ? nativeBalance.value - NATIVE_GAS_RESERVE
          : 0n)
      : assetBalance;
  const executionPrice = asdBuy ? null :
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

      {token.pending && <p className="notice" role="status">Graduation is ready. Anyone can create the Icarus pool. Selling remains available until then.</p>}
      {activeContractVersion === "v2" && !token.pending && (token.progress ?? 0) >= 100 && side === "buy" && <p className="notice" role="status">This curve is sold out. Buying will resume in the graduated pool; selling remains available for now.</p>}
      {!hasBetaAccess && side === "buy" && publicOpen === false && invited === false && <p className="notice" role="status">This deployed factory is still invite-only. Selling remains open.</p>}

      {side === "buy" && asdAvailable && <PaymentTokenPicker value={payment} options={paymentOptions} onChange={setPayment} />}

      <div className="amount-head">
        <label htmlFor="trade-amount">Amount</label>
        <div className="amount-presets">
          {PRESETS.map((percent) => (
            <Button
              key={percent}
              type="button"
              variant="ghost"
              size="1"
              disabled={presetBalance === undefined}
              onClick={() => applyPreset(percent)}
            >
              {percent === 100 ? "Max" : `${percent}%`}
            </Button>
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

      {side === "buy" && !asdBuy && (
        <TradeFundingStatus
          amount={amount}
          wethBalance={assetBalance}
          nativeBalance={nativeBalance?.value}
        />
      )}
      {asdBuy && <p className={`trade-hint ${insufficientAsd ? "warn" : ""}`}>{assetBalance === undefined ? "Checking ASD balance…" : `${formatEthAmount(Number(formatEther(assetBalance)))} ASD available`}</p>}
      {asdBuy && <p className="trade-hint">ASD sells on its curve, then mWETH converts to WETH, then WETH buys {token.symbol}. These are separate wallet transactions.</p>}
      {asdBuy && asdQuoteError && <p className="trade-hint warn" role="status">{asdQuoteError}</p>}

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
        {asdBuy && <Row label="ASD conversion" value={asdQuote ? `${formatEthAmount(Number(formatEther(asdQuote.quoteOut)))} WETH` : "—"} />}
        <Row
          label={asdBuy ? "Estimated after slippage" : "At least"}
          value={atLeast === null ? "—" : `${formatEthAmount(atLeast)} ${receiving}`}
        />
        {!asdBuy && <Row label="Price" value={<UsdAmount weth={token.price} />} />}
        <Row label="Slippage limit" value={`${SLIPPAGE_BPS / 100}%`} />
        {activeContractVersion === "v2" && <Row label="Curve fee + creator tax" value={token.feeBps == null ? "—" : `${((token.feeBps + (token.creatorTaxBps ?? 0)) / 100).toFixed(2)}%`} />}
        {!asdBuy && <Row
          label="Price impact"
          value={priceImpact === null ? "—" : formatPercent(priceImpact)}
          tone={priceImpact !== null && priceImpact > 5 ? "warn" : undefined}
        />}
      </div>

      {address ? (
        <Button
          type="button"
          className={`trade-submit ${side}`}
          size="3"
          disabled={isPending || inputWei <= 0n || buyFunding?.canFund === false || (side === "buy" && !canBuy) || (asdBuy && (!asdQuote || assetBalance === undefined || insufficientAsd))}
          onClick={() => asdBuy ? tradeWithAsd(token) : trade(side, token)}
        >
          {isPending ? "Pending…" : side === "buy" ? "Buy" : "Sell"}
        </Button>
      ) : (
        <Button className={`trade-submit ${side}`} type="button" size="3" disabled>
          {side === "buy" ? "Buy" : "Sell"}
        </Button>
      )}
      {!address && <p className="trade-hint">Connect from the navigation to trade.</p>}
      {asdBuy && mockQuoteBalance !== undefined && mockQuoteBalance > 0n && <div className="trade-recovery"><p>You have {formatEthAmount(Number(formatEther(mockQuoteBalance)))} mWETH from an earlier test. You can continue its conversion and buy without selling more ASD.</p><Button type="button" variant="outline" disabled={isPending || !canBuy} onClick={() => tradeWithMockQuote(token, mockQuoteBalance)}>Continue with mWETH</Button></div>}
      {tradeMessage && (
        <p className={`trade-hint ${isPending ? "" : "success"}`} role="status">
          {tradeMessage}
        </p>
      )}

      <Collapsible.Root open={explain} onOpenChange={setExplain} className="trade-explain">
        <Collapsible.Trigger type="button">
          How this trade is priced
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="10" cy="10" r="7" />
            <path d="M10 9v5M10 6.5v.01" />
          </svg>
        </Collapsible.Trigger>
        <Collapsible.Panel>
          <p>
            Every trade runs against a constant-product bonding curve held by the
            launchpad — no order book and no counterparty. The price moves with
            each buy and sell, so larger orders pay more. Your transaction
            reverts if the result lands below the slippage limit.
          </p>
        </Collapsible.Panel>
      </Collapsible.Root>
    </section>
  );
}
