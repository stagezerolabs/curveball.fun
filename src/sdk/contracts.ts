import { parseAbi } from "viem";

export const factoryAbi = parseAbi([
  "function quote() view returns (address)",
  "function launchFee() view returns (uint256)",
  "function launchFeeTreasury() view returns (address)",
  "function graduationTarget() view returns (uint256)",
  "function setGraduationTarget(uint256 nextTarget)",
  "function venue() view returns (address)",
  "function venueOf(address token) view returns (address)",
  "function setVenue(address nextVenue)",
  "function locker() view returns (address)",
  "function deployer() view returns (address)",
  "function escrow() view returns (address)",
  "function vault() view returns (address)",
  "function hook() view returns (address)",
  "function launchAndBuy() view returns (address)",
  "function holderReserve() view returns (address)",
  "function reserveBps(address) view returns (uint16)",
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
  "function initialize((address deployer,address escrow,address vault,address locker,address hook,address launchAndBuy,address holderReserve) services)",
  "function owner() view returns (address)",
  "function pendingOwner() view returns (address)",
  "function transferOwnership(address newOwner)",
  "function acceptOwnership()",
  "function setFeeDefaults(uint16 newFee,uint16 newCreatorShare,uint16 newBuybackShare,uint16 newTaxCap,address newTreasury)",
  "event FeeDefaultsUpdated(uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 creatorTaxCapBps,address treasury)",
  "function market(address) view returns (address curve,address creator,uint16 feeBps,uint16 creatorShareBps,uint16 buybackShareBps,uint16 creatorTaxBps,address treasury)",
  "function createToken(string name_,string symbol_,string uri_,uint16 creatorTaxBps,uint16 holderReserveBps) returns (address token,address curve)",
  "function graduate(address token)",
  "function createGraduatedPool(address token) returns (address pool)",
  "event LaunchCreated(address indexed token,address indexed curve,address indexed creator,string name,string symbol,string uri)",
  "event ReserveConfigured(address indexed token,uint16 reserveBps,uint256 amount)",
  "event LaunchFeePaid(address indexed creator,address indexed treasury,uint256 amount)",
  "event GraduationStarted(address indexed token,address indexed curve)",
  "event GraduationDeferred(address indexed token,bytes reason)",
  "event Graduated(address indexed token,address indexed pool,uint256 tokenLiquidity,uint256 quoteLiquidity,uint256 liquidity)",
]);

export const venueAbi = parseAbi(["function isMock() view returns (bool)"]);

export const curveAbi = parseAbi([
  "function quoteBuy(uint256 maxSpend) view returns (uint256 tokensOut,uint256 spent,uint256 curveQuote,uint256 fee,uint256 creatorTax)",
  "function quoteSell(uint256 amount) view returns (uint256 net,uint256 gross,uint256 fee,uint256 creatorTax)",
  "function buyTokens(uint256 maxSpend,uint256 minOut,uint256 deadline) returns (uint256 out)",
  "function sellTokens(uint256 amount,uint256 minOut,uint256 deadline) returns (uint256 net)",
  "function virtualToken() view returns (uint128)",
  "function initialVQ() view returns (uint256)",
  "function virtualQuote() view returns (uint128)",
  "function realQuote() view returns (uint128)",
  "function sold() view returns (uint128)",
  "function curveSupply() view returns (uint256)",
  "function ready() view returns (bool)",
  "function graduated() view returns (bool)",
  "function pool() view returns (address)",
  "function feeBps() view returns (uint16)",
  "function creatorTaxBps() view returns (uint16)",
  "event Trade(address indexed token,address indexed trader,bool isBuy,uint256 grossCurveQuote,uint256 netTraderQuote,uint256 feeQuote,uint256 creatorTaxQuote,uint256 tokenAmount,uint256 vQAfter,uint256 vTAfter,uint256 soldAfter)",
]);

export const lockerAbi = parseAbi([
  "function tokenOfPool(address pool) view returns (address)",
  "function claim(address pool)",
]);

export const escrowAbi = parseAbi([
  "function claimable(address launch,address asset,address recipient) view returns (uint256)",
  "function claim(address launch,address asset,address recipient) returns (uint256)",
  "event FeeAccrued(address indexed launch,address indexed asset,address indexed recipient,uint256 amount)",
  "event FeeClaimed(address indexed launch,address indexed asset,address indexed recipient,uint256 amount)",
]);

export const vaultAbi = parseAbi([
  "function quoteBalance(address launch) view returns (uint256)",
  "function memeBalance(address launch) view returns (uint256)",
  "function sweepCurve(address launch,uint256 maxSpend,uint256 minOut,uint256 deadline) returns (uint256)",
  "function sweepPool(address launch,uint256 maxSpend,uint256 minOut,uint256 deadline) returns (uint256)",
  "function claimVested(address launch,uint256 start,uint256 count) returns (uint256)",
  "event BuybackExecuted(address indexed launch,address indexed venue,uint256 quoteSpent,uint256 tokensBought)",
]);

export const launchAndBuyAbi = parseAbi([
  "function launchAndBuy((string name,string symbol,string uri,uint16 creatorTaxBps,uint16 holderReserveBps,uint256 maxSpend,uint256 minOut,uint256 deadline) request) returns (address token,address curve,uint256 bought)",
]);

export const holderReserveAbi = parseAbi([
  "function launches(address) view returns (address creator,address curve,address pool,address vault,uint256 reserve,uint256 committed,uint256 graduationBlock,uint256 roundCount)",
  "function rounds(address,uint256) view returns (uint256 snapshotBlock,uint256 amount,uint256 eligibleSupply)",
  "function claimable(address,uint256,address) view returns (uint256)",
  "function claimed(address,uint256,address) view returns (bool)",
  "function createRound(address token,uint256 snapshotBlock,uint256 amount) returns (uint256)",
  "function claim(address token,uint256 roundId,address holder) returns (uint256)",
  "event RoundCreated(address indexed token,uint256 indexed roundId,uint256 snapshotBlock,uint256 amount,uint256 eligibleSupply)",
  "event Claimed(address indexed token,uint256 indexed roundId,address indexed holder,uint256 amount)",
]);

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
