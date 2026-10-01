// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CurveBondingCurve} from "./CurveBondingCurve.sol";

interface IAtomicFactory {
    function createFor(address creator, string calldata name_, string calldata symbol_, string calldata uri_, uint16 tax)
        external returns (address token, address curve);
}

/// @notice Optional launch and curve buy in one atomic transaction.
contract CurveLaunchAndBuy is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable factory;
    address public immutable quote;
    struct LaunchRequest {
        string name;
        string symbol;
        string uri;
        uint16 creatorTaxBps;
        uint256 maxSpend;
        uint256 minOut;
        uint256 deadline;
    }
    event TokensRescued(address indexed asset, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);

    constructor(address factory_, address quote_) {
        require(factory_ != address(0) && quote_ != address(0), "bad dependency");
        factory = factory_;
        quote = quote_;
    }

    function launchAndBuy(LaunchRequest calldata request) external nonReentrant returns (address token, address curve, uint256 bought) {
        require(request.maxSpend > 0 && block.timestamp <= request.deadline, "bad buy");
        uint256 beforeBalance = IERC20(quote).balanceOf(address(this));
        IERC20(quote).safeTransferFrom(msg.sender, address(this), request.maxSpend);
        (token, curve) = IAtomicFactory(factory).createFor(msg.sender, request.name, request.symbol, request.uri, request.creatorTaxBps);
        IERC20(quote).forceApprove(curve, request.maxSpend);
        bought = CurveBondingCurve(curve).buyTokensFor(msg.sender, request.maxSpend, request.minOut, request.deadline);
        uint256 refund = IERC20(quote).balanceOf(address(this)) - beforeBalance;
        if (refund > 0) IERC20(quote).safeTransfer(msg.sender, refund);
    }

    function rescueTokens(address asset, uint256 amount, address recipient) external nonReentrant {
        require(msg.sender == IAtomicFactoryOwner(factory).owner() && recipient != address(0), "owner only");
        IERC20(asset).safeTransfer(recipient, amount);
        emit TokensRescued(asset, amount, recipient);
    }

    function rescueNative(uint256 amount, address payable recipient) external nonReentrant {
        require(msg.sender == IAtomicFactoryOwner(factory).owner() && recipient != address(0), "owner only");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native rescue failed");
        emit NativeRescued(amount, recipient);
    }
}

interface IAtomicFactoryOwner {
    function owner() external view returns (address);
}
