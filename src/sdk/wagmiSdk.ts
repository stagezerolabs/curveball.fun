import {
  getAccount,
  getBalance,
  getBytecode,
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
  type Config,
} from "@wagmi/core";
import {
  BaseError,
  ContractFunctionRevertedError,
  getAddress,
  zeroAddress,
  type Address,
  type Hash,
  type TransactionReceipt,
} from "viem";
import { erc20Abi, launchpadAbi, lockerAbi } from "./contracts";
import {
  applySlippage,
  createDeadline,
  findCreatedToken,
  validateTokenInput,
  walletNeedsChainSwitch,
  type CurveballDeployment,
  type TokenInput,
  RISE_MAINNET_CHAIN_ID,
} from "./curveballSdk";

export type TradeSide = "buy" | "sell";

export type CurveballRuntime = Readonly<{
  quote: Address;
  factory: Address;
  locker: Address;
  treasury: Address;
  supply: bigint;
  curveSupply: bigint;
  initialVirtualQuote: bigint;
  creatorShareBps: number;
  quoteName: string;
  quoteSymbol: string;
  quoteDecimals: number;
}>;

export type ExpectedRuntime = Partial<
  Pick<
    CurveballRuntime,
    | "quote"
    | "factory"
    | "treasury"
    | "supply"
    | "curveSupply"
    | "initialVirtualQuote"
    | "creatorShareBps"
    | "quoteSymbol"
    | "quoteDecimals"
  >
>;

export type ConfirmedWrite = Readonly<{
  hash: Hash;
  receipt: TransactionReceipt;
}>;

export type ConfirmedTrade = ConfirmedWrite &
  Readonly<{
    side: TradeSide;
    input: bigint;
    quotedOutput: bigint;
    minimumOutput: bigint;
    wrappedAmount: bigint;
  }>;

export type WagmiActions = Readonly<{
  getAccount: typeof getAccount;
  getBalance: typeof getBalance;
  getBytecode: typeof getBytecode;
  readContract: typeof readContract;
  simulateContract: typeof simulateContract;
  switchChain: typeof switchChain;
  waitForTransactionReceipt: typeof waitForTransactionReceipt;
  writeContract: typeof writeContract;
}>;

const defaultWagmiActions: WagmiActions = {
  getAccount,
  getBalance,
  getBytecode,
  readContract,
  simulateContract,
  switchChain,
  waitForTransactionReceipt,
  writeContract,
};

// Wrapping, approval, and the buy each consume native gas. Keep a small RISE
// gas buffer instead of allowing the wrap to drain the wallet completely.
export const NATIVE_GAS_RESERVE = 10_000_000_000_000n; // 0.00001 ETH

export class CurveballSdkError extends Error {
  constructor(
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CurveballSdkError";
  }
}

function explainError(error: unknown): CurveballSdkError {
  if (error instanceof CurveballSdkError) return error;
  if (error instanceof BaseError) {
    const reverted = error.walk(
      (candidate) => candidate instanceof ContractFunctionRevertedError,
    );
    if (reverted instanceof ContractFunctionRevertedError) {
      return new CurveballSdkError(
        reverted.data?.errorName ?? reverted.shortMessage,
        error,
      );
    }
    return new CurveballSdkError(error.shortMessage, error);
  }
  if (error instanceof Error) return new CurveballSdkError(error.message, error);
  return new CurveballSdkError("The wallet or network request failed.", error);
}

function sameAddress(left: string, right: string): boolean {
  return getAddress(left) === getAddress(right);
}

export function createWagmiCurveballSdk(
  config: Config,
  deployment: CurveballDeployment,
  actions: WagmiActions = defaultWagmiActions,
) {
  async function ensureWallet(): Promise<Address> {
    const account = actions.getAccount(config);
    if (!account.address) throw new CurveballSdkError("Connect a wallet to continue.");
    if (walletNeedsChainSwitch(account.chainId, deployment.chainId)) {
      const switched = await actions.switchChain(config, { chainId: deployment.chainId });
      if (switched.id !== deployment.chainId) {
        throw new CurveballSdkError("Switch your wallet to the configured Curveball network.");
      }
    }
    if (deployment.chainId === RISE_MAINNET_CHAIN_ID) {
      try {
        await Promise.all(["owner", "publicLaunchOpen", "totalReservedQuote"].map((functionName) =>
          actions.readContract(config, {
            address: deployment.launchpad,
            abi: launchpadAbi,
            functionName: functionName as "owner" | "publicLaunchOpen" | "totalReservedQuote",
            chainId: deployment.chainId,
          }),
        ));
      } catch {
        throw new CurveballSdkError("Mainnet launchpad is not the rescue-enabled v2 contract.");
      }
    }
    return getAddress(account.address);
  }

  async function confirm(hash: Hash): Promise<ConfirmedWrite> {
    const receipt = await actions.waitForTransactionReceipt(config, {
      chainId: deployment.chainId,
      hash,
      confirmations: 1,
    });
    if (receipt.status !== "success") {
      throw new CurveballSdkError(`Transaction ${hash} reverted.`);
    }
    return { hash, receipt };
  }

  async function validateDeployment(expected: ExpectedRuntime = {}): Promise<CurveballRuntime> {
    try {
      const bytecode = await actions.getBytecode(config, {
        address: deployment.launchpad,
        chainId: deployment.chainId,
      });
      if (!bytecode || bytecode === "0x") {
        throw new CurveballSdkError("No launchpad bytecode exists at the configured address.");
      }

      const [quote, factory, locker, supply, curveSupply, initialVirtualQuote] =
        await Promise.all([
          actions.readContract(config, {
            address: deployment.launchpad,
            abi: launchpadAbi,
            functionName: "quote",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: deployment.launchpad,
            abi: launchpadAbi,
            functionName: "factory",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: deployment.launchpad,
            abi: launchpadAbi,
            functionName: "locker",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: deployment.launchpad,
            abi: launchpadAbi,
            functionName: "supply",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: deployment.launchpad,
            abi: launchpadAbi,
            functionName: "curveSupply",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: deployment.launchpad,
            abi: launchpadAbi,
            functionName: "initialVQ",
            chainId: deployment.chainId,
          }),
        ]);
      const [treasury, creatorShareBps, lockerLaunchpad, quoteName, quoteSymbol, quoteDecimals] =
        await Promise.all([
          actions.readContract(config, {
            address: locker,
            abi: lockerAbi,
            functionName: "treasury",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: locker,
            abi: lockerAbi,
            functionName: "creatorShareBps",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: locker,
            abi: lockerAbi,
            functionName: "launchpad",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: quote,
            abi: erc20Abi,
            functionName: "name",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: quote,
            abi: erc20Abi,
            functionName: "symbol",
            chainId: deployment.chainId,
          }),
          actions.readContract(config, {
            address: quote,
            abi: erc20Abi,
            functionName: "decimals",
            chainId: deployment.chainId,
          }),
        ]);
      if (!sameAddress(lockerLaunchpad, deployment.launchpad)) {
        throw new CurveballSdkError("The configured locker is not bound to this launchpad.");
      }

      const runtime: CurveballRuntime = {
        quote: getAddress(quote),
        factory: getAddress(factory),
        locker: getAddress(locker),
        treasury: getAddress(treasury),
        supply,
        curveSupply,
        initialVirtualQuote,
        creatorShareBps,
        quoteName,
        quoteSymbol,
        quoteDecimals,
      };
      for (const [key, value] of Object.entries(expected)) {
        const actual = runtime[key as keyof CurveballRuntime];
        const matches =
          typeof value === "string" && typeof actual === "string" && value.startsWith("0x")
            ? sameAddress(value, actual)
            : actual === value;
        if (!matches) {
          throw new CurveballSdkError(
            `Deployment mismatch for ${key}: expected ${String(value)}, received ${String(actual)}.`,
          );
        }
      }
      return runtime;
    } catch (error) {
      throw explainError(error);
    }
  }

  async function quoteTrade(side: TradeSide, token: Address, input: bigint): Promise<bigint> {
    if (input <= 0n) throw new CurveballSdkError("Trade amount must be greater than zero.");
    try {
      return await actions.readContract(config, {
        address: deployment.launchpad,
        abi: launchpadAbi,
        functionName: side === "buy" ? "quoteBuy" : "quoteSell",
        args: [getAddress(token), input],
        chainId: deployment.chainId,
      });
    } catch (error) {
      throw explainError(error);
    }
  }

  async function createToken(input: TokenInput) {
    try {
      const account = await ensureWallet();
      const token = validateTokenInput(input);
      const simulation = await actions.simulateContract(config, {
        account,
        address: deployment.launchpad,
        abi: launchpadAbi,
        functionName: "createToken",
        args: [token.name, token.symbol, token.uri],
        chainId: deployment.chainId,
      });
      const confirmed = await confirm(await actions.writeContract(config, simulation.request));
      return { ...confirmed, ...findCreatedToken(confirmed.receipt) };
    } catch (error) {
      throw explainError(error);
    }
  }

  async function trade(side: TradeSide, token: Address, input: bigint): Promise<ConfirmedTrade> {
    try {
      if (input <= 0n) throw new CurveballSdkError("Trade amount must be greater than zero.");
      const account = await ensureWallet();
      const tokenAddress = getAddress(token);
      const quote = await actions.readContract(config, {
        address: deployment.launchpad,
        abi: launchpadAbi,
        functionName: "quote",
        chainId: deployment.chainId,
      });
      const asset = side === "buy" ? quote : tokenAddress;
      const balance = await actions.readContract(config, {
        address: asset,
        abi: erc20Abi,
        functionName: "balanceOf",
        args: [account],
        chainId: deployment.chainId,
      });
      let wrappedAmount = 0n;
      if (balance < input) {
        if (side === "sell") {
          throw new CurveballSdkError("Your token balance is too low for this sale.");
        }
        wrappedAmount = input - balance;
        const nativeBalance = await actions.getBalance(config, {
          address: account,
          chainId: deployment.chainId,
        });
        if (nativeBalance.value < wrappedAmount + NATIVE_GAS_RESERVE) {
          throw new CurveballSdkError(
            "Not enough ETH to wrap the required WETH and pay network fees.",
          );
        }
        const wrapping = await actions.simulateContract(config, {
          account,
          address: quote,
          abi: erc20Abi,
          functionName: "deposit",
          value: wrappedAmount,
          chainId: deployment.chainId,
        });
        await confirm(await actions.writeContract(config, wrapping.request));
      }

      const allowance = await actions.readContract(config, {
        address: asset,
        abi: erc20Abi,
        functionName: "allowance",
        args: [account, deployment.launchpad],
        chainId: deployment.chainId,
      });
      if (allowance < input) {
        const approval = await actions.simulateContract(config, {
          account,
          address: asset,
          abi: erc20Abi,
          functionName: "approve",
          args: [deployment.launchpad, input],
          chainId: deployment.chainId,
        });
        await confirm(await actions.writeContract(config, approval.request));
      }

      // Quote after approval confirmation so minOut is based on the freshest state.
      const quotedOutput = await quoteTrade(side, tokenAddress, input);
      const minimumOutput = applySlippage(quotedOutput, deployment.slippageBps);
      if (minimumOutput <= 0n) throw new CurveballSdkError("Trade output is too small.");
      const simulation = await actions.simulateContract(config, {
        account,
        address: deployment.launchpad,
        abi: launchpadAbi,
        functionName: side === "buy" ? "buyTokens" : "sellTokens",
        args: [
          tokenAddress,
          input,
          minimumOutput,
          createDeadline(Date.now(), deployment.deadlineSeconds),
        ],
        chainId: deployment.chainId,
      });
      const confirmed = await confirm(await actions.writeContract(config, simulation.request));
      return { ...confirmed, side, input, quotedOutput, minimumOutput, wrappedAmount };
    } catch (error) {
      throw explainError(error);
    }
  }

  async function claimPoolFees(locker: Address, pool: Address): Promise<ConfirmedWrite> {
    try {
      const account = await ensureWallet();
      const configuredLocker = await actions.readContract(config, {
        address: deployment.launchpad,
        abi: launchpadAbi,
        functionName: "locker",
        chainId: deployment.chainId,
      });
      if (!sameAddress(locker, configuredLocker)) {
        throw new CurveballSdkError("Fee claim rejected: locker does not belong to Curveball.");
      }
      const creator = await actions.readContract(config, {
        address: configuredLocker,
        abi: lockerAbi,
        functionName: "creatorOf",
        args: [getAddress(pool)],
        chainId: deployment.chainId,
      });
      if (creator === zeroAddress) {
        throw new CurveballSdkError("Fee claim rejected: pool is not registered.");
      }
      const simulation = await actions.simulateContract(config, {
        account,
        address: configuredLocker,
        abi: lockerAbi,
        functionName: "claim",
        args: [getAddress(pool)],
        chainId: deployment.chainId,
      });
      return await confirm(await actions.writeContract(config, simulation.request));
    } catch (error) {
      throw explainError(error);
    }
  }

  async function handoffTreasury(nextTreasury: Address): Promise<ConfirmedWrite> {
    try {
      const account = await ensureWallet();
      const configuredLocker = await actions.readContract(config, {
        address: deployment.launchpad,
        abi: launchpadAbi,
        functionName: "locker",
        chainId: deployment.chainId,
      });
      const currentTreasury = await actions.readContract(config, {
        address: configuredLocker,
        abi: lockerAbi,
        functionName: "treasury",
        chainId: deployment.chainId,
      });
      if (!sameAddress(account, currentTreasury)) {
        throw new CurveballSdkError("Treasury handoff requires the current treasury wallet.");
      }
      const replacement = getAddress(nextTreasury);
      if (replacement === zeroAddress || sameAddress(replacement, currentTreasury)) {
        throw new CurveballSdkError("Choose a different non-zero treasury address.");
      }
      const simulation = await actions.simulateContract(config, {
        account,
        address: configuredLocker,
        abi: lockerAbi,
        functionName: "setTreasury",
        args: [replacement],
        chainId: deployment.chainId,
      });
      return await confirm(await actions.writeContract(config, simulation.request));
    } catch (error) {
      throw explainError(error);
    }
  }

  return Object.freeze({
    deployment,
    validateDeployment,
    quoteTrade,
    createToken,
    trade,
    claimPoolFees,
    handoffTreasury,
  });
}

export type CurveballSdk = ReturnType<typeof createWagmiCurveballSdk>;
