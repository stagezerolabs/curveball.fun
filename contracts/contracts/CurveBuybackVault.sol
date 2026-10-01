// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";

interface IVaultFactoryOwner {
    function owner() external view returns (address);
}

interface IVaultFactoryMarket {
    function market(address token) external view returns (
        address curve, address creator, uint16 feeBps, uint16 creatorShareBps,
        uint16 buybackShareBps, uint16 creatorTaxBps, address treasury
    );
}

interface IVaultCurve {
    function token() external view returns (address);
    function graduated() external view returns (bool);
    function pool() external view returns (address);
    function spotPrice() external view returns (uint256);
    function twapPrice() external view returns (uint256);
    function quoteBuy(uint256 maxSpend) external view returns (uint256 out, uint256 spent, uint256 curveQuote, uint256 fee, uint256 creatorTax);
    function buyTokens(uint256 maxSpend, uint256 minOut, uint256 deadline) external returns (uint256 out);
}

interface IVaultPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function getReserves() external view returns (uint256, uint256, uint256);
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
    function quote(address tokenIn, uint256 amountIn, uint256 granularity) external view returns (uint256);
    function observationLength() external view returns (uint256);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

/// @notice Launch-scoped fee custody. Bounded sweeps and vesting are added with their lifecycle slice.
contract CurveBuybackVault is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;
    struct Lot { uint128 amount; uint128 claimed; uint64 start; }
    uint256 public constant VESTING_WINDOW = 5 * 365 days;
    address public immutable factory;
    address public immutable quote;
    mapping(address => bool) public authorized;
    mapping(address => uint256) public quoteBalance;
    mapping(address => uint256) public memeBalance;
    mapping(address => Lot[]) public lots;
    uint256 public totalQuoteLiability;
    event QuoteCredited(address indexed launch, uint256 amount);
    event MemeCredited(address indexed launch, uint256 amount);
    event VestedClaimed(address indexed launch, address indexed recipient, uint256 amount);
    event BuybackExecuted(address indexed launch, address indexed venue, uint256 quoteSpent, uint256 tokensBought);
    event TokensRescued(address indexed asset, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);

    constructor(address factory_, address quote_) {
        require(factory_ != address(0) && quote_ != address(0), "bad dependency");
        factory = factory_;
        quote = quote_;
    }

    function authorize(address source) external {
        require(msg.sender == factory && source != address(0), "factory only");
        authorized[source] = true;
    }

    function creditQuote(address launch, uint256 amount) external {
        require(authorized[msg.sender] && launch != address(0) && amount > 0, "unauthorized credit");
        require(IERC20(quote).balanceOf(address(this)) >= totalQuoteLiability + amount, "unbacked credit");
        quoteBalance[launch] += amount;
        totalQuoteLiability += amount;
        emit QuoteCredited(launch, amount);
    }

    function creditMeme(address launch, uint256 amount) external {
        require(authorized[msg.sender] && launch != address(0) && amount > 0, "unauthorized credit");
        require(IERC20(launch).balanceOf(address(this)) >= memeBalance[launch] + amount, "unbacked credit");
        memeBalance[launch] += amount;
        lots[launch].push(Lot(amount.toUint128(), 0, uint64(block.timestamp)));
        emit MemeCredited(launch, amount);
    }

    function lotCount(address launch) external view returns (uint256) { return lots[launch].length; }

    function sweepCurve(address launch, uint256 maxSpend, uint256 minOut, uint256 deadline)
        external nonReentrant returns (uint256 received)
    {
        require(block.timestamp <= deadline && maxSpend > 0 && maxSpend <= quoteBalance[launch], "bad sweep");
        (address curve,,,,,,) = IVaultFactoryMarket(factory).market(launch);
        require(curve != address(0) && IVaultCurve(curve).token() == launch && !IVaultCurve(curve).graduated(), "wrong venue");
        uint256 spot = IVaultCurve(curve).spotPrice();
        uint256 referencePrice = IVaultCurve(curve).twapPrice();
        require(spot > 0 && _withinBps(spot, referencePrice, 500), "price deviated");
        (uint256 expected, uint256 spent, uint256 curveQuote,,) = IVaultCurve(curve).quoteBuy(maxSpend);
        require(expected >= minOut && expected > 0, "slippage");
        uint256 executionPrice = curveQuote * 1e18 / expected;
        require(executionPrice <= spot * 10_200 / 10_000, "impact too high");
        quoteBalance[launch] -= maxSpend;
        totalQuoteLiability -= maxSpend;
        IERC20(quote).forceApprove(curve, maxSpend);
        received = IVaultCurve(curve).buyTokens(maxSpend, minOut, deadline);
        require(received == expected, "quote changed");
        quoteBalance[launch] += maxSpend - spent;
        totalQuoteLiability += maxSpend - spent;
        require(IERC20(quote).balanceOf(address(this)) >= totalQuoteLiability, "quote deficit");
        require(IERC20(launch).balanceOf(address(this)) >= memeBalance[launch] + received, "meme deficit");
        memeBalance[launch] += received;
        lots[launch].push(Lot(received.toUint128(), 0, uint64(block.timestamp)));
        emit BuybackExecuted(launch, curve, spent, received);
    }

    function _withinBps(uint256 a, uint256 b, uint256 tolerance) private pure returns (bool) {
        uint256 difference = a > b ? a - b : b - a;
        return difference <= b * tolerance / 10_000;
    }

    function sweepPool(address launch, uint256 maxSpend, uint256 minOut, uint256 deadline)
        external nonReentrant returns (uint256 received)
    {
        require(block.timestamp <= deadline && maxSpend > 0 && maxSpend <= quoteBalance[launch], "bad sweep");
        (address curve,,,,,,) = IVaultFactoryMarket(factory).market(launch);
        require(curve != address(0) && IVaultCurve(curve).token() == launch && IVaultCurve(curve).graduated(), "wrong venue");
        address pool = IVaultCurve(curve).pool();
        require(pool != address(0) && IVaultPool(pool).observationLength() >= 2, "pool history too short");
        (uint256 expected, address asset0) = _checkedPoolQuote(pool, launch, maxSpend, minOut);
        quoteBalance[launch] -= maxSpend;
        totalQuoteLiability -= maxSpend;
        uint256 beforeMeme = IERC20(launch).balanceOf(address(this));
        IERC20(quote).safeTransfer(pool, maxSpend);
        if (asset0 == launch) IVaultPool(pool).swap(expected, 0, address(this), "");
        else IVaultPool(pool).swap(0, expected, address(this), "");
        received = IERC20(launch).balanceOf(address(this)) - beforeMeme;
        require(received == expected, "unexpected output");
        memeBalance[launch] += received;
        lots[launch].push(Lot(received.toUint128(), 0, uint64(block.timestamp)));
        emit BuybackExecuted(launch, pool, maxSpend, received);
    }

    function _checkedPoolQuote(address pool, address launch, uint256 maxSpend, uint256 minOut)
        private view returns (uint256 expected, address asset0)
    {
        asset0 = IVaultPool(pool).token0();
        address asset1 = IVaultPool(pool).token1();
        require((asset0 == quote && asset1 == launch) || (asset0 == launch && asset1 == quote), "wrong pool assets");
        (uint256 reserve0, uint256 reserve1,) = IVaultPool(pool).getReserves();
        uint256 reserveQuote = asset0 == quote ? reserve0 : reserve1;
        uint256 reserveMeme = asset0 == launch ? reserve0 : reserve1;
        require(reserveQuote > 0 && reserveMeme > 0, "empty pool");
        expected = IVaultPool(pool).getAmountOut(maxSpend, quote);
        uint256 twapOut = IVaultPool(pool).quote(quote, maxSpend, 1);
        require(expected >= minOut && expected > 0 && twapOut > 0, "slippage");
        require(_withinBps(expected, twapOut, 500), "price deviated");
        uint256 spotOut = maxSpend * reserveMeme / reserveQuote;
        require(expected >= spotOut * 9_800 / 10_000, "impact too high");
    }

    function claimVested(address launch, uint256 start, uint256 count) external nonReentrant returns (uint256 amount) {
        address recipient = IVaultFactoryOwner(factory).owner();
        require(msg.sender == recipient, "protocol owner only");
        require(count > 0 && count <= 50 && start < lots[launch].length, "bad range");
        uint256 end = start + count;
        if (end > lots[launch].length) end = lots[launch].length;
        for (uint256 i = start; i < end; i++) {
            Lot storage lot = lots[launch][i];
            uint256 elapsed = block.timestamp - lot.start;
            if (elapsed > VESTING_WINDOW) elapsed = VESTING_WINDOW;
            uint256 vested = uint256(lot.amount) * elapsed / VESTING_WINDOW;
            uint256 available = vested - lot.claimed;
            lot.claimed += available.toUint128();
            amount += available;
        }
        if (amount > 0) {
            memeBalance[launch] -= amount;
            IERC20(launch).safeTransfer(recipient, amount);
            emit VestedClaimed(launch, recipient, amount);
        }
    }

    function rescueTokens(address asset, uint256 amount, address recipient) external nonReentrant {
        require(msg.sender == IVaultFactoryOwner(factory).owner() && recipient != address(0), "owner only");
        uint256 reserved = asset == quote ? totalQuoteLiability : memeBalance[asset];
        uint256 balance = IERC20(asset).balanceOf(address(this));
        require(balance >= reserved && amount <= balance - reserved, "reserved asset");
        IERC20(asset).safeTransfer(recipient, amount);
        emit TokensRescued(asset, amount, recipient);
    }

    function rescueNative(uint256 amount, address payable recipient) external nonReentrant {
        require(msg.sender == IVaultFactoryOwner(factory).owner() && recipient != address(0), "owner only");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native rescue failed");
        emit NativeRescued(amount, recipient);
    }
}
