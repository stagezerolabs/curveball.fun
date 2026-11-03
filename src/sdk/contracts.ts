import { parseAbi } from "viem";

/** ERC-20 plus WETH's deposit and withdraw, for the quote token and launch tokens. */
export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit() payable",
  "function withdraw(uint256 amount)",
]);

/** Icarus basic-pool reads; execution goes through Curveball's atomic swap adapter. */
export const icarusPoolAbi = parseAbi([
  "function token0() view returns (address)",
  "function token1() view returns (address)",
  "function getAmountOut(uint256 amountIn, address tokenIn) view returns (uint256)",
]);

export const icarusFactoryAbi = parseAbi([
  "function getPool(address tokenA, address tokenB, bool stable) view returns (address pool)",
  "function isPaused() view returns (bool)",
  "function getFee(address pool, bool stable) view returns (uint256)",
]);

export const icarusSwapAdapterAbi = parseAbi([
  "function launchpad() view returns (address)",
  "function quoteToken() view returns (address)",
  "function icarusFactory() view returns (address)",
  "function quoteExactIn(address token, bool buy, uint256 amountIn) view returns (uint256 amountOut)",
  "function swapExactIn(address token, bool buy, uint256 amountIn, uint256 minOut, uint256 deadline) returns (uint256 amountOut)",
]);

// The launchpad and its singletons, generated from the forge artifacts by `make -C contracts abis`.
export * from "./abis.generated";
