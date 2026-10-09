// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test-only payment token. One public claim per address.
contract MockBetaUSDC is ERC20("Mock USDC", "mUSDC") {
    uint256 public constant CLAIM_AMOUNT = 1_000e6;
    mapping(address => bool) public claimed;

    function decimals() public pure override returns (uint8) { return 6; }

    function claim() external {
        require(!claimed[msg.sender], "already claimed");
        claimed[msg.sender] = true;
        _mint(msg.sender, CLAIM_AMOUNT);
    }
}
