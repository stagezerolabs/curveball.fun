// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {ICurveLaunchpad} from "./interfaces/ICurveLaunchpad.sol";
import {IIcarusFactory, IIcarusPool} from "./interfaces/IIcarus.sol";

/// @notice Atomic exact-input swaps on graduated Curveball tokens' Icarus basic pools.
/// @dev The adapter never holds input or output assets. It only uses the pool recorded by the
///      launchpad and confirmed by the configured Icarus factory; neither is caller-selectable.
contract CurveIcarusSwapAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;

    ICurveLaunchpad public immutable launchpad;
    IIcarusFactory public immutable icarusFactory;
    address public immutable quoteToken;

    error InvalidConfig();
    error InvalidTrade();
    error PoolUnavailable();
    error PoolMismatch();
    error PoolPaused();
    error Slippage();
    error Expired();

    event SwapExecuted(
        address indexed token,
        address indexed trader,
        address indexed pool,
        bool buy,
        uint256 amountIn,
        uint256 amountOut
    );

    constructor(address launchpad_, address quoteToken_, address icarusFactory_) {
        if (launchpad_.code.length == 0 || quoteToken_.code.length == 0 || icarusFactory_.code.length == 0) {
            revert InvalidConfig();
        }
        launchpad = ICurveLaunchpad(launchpad_);
        quoteToken = quoteToken_;
        icarusFactory = IIcarusFactory(icarusFactory_);
    }

    /// @notice Current fee-inclusive output for one graduated token/WETH basic-pool swap.
    function quoteExactIn(address token, bool buy, uint256 amountIn) external view returns (uint256 amountOut) {
        if (amountIn == 0) revert InvalidTrade();
        (IIcarusPool pool, address inputToken,) = _poolFor(token, buy);
        amountOut = pool.getAmountOut(amountIn, inputToken);
    }

    /// @notice Pulls the input asset, swaps through Icarus, and sends output to the caller atomically.
    /// @param token Curveball token whose graduated basic pool is used.
    /// @param buy True for WETH-to-token; false for token-to-WETH.
    /// @param amountIn Exact input amount in the input asset's smallest units.
    /// @param minOut Minimum acceptable output amount; protects against reserve and fee changes.
    /// @param deadline Last block timestamp at which this swap can execute.
    function swapExactIn(address token, bool buy, uint256 amountIn, uint256 minOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 amountOut)
    {
        if (amountIn == 0 || minOut == 0) revert InvalidTrade();
        if (block.timestamp > deadline) revert Expired();
        (IIcarusPool pool, address inputToken, bool outputIsToken0) = _poolFor(token, buy);
        amountOut = pool.getAmountOut(amountIn, inputToken);
        if (amountOut < minOut) revert Slippage();

        IERC20(inputToken).safeTransferFrom(msg.sender, address(pool), amountIn);
        pool.swap(outputIsToken0 ? amountOut : 0, outputIsToken0 ? 0 : amountOut, msg.sender, "");
        emit SwapExecuted(token, msg.sender, address(pool), buy, amountIn, amountOut);
    }

    function _poolFor(address token, bool buy)
        internal
        view
        returns (IIcarusPool pool, address inputToken, bool outputIsToken0)
    {
        if (token == address(0) || token == quoteToken) revert InvalidTrade();
        if (icarusFactory.isPaused()) revert PoolPaused();

        address poolAddress = launchpad.poolOf(token);
        if (poolAddress == address(0) || poolAddress != icarusFactory.getPool(token, quoteToken, false)) {
            revert PoolUnavailable();
        }
        pool = IIcarusPool(poolAddress);
        address token0 = pool.token0();
        address token1 = pool.token1();
        if (!((token0 == token && token1 == quoteToken) || (token0 == quoteToken && token1 == token))) {
            revert PoolMismatch();
        }
        inputToken = buy ? quoteToken : token;
        outputIsToken0 = buy ? token0 == token : token0 == quoteToken;
    }
}
