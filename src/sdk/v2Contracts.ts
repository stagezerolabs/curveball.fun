import { parseAbi } from "viem";

export const v2FactoryAbi = parseAbi([
  "function quote() view returns (address)",
  "function icarusFactory() view returns (address)",
  "function locker() view returns (address)",
  "function deployer() view returns (address)",
  "function guard() view returns (address)",
  "function executor() view returns (address)",
  "function escrow() view returns (address)",
  "function vault() view returns (address)",
  "function hook() view returns (address)",
  "function launchAndBuy() view returns (address)",
  "function supply() view returns (uint256)",
  "function curveSupply() view returns (uint256)",
  "function initialVQ() view returns (uint256)",
  "function treasury() view returns (address)",
  "function creatorShareBps() view returns (uint16)",
  "function buybackShareBps() view returns (uint16)",
  "function feeBps() view returns (uint16)",
  "function creatorTaxCapBps() view returns (uint16)",
  "function publicLaunchOpen() view returns (bool)",
  "function invited(address) view returns (bool)",
  "function openPublicLaunch()",
  "function initialize((address deployer,address escrow,address vault,address guard,address executor,address locker,address hook,address launchAndBuy) services)",
  "function owner() view returns (address)",
  "function market(address) view returns (address curve,address creator,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 creatorTaxBps,address treasury)",
  "function createToken(string name_,string symbol_,string uri_,uint16 creatorTaxBps) returns (address token,address curve)",
  "function graduate(address token)",
  "function createGraduatedPool(address token) returns (address pool)",
  "event LaunchCreated(address indexed token,address indexed curve,address indexed creator,string name,string symbol,string uri)",
  "event GraduationStarted(address indexed token,address indexed curve)",
  "event GraduationDeferred(address indexed token,bytes reason)",
  "event Graduated(address indexed token,address indexed pool,uint256 tokenLiquidity,uint256 quoteLiquidity,uint256 liquidity)",
]);

export const v2CurveAbi = parseAbi([
  "function quoteBuy(uint256 maxSpend) view returns (uint256 tokensOut,uint256 spent,uint256 curveQuote,uint256 fee,uint256 creatorTax)",
  "function quoteSell(uint256 amount) view returns (uint256 net,uint256 gross,uint256 fee,uint256 creatorTax)",
  "function buyTokens(uint256 maxSpend,uint256 minOut,uint256 deadline) returns (uint256 out)",
  "function sellTokens(uint256 amount,uint256 minOut,uint256 deadline) returns (uint256 net)",
  "function virtualToken() view returns (uint128)",
  "function virtualQuote() view returns (uint128)",
  "function realQuote() view returns (uint128)",
  "function sold() view returns (uint128)",
  "function ready() view returns (bool)",
  "function graduated() view returns (bool)",
  "function pool() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function creatorTaxBps() view returns (uint16)",
  "event Trade(address indexed token,address indexed trader,bool isBuy,uint256 grossCurveQuote,uint256 netTraderQuote,uint256 feeQuote,uint256 creatorTaxQuote,uint256 tokenAmount,uint256 vQAfter,uint256 vTAfter,uint256 soldAfter)",
]);

export const v2LockerAbi = parseAbi([
  "function tokenOfPool(address pool) view returns (address)",
  "function claim(address pool)",
]);

export const v2EscrowAbi = parseAbi([
  "function claimable(address launch,address asset,address recipient) view returns (uint256)",
  "function claim(address launch,address asset,address recipient) returns (uint256)",
  "event FeeAccrued(address indexed launch,address indexed asset,address indexed recipient,uint256 amount)",
  "event FeeClaimed(address indexed launch,address indexed asset,address indexed recipient,uint256 amount)",
]);

export const v2VaultAbi = parseAbi([
  "function quoteBalance(address launch) view returns (uint256)",
  "function memeBalance(address launch) view returns (uint256)",
  "function sweepCurve(address launch,uint256 maxSpend,uint256 minOut,uint256 deadline) returns (uint256)",
  "function sweepPool(address launch,uint256 maxSpend,uint256 minOut,uint256 deadline) returns (uint256)",
  "function claimVested(address launch,uint256 start,uint256 count) returns (uint256)",
  "event BuybackExecuted(address indexed launch,address indexed venue,uint256 quoteSpent,uint256 tokensBought)",
]);

export const v2LaunchAndBuyAbi = parseAbi([
  "function launchAndBuy((string name,string symbol,string uri,uint16 creatorTaxBps,uint256 maxSpend,uint256 minOut,uint256 deadline) request) returns (address token,address curve,uint256 bought)",
]);
