// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Asset-backed, per-launch fee credits. Each claim has a fixed recipient.
contract CurveFeeEscrow is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable factory;
    mapping(address => bool) public authorized;
    mapping(address => uint256) public totalLiability;
    mapping(address => mapping(address => mapping(address => uint256))) public claimable;
    event FeeAccrued(address indexed launch, address indexed asset, address indexed recipient, uint256 amount);
    event FeeClaimed(address indexed launch, address indexed asset, address indexed recipient, uint256 amount);
    event TokensRescued(address indexed asset, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);

    constructor(address factory_) {
        require(factory_ != address(0), "bad factory");
        factory = factory_;
    }

    function authorize(address source) external {
        require(msg.sender == factory && source != address(0), "factory only");
        authorized[source] = true;
    }

    function credit(address launch, address asset, address recipient, uint256 amount) external {
        require(authorized[msg.sender] && launch != address(0) && asset != address(0) && recipient != address(0), "unauthorized credit");
        require(amount > 0, "zero credit");
        require(IERC20(asset).balanceOf(address(this)) >= totalLiability[asset] + amount, "unbacked credit");
        totalLiability[asset] += amount;
        claimable[launch][asset][recipient] += amount;
        emit FeeAccrued(launch, asset, recipient, amount);
    }

    function claim(address launch, address asset, address recipient) external nonReentrant returns (uint256 amount) {
        amount = claimable[launch][asset][recipient];
        require(amount > 0, "nothing to claim");
        claimable[launch][asset][recipient] = 0;
        totalLiability[asset] -= amount;
        IERC20(asset).safeTransfer(recipient, amount);
        emit FeeClaimed(launch, asset, recipient, amount);
    }


    function rescueTokens(address asset, uint256 amount, address recipient) external nonReentrant {
        require(msg.sender == ICurveEscrowOwner(factory).owner() && recipient != address(0), "owner only");
        uint256 balance = IERC20(asset).balanceOf(address(this));
        uint256 reserved = totalLiability[asset];
        require(balance >= reserved && amount <= balance - reserved, "reserved asset");
        IERC20(asset).safeTransfer(recipient, amount);
        emit TokensRescued(asset, amount, recipient);
    }

    function rescueNative(uint256 amount, address payable recipient) external nonReentrant {
        require(msg.sender == ICurveEscrowOwner(factory).owner() && recipient != address(0), "owner only");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native rescue failed");
        emit NativeRescued(amount, recipient);
    }
}

interface ICurveEscrowOwner {
    function owner() external view returns (address);
}
