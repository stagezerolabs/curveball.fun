// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CurveToken} from "./CurveToken.sol";
import {ICurveLaunchpad} from "./interfaces/ICurveLaunchpad.sol";
import {IIcarusFactory, IIcarusPool} from "./interfaces/IIcarus.sol";

/// @notice Custodies every market's buyback fee share and spends it exclusively on CURVE burns.
contract CurveBuybackTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    uint256 private constant BPS = 10_000;
    /// @notice After a successful burn, public callers wait one day; the owner can act immediately.
    /// @dev Preserves permissionless liveness without giving public callers control of buyback timing
    ///      while a recent buyback has run.
    uint256 public constant STALENESS = 1 days;
    uint256 public constant BUYBACK_CHUNK_BPS = 2_500;
    uint256 public constant MAX_IMPACT_BPS = 25;
    uint256 public constant SLIPPAGE_BPS = 100;
    uint256 private constant TWAP_WINDOWS = 2;

    address public immutable launchpad;
    address public immutable escrow;
    address public immutable quoteToken;
    IIcarusFactory public immutable icarusFactory;
    address public curveToken;
    uint256 public quoteBudget;
    uint256 public lastBuyback;
    mapping(address => uint256) public tokenBudget;
    mapping(address => uint256) public seedObservations;

    event Funded(address indexed market, address indexed asset, uint256 amount);
    event Converted(address indexed market, uint256 tokensSpent, uint256 quoteReceived);
    event CurveTokenSet(address indexed token);
    event BuybackBurned(address indexed token, uint256 quoteSpent, uint256 tokensBurned);
    event SwapSkipped(address indexed token, uint8 reason);

    error Unauthorized();
    error InvalidMarket();
    error InvalidTarget();
    error AlreadySet();
    error NotReady();
    error BuybackNotStale();
    error NothingToSpend();
    error RenounceDisabled();

    constructor(address launchpad_, address escrow_, address quoteToken_, address factory_, address owner_)
        Ownable(owner_)
    {
        launchpad = launchpad_;
        escrow = escrow_;
        quoteToken = quoteToken_;
        icarusFactory = IIcarusFactory(factory_);
    }

    /// @dev The escrow has transferred the credited asset before calling this function.
    function fund(address market, address asset, uint256 amount) external {
        if (msg.sender != escrow) revert Unauthorized();
        if (asset == quoteToken) {
            if (IERC20(asset).balanceOf(address(this)) < quoteBudget + amount) revert InvalidMarket();
            quoteBudget += amount;
        } else {
            if (asset != market || ICurveLaunchpad(launchpad).poolOf(market) == address(0)) revert InvalidMarket();
            if (IERC20(asset).balanceOf(address(this)) < tokenBudget[market] + amount) revert InvalidMarket();
            tokenBudget[market] += amount;
        }
        emit Funded(market, asset, amount);
    }

    /// @dev Called by escrow in the graduation transaction after the pool has been seeded.
    function markGraduated(address market, address pool) external {
        if (msg.sender != escrow || ICurveLaunchpad(launchpad).poolOf(market) != pool) revert Unauthorized();
        seedObservations[market] = IIcarusPool(pool).observationLength();
    }

    /// @notice The timelock permanently selects one factory market after its graduation.
    function setCurveToken(address token) external onlyOwner {
        if (curveToken != address(0)) revert AlreadySet();
        if (
            token == address(0) || ICurveLaunchpad(launchpad).poolOf(token) == address(0)
                || seedObservations[token] == 0
        ) revert InvalidTarget();
        curveToken = token;
        emit CurveTokenSet(token);
    }

    /// @notice Converts a market's LP-token fee share to WETH under its live-pool TWAP.
    function convert(address market) external nonReentrant returns (uint256 received) {
        uint256 balance = tokenBudget[market];
        if (balance == 0) revert NothingToSpend();
        IIcarusPool pool = IIcarusPool(ICurveLaunchpad(launchpad).poolOf(market));
        if (address(pool) == address(0)) revert InvalidMarket();
        pool.sync();
        if (!_observationsReady(pool, market)) return _skip(market, 0);
        bool tokenIs0 = pool.token0() == market;
        uint256 amountIn = _chunk(pool, tokenIs0, balance, true);
        if (amountIn == 0) return _skip(market, 0);
        (bool safe, uint256 amountOut) = _safeQuote(pool, market, amountIn);
        if (!safe) return _skip(market, 1);
        if (icarusFactory.isPaused()) return _skip(market, 2);
        uint256 minOut =
            amountOut * (BPS - icarusFactory.getFee(address(pool), false)) / BPS * (BPS - SLIPPAGE_BPS) / BPS;
        uint256 spotOut = pool.getAmountOut(amountIn, market);
        if (spotOut == 0 || spotOut < minOut) return _skip(market, 3);
        tokenBudget[market] = balance - amountIn;
        uint256 beforeBalance = IERC20(quoteToken).balanceOf(address(this));
        IERC20(market).safeTransfer(address(pool), amountIn);
        pool.swap(tokenIs0 ? 0 : spotOut, tokenIs0 ? spotOut : 0, address(this), "");
        received = IERC20(quoteToken).balanceOf(address(this)) - beforeBalance;
        quoteBudget += received;
        emit Converted(market, amountIn, received);
    }

    /// @notice Buys and burns only the permanently selected CURVE token.
    function buyback() external nonReentrant returns (uint256 burned) {
        return _buyback();
    }

    function _buyback() private returns (uint256 burned) {
        address token = curveToken;
        if (token == address(0)) revert NotReady();
        if (msg.sender != owner() && block.timestamp < lastBuyback + STALENESS) revert BuybackNotStale();
        uint256 balance = quoteBudget;
        if (balance == 0) revert NothingToSpend();
        IIcarusPool pool = IIcarusPool(ICurveLaunchpad(launchpad).poolOf(token));
        pool.sync();
        if (!_observationsReady(pool, token)) return _skip(token, 0);
        bool tokenIs0 = pool.token0() == token;
        uint256 amountIn = _chunk(pool, tokenIs0, balance, false);
        if (amountIn == 0) return _skip(token, 0);
        (bool safe, uint256 amountOut) = _safeQuote(pool, quoteToken, amountIn);
        if (!safe) return _skip(token, 1);
        if (icarusFactory.isPaused()) return _skip(token, 2);
        uint256 minOut =
            amountOut * (BPS - icarusFactory.getFee(address(pool), false)) / BPS * (BPS - SLIPPAGE_BPS) / BPS;
        uint256 spotOut = pool.getAmountOut(amountIn, quoteToken);
        if (spotOut == 0 || spotOut < minOut) return _skip(token, 3);
        quoteBudget = balance - amountIn;
        lastBuyback = block.timestamp;
        uint256 beforeBalance = IERC20(token).balanceOf(address(this));
        IERC20(quoteToken).safeTransfer(address(pool), amountIn);
        pool.swap(tokenIs0 ? spotOut : 0, tokenIs0 ? 0 : spotOut, address(this), "");
        burned = IERC20(token).balanceOf(address(this)) - beforeBalance;
        CurveToken(token).burn(burned);
        emit BuybackBurned(token, amountIn, burned);
    }

    function _safeQuote(IIcarusPool pool, address input, uint256 amount)
        private
        view
        returns (bool safe, uint256 output)
    {
        try pool.quote(input, amount, TWAP_WINDOWS) returns (uint256 quoted) {
            return (quoted != 0, quoted);
        } catch {
            return (false, 0);
        }
    }

    function _observationsReady(IIcarusPool pool, address market) private view returns (bool) {
        uint256 seed = seedObservations[market];
        uint256 length = pool.observationLength();
        return seed != 0 && length > TWAP_WINDOWS + 1 && length - 1 - TWAP_WINDOWS >= seed;
    }

    function _chunk(IIcarusPool pool, bool tokenIs0, uint256 balance, bool inputIsToken)
        private
        view
        returns (uint256 amount)
    {
        amount = balance * BUYBACK_CHUNK_BPS / BPS;
        if (amount == 0) amount = balance;
        (uint256 reserve0, uint256 reserve1,) = pool.getReserves();
        uint256 inputReserve = inputIsToken ? (tokenIs0 ? reserve0 : reserve1) : (tokenIs0 ? reserve1 : reserve0);
        uint256 max = inputReserve * MAX_IMPACT_BPS / BPS;
        if (amount > max) amount = max;
    }

    function _skip(address token, uint8 reason) private returns (uint256) {
        emit SwapSkipped(token, reason);
        return 0;
    }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
