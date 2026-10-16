// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Custody for launch fees. The admin can recover all assets held here.
contract CurveLaunchFeeTreasury is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    event TokenWithdrawn(address indexed asset, address indexed recipient, uint256 amount);
    event NativeWithdrawn(address indexed recipient, uint256 amount);

    constructor(address admin) Ownable(admin) {}

    function renounceOwnership() public override onlyOwner {
        revert("treasury owner required");
    }

    function withdrawToken(address asset, uint256 amount, address recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "bad recipient");
        IERC20(asset).safeTransfer(recipient, amount);
        emit TokenWithdrawn(asset, recipient, amount);
    }

    function withdrawNative(uint256 amount, address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "bad recipient");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native withdrawal failed");
        emit NativeWithdrawn(recipient, amount);
    }

    receive() external payable {}
}
