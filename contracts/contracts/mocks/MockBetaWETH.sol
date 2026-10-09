// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @notice Test-only curve quote. It is not backed by or redeemable for native ETH.
contract MockBetaWETH is ERC20, Ownable {
    constructor() ERC20("Mock Wrapped Ether", "mWETH") Ownable(msg.sender) {}

    function mint(address recipient, uint256 amount) external onlyOwner {
        _mint(recipient, amount);
    }
}
