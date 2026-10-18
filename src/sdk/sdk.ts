import {
  getAccount, getBalance, getBytecode, getTransactionReceipt, readContract, simulateContract, switchChain,
  waitForTransactionReceipt, writeContract,
} from "wagmi/actions";
import type { Config } from "wagmi";
import { decodeEventLog, getAddress, zeroAddress, type Address, type Hash, type TransactionReceipt } from "viem";
import { applySlippage, createDeadline, validateTokenInput, type CurveballDeployment, type TokenInput } from "./curveballSdk";
import { curveFeeEscrowAbi, curveHolderReserveAbi, curveLaunchpadAbi, curveLpLockerAbi, erc20Abi } from "./contracts";
import { validateLaunchpad } from "../deployment";

export type TradeSide = "buy" | "sell";
export type TradePhase = "preparing" | "wrapWallet" | "wrapConfirming" | "approveWallet" | "approveConfirming" | "tradeWallet" | "tradeConfirming";
export type TradeProgress = (phase: TradePhase) => void;
export type LaunchProgress = (phase: "preparing" | "wrapWallet" | "wrapConfirming" | "approveWallet" | "approveConfirming" | "wallet" | "confirming", hash?: Hash) => void;
export type ConfirmedWrite = Readonly<{ hash: Hash; receipt: TransactionReceipt }>;
export type ConfirmedTradeMarketState = Readonly<{
  sold: bigint;
  virtualQuote: bigint;
  virtualToken: bigint;
}>;
export type ConfirmedTrade = ConfirmedWrite & Readonly<{
  side: TradeSide;
  input: bigint;
  quotedOutput: bigint;
  minimumOutput: bigint;
  wrappedAmount: bigint;
  marketState: ConfirmedTradeMarketState | null;
}>;
export type LaunchInput = TokenInput & { creatorTaxBps?: number; holderReserveBps?: number };

/** The launchpad's market lifecycle, in its on-chain enum order. */
export const MARKET_STATES = ["none", "trading", "ready", "graduated", "aborted"] as const;
export type MarketLifecycle = (typeof MARKET_STATES)[number];

// The launchpad's SUPPLY and CURVE_SUPPLY constants; every market uses them.
export const TOKEN_SUPPLY = 1_000_000n * 10n ** 18n;
export const CURVE_SUPPLY = 800_000n * 10n ** 18n;

const defaultActions = { getAccount, getBalance, getBytecode, getTransactionReceipt, readContract, simulateContract, switchChain, waitForTransactionReceipt, writeContract };
export type WagmiActions = Readonly<typeof defaultActions>;

// Wrapping, approval, and the buy each consume native gas. Keep a small RISE
// gas buffer instead of allowing the wrap to drain the wallet completely.
export const NATIVE_GAS_RESERVE = 10_000_000_000_000n; // 0.00001 ETH

export class CurveballSdkError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = "CurveballSdkError";
  }
}

export class PendingTransactionError extends Error {
  constructor(readonly hash: Hash, readonly cause?: unknown) {
    super("Could not verify this transaction. Check its explorer status before retrying.");
    this.name = "PendingTransactionError";
  }
}

const CONFIRMATION_TIMEOUT_MS = 120_000;
const BPS = 10_000n;

/** Decodes the caller's own Trade from a receipt; the launchpad emits one per buy or sell. */
function tradeFromReceipt(receipt: TransactionReceipt, launchpad: Address, token: Address, trader: Address, side: TradeSide) {
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== launchpad.toLowerCase()) continue;
    try {
      const event = decodeEventLog({ abi: curveLaunchpadAbi, eventName: "Trade", data: log.data, topics: log.topics, strict: true });
      if (getAddress(event.args.token) === getAddress(token) && getAddress(event.args.trader) === trader && event.args.isBuy === (side === "buy")) {
        return event.args;
      }
    } catch { /* Ignore other launchpad events. */ }
  }
  return null;
}

/** Tokens a first buy of `maxSpend` receives on a fresh curve, mirroring CurveMath.quoteBuy. */
export function quoteFirstBuy(maxSpend: bigint, graduationTarget: bigint, feeBps: number, taxBps: number): bigint {
  const initialVirtualQuote = graduationTarget * (TOKEN_SUPPLY - CURVE_SUPPLY) / CURVE_SUPPLY;
  const budget = maxSpend * BPS / (BPS + BigInt(feeBps) + BigInt(taxBps));
  const k = TOKEN_SUPPLY * initialVirtualQuote;
  const denominator = initialVirtualQuote + budget;
  const tokensOut = TOKEN_SUPPLY - (k + denominator - 1n) / denominator;
  return tokensOut < CURVE_SUPPLY ? tokensOut : CURVE_SUPPLY;
}

// Some RPC endpoints briefly serve the pre-approval block after confirming the approval receipt.
async function simulateAfterApproval<T>(simulate: () => Promise<T>, approved: boolean): Promise<T> {
  for (let retry = 0; ; retry++) {
    try { return await simulate(); }
    catch (error) {
      if (!approved || retry >= 5 || !/0xfb8f41b2/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)));
    }
  }
}

export function createCurveballSdk(config: Config, deployment: CurveballDeployment, actions: WagmiActions = defaultActions) {
  const launchpad = deployment.launchpad;
  const chainId = deployment.chainId;

  async function ensureWallet(): Promise<Address> {
    const account = actions.getAccount(config);
    if (!account.address) throw new CurveballSdkError("Connect a wallet to continue.");
    // Wagmi's cached chain can lag the provider: Privy's embedded wallet provider starts on chain 1
    // without Wagmi seeing it, and viem then rejects the write. Ask the wallet itself.
    const walletChainId = await account.connector?.getChainId().catch(() => account.chainId) ?? account.chainId;
    if (walletChainId !== chainId) {
      const switched = await actions.switchChain(config, { chainId });
      if (switched.id !== chainId) throw new CurveballSdkError("Switch your wallet to the configured Curveball network.");
    }
    return getAddress(account.address);
  }

  async function confirm(hash: Hash): Promise<ConfirmedWrite> {
    let receipt;
    try {
      receipt = await actions.waitForTransactionReceipt(config, { chainId, hash, confirmations: 1, timeout: CONFIRMATION_TIMEOUT_MS });
    } catch (waitError) {
      try {
        receipt = await actions.getTransactionReceipt(config, { chainId, hash });
      } catch {
        throw new PendingTransactionError(hash, waitError);
      }
    }
    if (receipt.status !== "success") throw new CurveballSdkError(`Transaction ${hash} reverted.`);
    return { hash, receipt };
  }

  async function waitForAllowance(asset: Address, owner: Address, minimum: bigint) {
    let lastReadError: unknown;
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        const allowance = await actions.readContract(config, { address: asset, abi: erc20Abi, functionName: "allowance", args: [owner, launchpad], chainId });
        if (allowance >= minimum) return;
        lastReadError = undefined;
      } catch (error) {
        lastReadError = error;
      }
      if (attempt < 5) await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
    }
    if (lastReadError) throw lastReadError;
    throw new CurveballSdkError("Approval confirmed, but the token allowance is still unavailable. Check the approval in your wallet before retrying.");
  }

  const readQuoteToken = () => actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "quoteToken", chainId });

  async function readMarket(token: Address) {
    const market = await actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "market", args: [getAddress(token)], chainId });
    if (market.creator === zeroAddress) throw new CurveballSdkError("Unknown Curveball market.");
    return { ...market, lifecycle: MARKET_STATES[market.state] ?? "none" };
  }

  /** Wraps any missing ETH into the quote token and approves the launchpad for `amount` of `asset`. */
  async function ensureApproval(
    account: Address,
    asset: Address,
    amount: bigint,
    options: { wrap: boolean; onPhase?: (phase: "wrapWallet" | "wrapConfirming" | "approveWallet" | "approveConfirming", hash?: Hash) => void },
  ): Promise<{ approved: boolean; wrapped: bigint }> {
    if (amount === 0n) return { approved: false, wrapped: 0n };
    const balance = await actions.readContract(config, { address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId });
    let wrapped = 0n;
    if (balance < amount) {
      if (!options.wrap) throw new CurveballSdkError("Your token balance is too low for this sale.");
      wrapped = amount - balance;
      const native = await actions.getBalance(config, { address: account, chainId });
      if (native.value < wrapped + NATIVE_GAS_RESERVE) throw new CurveballSdkError("Not enough ETH to cover this transaction and network fees.");
      const wrapping = await actions.simulateContract(config, { account, address: asset, abi: erc20Abi, functionName: "deposit", value: wrapped, chainId });
      options.onPhase?.("wrapWallet");
      const wrapHash = await actions.writeContract(config, wrapping.request);
      options.onPhase?.("wrapConfirming", wrapHash);
      await confirm(wrapHash);
    }
    const allowance = await actions.readContract(config, { address: asset, abi: erc20Abi, functionName: "allowance", args: [account, launchpad], chainId });
    if (allowance >= amount) return { approved: false, wrapped };
    const approval = await actions.simulateContract(config, { account, address: asset, abi: erc20Abi, functionName: "approve", args: [launchpad, amount], chainId });
    options.onPhase?.("approveWallet");
    const approvalHash = await actions.writeContract(config, approval.request);
    options.onPhase?.("approveConfirming", approvalHash);
    await confirm(approvalHash);
    await waitForAllowance(asset, account, amount);
    return { approved: true, wrapped };
  }

  async function quoteTrade(side: TradeSide, token: Address, input: bigint): Promise<bigint> {
    if (input <= 0n) throw new CurveballSdkError("Trade amount must be greater than zero.");
    const address = getAddress(token);
    if (side === "buy") {
      const quote = await actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "previewBuy", args: [address, input], chainId });
      return quote.tokensOut;
    }
    const quote = await actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "previewSell", args: [address, input], chainId });
    return quote.net;
  }

  async function readLaunchPolicy() {
    const [fees, launchFee, graduationTarget, maxReserveBps] = await Promise.all([
      actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "feeDefaults", chainId }),
      actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "launchFee", chainId }),
      actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "graduationTarget", chainId }),
      actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName: "MAX_RESERVE_BPS", chainId }),
    ]);
    const [feeBps, , , taxCapBps] = fees;
    return { feeBps, taxCapBps, launchFee, graduationTarget, maxReserveBps: Number(maxReserveBps) };
  }

  /** Launches a token, with an optional first buy for the creator in the same transaction. */
  async function launch(input: LaunchInput, initialBuy: bigint, onProgress?: LaunchProgress) {
    onProgress?.("preparing");
    const account = await ensureWallet();
    const token = validateTokenInput(input);
    const policy = await readLaunchPolicy();
    const tax = input.creatorTaxBps ?? 0;
    if (!Number.isInteger(tax) || tax < 0 || tax > policy.taxCapBps) {
      throw new CurveballSdkError(`Creator tax must be 0–${policy.taxCapBps / 100}%.`);
    }
    const reserveBps = input.holderReserveBps ?? 0;
    if (!Number.isInteger(reserveBps) || reserveBps < 0 || reserveBps > policy.maxReserveBps) {
      throw new CurveballSdkError(`Holder reserve must be 0–${policy.maxReserveBps / 100}%.`);
    }
    if (initialBuy < 0n) throw new CurveballSdkError("Initial buy cannot be negative.");
    const minOut = initialBuy === 0n
      ? 0n
      : applySlippage(quoteFirstBuy(initialBuy, policy.graduationTarget, policy.feeBps, tax), deployment.slippageBps);
    if (initialBuy > 0n && minOut <= 0n) throw new CurveballSdkError("Initial buy is too small.");

    const quote = await readQuoteToken();
    const { approved } = await ensureApproval(account, quote, policy.launchFee + initialBuy, { wrap: true, onPhase: onProgress });
    const meta = { name: token.name, symbol: token.symbol, uri: token.uri };
    const simulation = await simulateAfterApproval(() => actions.simulateContract(config, {
      account, address: launchpad, abi: curveLaunchpadAbi, functionName: "launch", args: [meta, tax, reserveBps, initialBuy, minOut], chainId,
    }), approved);
    onProgress?.("wallet");
    const hash = await actions.writeContract(config, simulation.request);
    onProgress?.("confirming", hash);
    const confirmed = await confirm(hash);
    return { ...confirmed, ...launchedFromReceipt(confirmed.receipt), minimumOutput: minOut };
  }

  function launchedFromReceipt(receipt: ConfirmedWrite["receipt"]) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== launchpad.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: curveLaunchpadAbi, eventName: "LaunchCreated", data: log.data, topics: log.topics, strict: true });
        return { token: decoded.args.token, creator: decoded.args.creator, name: decoded.args.name, symbol: decoded.args.symbol };
      } catch { /* Another launchpad event may be in the receipt. */ }
    }
    throw new CurveballSdkError("Confirmed launch did not emit LaunchCreated.");
  }

  const createToken = (input: LaunchInput, onProgress?: LaunchProgress) => launch(input, 0n, onProgress);
  const launchAndBuy = (input: LaunchInput, maxSpend: bigint, onProgress?: LaunchProgress) => {
    if (maxSpend <= 0n) throw new CurveballSdkError("Invalid initial buy.");
    return launch(input, maxSpend, onProgress);
  };

  async function trade(side: TradeSide, token: Address, input: bigint, onProgress?: TradeProgress): Promise<ConfirmedTrade> {
    onProgress?.("preparing");
    if (input <= 0n) throw new CurveballSdkError("Trade amount must be greater than zero.");
    const account = await ensureWallet();
    const tokenAddress = getAddress(token);
    await readMarket(tokenAddress);
    const asset = side === "buy" ? await readQuoteToken() : tokenAddress;
    const { approved, wrapped } = await ensureApproval(account, asset, input, { wrap: side === "buy", onPhase: (phase) => onProgress?.(phase) });
    const quotedOutput = await quoteTrade(side, tokenAddress, input);
    const minimumOutput = applySlippage(quotedOutput, deployment.slippageBps);
    if (minimumOutput <= 0n) throw new CurveballSdkError("Trade output is too small.");
    const deadline = createDeadline(Date.now(), deployment.deadlineSeconds);
    const simulation = await simulateAfterApproval(() => actions.simulateContract(config, {
      account, address: launchpad, abi: curveLaunchpadAbi, functionName: side, args: [tokenAddress, input, minimumOutput, deadline], chainId,
    }), approved);
    onProgress?.("tradeWallet");
    const tradeHash = await actions.writeContract(config, simulation.request);
    onProgress?.("tradeConfirming");
    const confirmed = await confirm(tradeHash);
    const event = tradeFromReceipt(confirmed.receipt, launchpad, tokenAddress, account, side);
    return {
      ...confirmed,
      side,
      input,
      quotedOutput,
      minimumOutput,
      wrappedAmount: wrapped,
      marketState: event
        ? { sold: TOKEN_SUPPLY - event.virtualToken, virtualQuote: event.virtualQuote, virtualToken: event.virtualToken }
        : null,
    };
  }

  async function unwrapWeth(amount: bigint, expectedWeth: Address): Promise<ConfirmedWrite> {
    if (amount <= 0n) throw new CurveballSdkError("WETH amount must be greater than zero.");
    const account = await ensureWallet();
    const quote = await readQuoteToken();
    if (getAddress(quote) !== getAddress(expectedWeth)) throw new CurveballSdkError("This market does not use the expected WETH token.");
    const balance = await actions.readContract(config, { address: quote, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId });
    if (balance < amount) throw new CurveballSdkError("The WETH from this sale is no longer in your wallet.");
    const simulation = await actions.simulateContract(config, { account, address: quote, abi: erc20Abi, functionName: "withdraw", args: [amount], chainId });
    return confirm(await actions.writeContract(config, simulation.request));
  }

  async function sellAllForEth(token: Address, expectedWeth: Address, onProgress?: (phase: "approving" | "selling" | "sold" | "unwrapping", amount?: bigint, hash?: Hash) => void) {
    const account = await ensureWallet();
    const quote = await readQuoteToken();
    if (getAddress(quote) !== getAddress(expectedWeth)) throw new CurveballSdkError("This market does not use the expected WETH token.");
    const tokenAddress = getAddress(token);
    const balance = await actions.readContract(config, { address: tokenAddress, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId });
    if (balance <= 0n) throw new CurveballSdkError("There are no tokens left to sell in this wallet.");
    const sale = await trade("sell", tokenAddress, balance, (phase) => {
      if (phase === "approveWallet") onProgress?.("approving");
      if (phase === "tradeWallet") onProgress?.("selling");
    });
    // On a sell, the Trade event's quoteAmount is what the trader received.
    const received = tradeFromReceipt(sale.receipt, launchpad, tokenAddress, account, "sell")?.quoteAmount;
    if (!received || received <= 0n) throw new CurveballSdkError("Sale confirmed, but its WETH amount could not be verified. Check the transaction before unwrapping.");
    onProgress?.("sold", received, sale.hash);
    onProgress?.("unwrapping", received, sale.hash);
    const unwrap = await unwrapWeth(received, expectedWeth);
    return { sale, unwrap, amount: received };
  }

  async function write(address: Address, abi: unknown, functionName: string, args: readonly unknown[]): Promise<ConfirmedWrite> {
    const account = await ensureWallet();
    const simulation = await actions.simulateContract(config, { account, address, abi, functionName, args, chainId } as Parameters<WagmiActions["simulateContract"]>[1]);
    return confirm(await actions.writeContract(config, simulation.request));
  }

  const readSingleton = (functionName: "escrow" | "locker" | "reserve") =>
    actions.readContract(config, { address: launchpad, abi: curveLaunchpadAbi, functionName, chainId });

  /** Permissionless: sends a graduated pool's LP fees to the escrow for the market's split. */
  async function claimPoolFees(pool: Address) {
    const locker = await readSingleton("locker");
    const token = await actions.readContract(config, { address: locker, abi: curveLpLockerAbi, functionName: "tokenOf", args: [getAddress(pool)], chainId });
    if (token === zeroAddress) throw new CurveballSdkError("Fee claim rejected: pool is not registered.");
    return write(locker, curveLpLockerAbi, "claim", [getAddress(pool)]);
  }

  /** Pays the connected wallet everything the escrow owes it in `asset`, across all its launches. */
  async function claimEscrow(asset: Address) {
    return write(await readSingleton("escrow"), curveFeeEscrowAbi, "claim", [getAddress(asset)]);
  }

  /** Permissionless: spends one paced chunk of a graduated market's buyback balance and burns the tokens. */
  async function buyback(token: Address) {
    return write(await readSingleton("escrow"), curveFeeEscrowAbi, "buyback", [getAddress(token)]);
  }

  /** Pays the connected wallet its holder-reserve share of a graduated token. */
  async function claimReserve(token: Address) {
    return write(await readSingleton("reserve"), curveHolderReserveAbi, "claim", [getAddress(token)]);
  }

  /** Permissionless: seeds a sold-out market's pool and locks its LP. */
  const graduate = (token: Address) => write(launchpad, curveLaunchpadAbi, "graduate", [getAddress(token)]);

  /** Permissionless once a sold-out market has waited GRADUATION_TIMEOUT: reopens sells. */
  const abortGraduation = (token: Address) => write(launchpad, curveLaunchpadAbi, "abortGraduation", [getAddress(token)]);

  const validateDeployment = (expectedQuote?: Address) => validateLaunchpad({
    getBytecode: ({ address }) => actions.getBytecode(config, { address, chainId }),
    readContract: ({ address, abi, functionName }) =>
      actions.readContract(config, { address, abi, functionName, chainId } as Parameters<WagmiActions["readContract"]>[1]),
  }, launchpad, expectedQuote);

  return Object.freeze({
    deployment, validateDeployment, readMarket, quoteTrade, createToken, launchAndBuy, trade, sellAllForEth, unwrapWeth,
    claimPoolFees, claimEscrow, buyback, claimReserve, graduate, abortGraduation,
  });
}
