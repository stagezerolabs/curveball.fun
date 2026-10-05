import {
  getAccount, getBalance, getBytecode, readContract, simulateContract, switchChain,
  waitForTransactionReceipt, writeContract, type Config,
} from "@wagmi/core";
import { decodeAbiParameters, decodeEventLog, getAddress, zeroAddress, type Address, type Hash } from "viem";
import { applySlippage, createDeadline, validateTokenInput, type CurveballDeployment, type TokenInput } from "./curveballSdk";
import { erc20Abi } from "./contracts";
import { v2CurveAbi, v2EscrowAbi, v2FactoryAbi, v2LaunchAndBuyAbi, v2LockerAbi, v2VaultAbi } from "./v2Contracts";
import { CurveballSdkError, NATIVE_GAS_RESERVE, type ConfirmedTrade, type ConfirmedWrite, type TradeSide, type WagmiActions } from "./wagmiSdk";
import { validateV2Deployment } from "../v2Deployment";

const defaultActions: WagmiActions = { getAccount, getBalance, getBytecode, readContract, simulateContract, switchChain, waitForTransactionReceipt, writeContract };

// Some RPC endpoints briefly serve the pre-approval block after confirming the approval receipt.
async function simulateAfterApproval<T>(simulate: () => Promise<T>, approved: boolean): Promise<T> {
  for (let retry = 0; ; retry++) {
    try { return await simulate(); }
    catch (error) {
      if (!approved || retry >= 2 || !/0xfb8f41b2/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 100 * (retry + 1)));
    }
  }
}

// GraduationDeferred carries the graduation guard's raw revert data; surface the human part when it is an Error(string).
function decodeDeferredReason(reason: string): string | null {
  if (reason.startsWith("0x08c379a0")) {
    try {
      const [message] = decodeAbiParameters([{ type: "string" }], `0x${reason.slice(10)}` as `0x${string}`);
      if (message) return message;
    } catch { /* Fall through to the raw bytes. */ }
  }
  return reason === "" || reason === "0x" ? null : reason;
}

export type GraduationResult = {
  status: "graduated" | "deferred";
  /** True when the curve had already graduated and no transaction was sent. */
  already: boolean;
  pool: Address | null;
  tokenLiquidity: bigint | null;
  quoteLiquidity: bigint | null;
  liquidity: bigint | null;
  deferredReason: string | null;
  /** Confirmed transaction hashes sent by this call, in order. */
  transactions: Hash[];
};

type GraduationPreparation = ConfirmedWrite & { deferred: boolean; deferredReason: string | null };
type GraduationExecution = ConfirmedWrite & { pool: Address; tokenLiquidity: bigint; quoteLiquidity: bigint; liquidity: bigint };

export function createV2Sdk(config: Config, deployment: CurveballDeployment, actions: WagmiActions = defaultActions) {
  const factory = deployment.launchpad;

  async function ensureWallet(): Promise<Address> {
    const account = actions.getAccount(config);
    if (!account.address) throw new CurveballSdkError("Connect a wallet to continue.");
    if (account.chainId !== deployment.chainId) {
      const switched = await actions.switchChain(config, { chainId: deployment.chainId });
      if (switched.id !== deployment.chainId) throw new CurveballSdkError("Switch your wallet to the configured Curveball network.");
    }
    return getAddress(account.address);
  }

  async function confirm(hash: Hash): Promise<ConfirmedWrite> {
    const receipt = await actions.waitForTransactionReceipt(config, { chainId: deployment.chainId, hash, confirmations: 1 });
    if (receipt.status !== "success") throw new CurveballSdkError(`Transaction ${hash} reverted.`);
    return { hash, receipt };
  }

  async function readMarket(token: Address) {
    const market = await actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "market", args: [getAddress(token)], chainId: deployment.chainId });
    if (market[0] === zeroAddress) throw new CurveballSdkError("Unknown Curveball market.");
    return { curve: getAddress(market[0]), creator: getAddress(market[1]), feeBps: market[2], creatorShareBps: market[3], buybackShareBps: market[4], creatorTaxBps: market[5], treasury: getAddress(market[6]) };
  }

  async function quoteTrade(side: TradeSide, token: Address, input: bigint): Promise<bigint> {
    if (input <= 0n) throw new CurveballSdkError("Trade amount must be greater than zero.");
    const market = await readMarket(token);
    const result = await actions.readContract(config, { address: market.curve, abi: v2CurveAbi, functionName: side === "buy" ? "quoteBuy" : "quoteSell", args: [input], chainId: deployment.chainId });
    return result[0];
  }

  async function createToken(input: TokenInput & { creatorTaxBps?: number }) {
    const account = await ensureWallet();
    const token = validateTokenInput(input);
    const tax = input.creatorTaxBps ?? 0;
    if (!Number.isInteger(tax) || tax < 0 || tax > 50) throw new CurveballSdkError("Creator tax must be 0–0.5%.");
    const simulation = await actions.simulateContract(config, { account, address: factory, abi: v2FactoryAbi, functionName: "createToken", args: [token.name, token.symbol, token.uri, tax], chainId: deployment.chainId });
    const confirmed = await confirm(await actions.writeContract(config, simulation.request));
    return { ...confirmed, ...createdFromReceipt(confirmed.receipt) };
  }

  function createdFromReceipt(receipt: ConfirmedWrite["receipt"]) {
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({ abi: v2FactoryAbi, eventName: "LaunchCreated", data: log.data, topics: log.topics, strict: true });
        return { token: decoded.args.token, curve: decoded.args.curve, creator: decoded.args.creator, name: decoded.args.name, symbol: decoded.args.symbol };
      } catch { /* Another factory event may be in the receipt. */ }
    }
    throw new CurveballSdkError("Confirmed launch did not emit LaunchCreated.");
  }

  async function launchAndBuy(input: TokenInput & { creatorTaxBps?: number }, maxSpend: bigint) {
    const account = await ensureWallet();
    const token = validateTokenInput(input);
    const tax = input.creatorTaxBps ?? 0;
    if (!Number.isInteger(tax) || tax < 0 || tax > 50 || maxSpend <= 0n) throw new CurveballSdkError("Invalid initial buy or creator tax.");
    const [quote, wrapper, supply, curveSupply, initialVQ, feeBps, taxCap] = await Promise.all([
      actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "quote", chainId: deployment.chainId }),
      actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "launchAndBuy", chainId: deployment.chainId }),
      actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "supply", chainId: deployment.chainId }),
      actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "curveSupply", chainId: deployment.chainId }),
      actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "initialVQ", chainId: deployment.chainId }),
      actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "feeBps", chainId: deployment.chainId }),
      actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "creatorTaxCapBps", chainId: deployment.chainId }),
    ]);
    if (tax > taxCap) throw new CurveballSdkError("Creator tax exceeds the factory cap.");
    const budget = maxSpend * 10_000n / (10_000n + BigInt(feeBps) + BigInt(tax));
    const newVirtualToken = (supply * initialVQ + initialVQ + budget - 1n) / (initialVQ + budget);
    const quoted = supply - newVirtualToken;
    const minOut = applySlippage(quoted < curveSupply ? quoted : curveSupply, deployment.slippageBps);
    if (minOut <= 0n) throw new CurveballSdkError("Initial buy is too small.");
    const balance = await actions.readContract(config, { address: quote, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId: deployment.chainId });
    if (balance < maxSpend) {
      const missing = maxSpend - balance;
      const native = await actions.getBalance(config, { address: account, chainId: deployment.chainId });
      if (native.value < missing + NATIVE_GAS_RESERVE) throw new CurveballSdkError("Not enough ETH to wrap the required WETH and pay network fees.");
      const wrapping = await actions.simulateContract(config, { account, address: quote, abi: erc20Abi, functionName: "deposit", value: missing, chainId: deployment.chainId });
      await confirm(await actions.writeContract(config, wrapping.request));
    }
    const allowance = await actions.readContract(config, { address: quote, abi: erc20Abi, functionName: "allowance", args: [account, wrapper], chainId: deployment.chainId });
    const approved = allowance < maxSpend;
    if (approved) {
      const approval = await actions.simulateContract(config, { account, address: quote, abi: erc20Abi, functionName: "approve", args: [wrapper, maxSpend], chainId: deployment.chainId });
      await confirm(await actions.writeContract(config, approval.request));
    }
    const request = { name: token.name, symbol: token.symbol, uri: token.uri, creatorTaxBps: tax, maxSpend, minOut, deadline: createDeadline(Date.now(), deployment.deadlineSeconds) };
    const simulation = await simulateAfterApproval(() => actions.simulateContract(config, { account, address: wrapper, abi: v2LaunchAndBuyAbi, functionName: "launchAndBuy", args: [request], chainId: deployment.chainId }), approved);
    const confirmed = await confirm(await actions.writeContract(config, simulation.request));
    return { ...confirmed, ...createdFromReceipt(confirmed.receipt), minimumOutput: minOut };
  }

  async function trade(side: TradeSide, token: Address, input: bigint): Promise<ConfirmedTrade> {
    if (input <= 0n) throw new CurveballSdkError("Trade amount must be greater than zero.");
    const account = await ensureWallet();
    const market = await readMarket(token);
    const quote = await actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "quote", chainId: deployment.chainId });
    const asset = side === "buy" ? quote : getAddress(token);
    const balance = await actions.readContract(config, { address: asset, abi: erc20Abi, functionName: "balanceOf", args: [account], chainId: deployment.chainId });
    let wrappedAmount = 0n;
    if (balance < input) {
      if (side === "sell") throw new CurveballSdkError("Your token balance is too low for this sale.");
      wrappedAmount = input - balance;
      const native = await actions.getBalance(config, { address: account, chainId: deployment.chainId });
      if (native.value < wrappedAmount + NATIVE_GAS_RESERVE) throw new CurveballSdkError("Not enough ETH to wrap the required WETH and pay network fees.");
      const wrapping = await actions.simulateContract(config, { account, address: quote, abi: erc20Abi, functionName: "deposit", value: wrappedAmount, chainId: deployment.chainId });
      await confirm(await actions.writeContract(config, wrapping.request));
    }
    const allowance = await actions.readContract(config, { address: asset, abi: erc20Abi, functionName: "allowance", args: [account, market.curve], chainId: deployment.chainId });
    const approved = allowance < input;
    if (approved) {
      const approval = await actions.simulateContract(config, { account, address: asset, abi: erc20Abi, functionName: "approve", args: [market.curve, input], chainId: deployment.chainId });
      await confirm(await actions.writeContract(config, approval.request));
    }
    const quotedOutput = await quoteTrade(side, token, input);
    const minimumOutput = applySlippage(quotedOutput, deployment.slippageBps);
    if (minimumOutput <= 0n) throw new CurveballSdkError("Trade output is too small.");
    const simulation = await simulateAfterApproval(() => actions.simulateContract(config, { account, address: market.curve, abi: v2CurveAbi, functionName: side === "buy" ? "buyTokens" : "sellTokens", args: [input, minimumOutput, createDeadline(Date.now(), deployment.deadlineSeconds)], chainId: deployment.chainId }), approved);
    const confirmed = await confirm(await actions.writeContract(config, simulation.request));
    return { ...confirmed, side, input, quotedOutput, minimumOutput, wrappedAmount };
  }

  async function writeFactory(functionName: "graduate", token: Address): Promise<GraduationPreparation>;
  async function writeFactory(functionName: "createGraduatedPool", token: Address): Promise<GraduationExecution>;
  async function writeFactory(functionName: "graduate" | "createGraduatedPool", token: Address): Promise<GraduationPreparation | GraduationExecution> {
    const account = await ensureWallet();
    await readMarket(token);
    const simulation = await actions.simulateContract(config, { account, address: factory, abi: v2FactoryAbi, functionName, args: [token], chainId: deployment.chainId });
    const confirmed = await confirm(await actions.writeContract(config, simulation.request));
    for (const log of confirmed.receipt.logs) {
      if (log.address.toLowerCase() !== factory.toLowerCase()) continue;
      if (functionName === "graduate") {
        try {
          const deferred = decodeEventLog({ abi: v2FactoryAbi, eventName: "GraduationDeferred", data: log.data, topics: log.topics, strict: true });
          if (getAddress(deferred.args.token) === getAddress(token)) return { ...confirmed, deferred: true, deferredReason: decodeDeferredReason(deferred.args.reason) };
        } catch { /* A different factory event. */ }
        try {
          const started = decodeEventLog({ abi: v2FactoryAbi, eventName: "GraduationStarted", data: log.data, topics: log.topics, strict: true });
          if (getAddress(started.args.token) === getAddress(token)) return { ...confirmed, deferred: false, deferredReason: null };
        } catch { /* A different factory event. */ }
        continue;
      }
      try {
        const graduated = decodeEventLog({ abi: v2FactoryAbi, eventName: "Graduated", data: log.data, topics: log.topics, strict: true });
        if (getAddress(graduated.args.token) === getAddress(token)) {
          return { ...confirmed, pool: getAddress(graduated.args.pool), tokenLiquidity: graduated.args.tokenLiquidity, quoteLiquidity: graduated.args.quoteLiquidity, liquidity: graduated.args.liquidity };
        }
      } catch { /* A different factory event. */ }
    }
    throw functionName === "graduate"
      ? new CurveballSdkError("Confirmed graduation emitted neither GraduationStarted nor GraduationDeferred.")
      : new CurveballSdkError("Confirmed pool creation did not emit Graduated.");
  }

  async function graduateToIcarus(token: Address): Promise<GraduationResult> {
    await ensureWallet();
    const market = await readMarket(token);
    const [sold, curveSupply, ready, graduated, pool] = await Promise.all([
      actions.readContract(config, { address: market.curve, abi: v2CurveAbi, functionName: "sold", chainId: deployment.chainId }) as Promise<bigint>,
      actions.readContract(config, { address: market.curve, abi: v2CurveAbi, functionName: "curveSupply", chainId: deployment.chainId }) as Promise<bigint>,
      actions.readContract(config, { address: market.curve, abi: v2CurveAbi, functionName: "ready", chainId: deployment.chainId }) as Promise<boolean>,
      actions.readContract(config, { address: market.curve, abi: v2CurveAbi, functionName: "graduated", chainId: deployment.chainId }) as Promise<boolean>,
      actions.readContract(config, { address: market.curve, abi: v2CurveAbi, functionName: "pool", chainId: deployment.chainId }) as Promise<Address>,
    ]);
    const resolvedPool = pool === zeroAddress ? null : getAddress(pool);
    if (graduated) {
      return { status: "graduated", already: true, pool: resolvedPool, tokenLiquidity: null, quoteLiquidity: null, liquidity: null, deferredReason: null, transactions: [] };
    }
    if (sold < curveSupply) {
      const progress = curveSupply === 0n ? 0 : Number((sold * 10_000n) / curveSupply) / 100;
      throw new CurveballSdkError(`This curve is ${progress}% sold — graduation unlocks at 100%.`);
    }
    const transactions: Hash[] = [];
    if (!ready) {
      const prepared = await writeFactory("graduate", token);
      transactions.push(prepared.hash);
      if (prepared.deferred) {
        return { status: "deferred", already: false, pool: null, tokenLiquidity: null, quoteLiquidity: null, liquidity: null, deferredReason: prepared.deferredReason, transactions };
      }
    }
    const executed = await writeFactory("createGraduatedPool", token);
    transactions.push(executed.hash);
    return { status: "graduated", already: false, pool: executed.pool, tokenLiquidity: executed.tokenLiquidity, quoteLiquidity: executed.quoteLiquidity, liquidity: executed.liquidity, deferredReason: null, transactions };
  }

  async function claimPoolFees(locker: Address, pool: Address) {
    const account = await ensureWallet();
    const configured = await actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "locker", chainId: deployment.chainId });
    if (getAddress(locker) !== getAddress(configured)) throw new CurveballSdkError("Fee claim rejected: locker does not belong to Curveball.");
    const token = await actions.readContract(config, { address: configured, abi: v2LockerAbi, functionName: "tokenOfPool", args: [pool], chainId: deployment.chainId });
    if (token === zeroAddress) throw new CurveballSdkError("Fee claim rejected: pool is not registered.");
    const simulation = await actions.simulateContract(config, { account, address: configured, abi: v2LockerAbi, functionName: "claim", args: [pool], chainId: deployment.chainId });
    return confirm(await actions.writeContract(config, simulation.request));
  }

  async function claimEscrow(token: Address, asset: Address, recipient: Address) {
    const account = await ensureWallet();
    await readMarket(token);
    const escrow = await actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "escrow", chainId: deployment.chainId });
    const simulation = await actions.simulateContract(config, { account, address: escrow, abi: v2EscrowAbi, functionName: "claim", args: [token, asset, recipient], chainId: deployment.chainId });
    return confirm(await actions.writeContract(config, simulation.request));
  }

  async function sweepBuyback(token: Address, maxSpend: bigint, minOut: bigint) {
    const account = await ensureWallet();
    const market = await readMarket(token);
    const graduated = await actions.readContract(config, { address: market.curve, abi: v2CurveAbi, functionName: "graduated", chainId: deployment.chainId });
    const vault = await actions.readContract(config, { address: factory, abi: v2FactoryAbi, functionName: "vault", chainId: deployment.chainId });
    const simulation = await actions.simulateContract(config, { account, address: vault, abi: v2VaultAbi, functionName: graduated ? "sweepPool" : "sweepCurve", args: [token, maxSpend, minOut, createDeadline(Date.now(), deployment.deadlineSeconds)], chainId: deployment.chainId });
    return confirm(await actions.writeContract(config, simulation.request));
  }

  const validateDeployment = (expectedQuote?: Address) => validateV2Deployment({
    getBytecode: ({ address }) => actions.getBytecode(config, { address, chainId: deployment.chainId }),
    readContract: ({ address, abi, functionName }) => actions.readContract(config, { address, abi: abi as typeof v2FactoryAbi, functionName: functionName as "quote", chainId: deployment.chainId }),
  }, factory, expectedQuote);

  return Object.freeze({ deployment, validateDeployment, readMarket, quoteTrade, createToken, launchAndBuy, trade, graduate: (token: Address) => writeFactory("graduate", token), createGraduatedPool: (token: Address) => writeFactory("createGraduatedPool", token), graduateToIcarus, claimPoolFees, claimEscrow, sweepBuyback });
}
