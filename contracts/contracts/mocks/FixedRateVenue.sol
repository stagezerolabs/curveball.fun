// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Test-only 2,500 mUSDC per mWETH conversion, limited by funded mWETH inventory.
contract FixedRateVenue is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable input;
    address public immutable quote;
    uint256 public constant USDC_PER_WETH = 2_500;

    constructor(address input_, address quote_) {
        require(input_ != address(0) && quote_ != address(0) && input_ != quote_, "bad assets");
        input = input_;
        quote = quote_;
    }

    function quoteExactInput(uint256 amountIn) public pure returns (uint256) {
        return amountIn * 1e12 / USDC_PER_WETH;
    }

    function swapExactInput(uint256 amountIn, uint256 minOut, address recipient)
        external nonReentrant returns (uint256 amountOut)
    {
        require(amountIn > 0 && recipient != address(0), "bad swap");
        amountOut = quoteExactInput(amountIn);
        require(amountOut > 0 && amountOut >= minOut, "insufficient output");
        require(IERC20(quote).balanceOf(address(this)) >= amountOut, "venue depleted");
        IERC20(input).safeTransferFrom(msg.sender, address(this), amountIn);
        IERC20(quote).safeTransfer(recipient, amountOut);
    }
}
