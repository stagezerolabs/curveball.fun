import { parseAbi } from "viem";

export const launchpadAbi = parseAbi([
  "function escrow() view returns (address)",
  "function GRADUATION_TIMEOUT() view returns (uint256)",
  "function SUPPLY() view returns (uint256)",
  "function CURVE_SUPPLY() view returns (uint256)",
  "function market(address token) view returns ((address creator,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 taxBps,uint8 state,uint128 virtualToken,uint128 virtualQuote,uint128 initialVirtualQuote,uint128 realQuote,uint40 readyAt,address pool,uint40 launchedAt))",
  "function graduate(address token) returns (address pool)",
  "function abortGraduation(address token)",
  "event LaunchCreated(address indexed token,address indexed creator,string name,string symbol,string uri,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 taxBps)",
]);

export const escrowAbi = parseAbi([
  "function buybackTreasury() view returns (address)",
]);

export const buybackAbi = parseAbi([
  "function STALENESS() view returns (uint256)",
  "function owner() view returns (address)",
  "function tokenBudget(address token) view returns (uint256)",
  "function quoteBudget() view returns (uint256)",
  "function curveToken() view returns (address)",
  "function lastBuyback() view returns (uint256)",
  "function convert(address token) returns (uint256)",
  "function buyback() returns (uint256)",
  "event SwapSkipped(address indexed token,uint8 reason)",
]);
