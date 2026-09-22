import { parseAbi } from "viem";

export const launchpadAbi = parseAbi([
  "function quote() view returns (address)",
  "function factory() view returns (address)",
  "function locker() view returns (address)",
  "function supply() view returns (uint256)",
  "function curveSupply() view returns (uint256)",
  "function initialVQ() view returns (uint256)",
  "function markets(address) view returns (address creator, uint128 vt, uint128 vq, uint128 realQ, uint128 sold, bool graduated, bool pending, address pool)",
  "function createToken(string name, string symbol, string uri) returns (address token)",
  "function quoteBuy(address token, uint256 quoteIn) view returns (uint256 out)",
  "function quoteSell(address token, uint256 amount) view returns (uint256 out)",
  "function buyTokens(address token, uint256 quoteIn, uint256 minOut, uint256 deadline) returns (uint256 out)",
  "function sellTokens(address token, uint256 amount, uint256 minOut, uint256 deadline) returns (uint256 out)",
  "event TokenCreated(address indexed token, address indexed creator, string name, string symbol, string uri)",
  "event Trade(address indexed token, address indexed trader, bool isBuy, uint256 quoteAmount, uint256 tokenAmount, uint256 vQAfter, uint256 vTAfter, uint256 soldAfter)",
  "event Graduated(address indexed token, address indexed pool, uint256 tokenLiquidity, uint256 quoteLiquidity, uint256 liquidity)",
]);

export const lockerAbi = parseAbi([
  "function treasury() view returns (address)",
  "function setTreasury(address nextTreasury)",
  "function launchpad() view returns (address)",
  "function creatorShareBps() view returns (uint16)",
  "function creatorOf(address pool) view returns (address)",
  "function claim(address pool)",
]);

export const erc20Abi = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function deposit() payable",
]);

export const icarusFactoryAbi = parseAbi([
  "function isPool(address pool) view returns (bool)",
  "function getPool(address tokenA, address tokenB, bool stable) view returns (address)",
]);
