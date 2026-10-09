// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface IWrappedEther is IERC20 {
    function deposit() external payable;
}

/// @notice Testnet-only, inventory-backed 1:1 mock quote to WETH converter.
/// @dev This is a finite test fixture, not a production swap or redemption promise.
contract MockQuoteBridge is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable mockQuote;
    IWrappedEther public immutable weth;

    event Redeemed(address indexed wallet, uint256 amount);
    event Funded(address indexed wallet, uint256 amount);

    constructor(address mockQuote_, address weth_) payable {
        require(mockQuote_ != address(0) && weth_ != address(0) && mockQuote_ != weth_, "bad assets");
        require(mockQuote_.code.length > 0 && weth_.code.length > 0, "missing token");
        mockQuote = IERC20(mockQuote_);
        weth = IWrappedEther(weth_);
        if (msg.value > 0) weth.deposit{value: msg.value}();
    }

    function fund() external payable {
        require(msg.value > 0, "zero funding");
        weth.deposit{value: msg.value}();
        emit Funded(msg.sender, msg.value);
    }

    function redeem(uint256 amount, uint256 deadline) external nonReentrant returns (uint256) {
        require(amount > 0 && block.timestamp <= deadline, "bad redemption");
        require(weth.balanceOf(address(this)) >= amount, "bridge depleted");
        uint256 beforeBalance = mockQuote.balanceOf(address(this));
        mockQuote.safeTransferFrom(msg.sender, address(this), amount);
        require(mockQuote.balanceOf(address(this)) - beforeBalance == amount, "unsupported token");
        IERC20(address(weth)).safeTransfer(msg.sender, amount);
        emit Redeemed(msg.sender, amount);
        return amount;
    }
}
