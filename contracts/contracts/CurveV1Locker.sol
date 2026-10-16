// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IIcarusPool} from "./interfaces/IIcarus.sol";
import {CurveMemeHook} from "../historical/CurveMemeHook.sol";

/// @notice V1 custody for LP tokens created by the selected graduation adapter.
contract CurveV1Locker is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable factory;
    address public hook;
    mapping(address => address) public tokenOfPool;
    mapping(address => address) public creatorOfPool;
    event PoolRegistered(address indexed pool, address indexed token, address indexed creator);
    event TokensRescued(address indexed asset, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);

    constructor(address factory_) {
        require(factory_ != address(0), "bad factory");
        factory = factory_;
    }

    function setHook(address next) external {
        require(msg.sender == factory && hook == address(0) && next != address(0), "cannot bind hook");
        hook = next;
    }

    function register(address pool, address token, address creator) external {
        require(msg.sender == factory && tokenOfPool[pool] == address(0), "factory only");
        require(pool != address(0) && token != address(0) && creator != address(0), "bad registration");
        require(IERC20(pool).balanceOf(address(this)) > 0, "no LP");
        tokenOfPool[pool] = token;
        creatorOfPool[pool] = creator;
        emit PoolRegistered(pool, token, creator);
    }

    function claim(address pool) external nonReentrant {
        address token = tokenOfPool[pool];
        require(token != address(0) && hook != address(0), "unknown pool");
        address asset0 = IIcarusPool(pool).token0();
        address asset1 = IIcarusPool(pool).token1();
        uint256 before0 = IERC20(asset0).balanceOf(address(this));
        uint256 before1 = IERC20(asset1).balanceOf(address(this));
        IIcarusPool(pool).claimFees();
        uint256 amount0 = IERC20(asset0).balanceOf(address(this)) - before0;
        uint256 amount1 = IERC20(asset1).balanceOf(address(this)) - before1;
        if (amount0 > 0) IERC20(asset0).safeTransfer(hook, amount0);
        if (amount1 > 0) IERC20(asset1).safeTransfer(hook, amount1);
        CurveMemeHook(hook).route(pool, token, asset0, amount0, asset1, amount1);
    }

    function rescueTokens(address asset, uint256 amount, address recipient) external nonReentrant {
        require(msg.sender == ICurveLockerOwner(factory).owner() && recipient != address(0), "owner only");
        require(tokenOfPool[asset] == address(0), "locked LP");
        IERC20(asset).safeTransfer(recipient, amount);
        emit TokensRescued(asset, amount, recipient);
    }

    function rescueNative(uint256 amount, address payable recipient) external nonReentrant {
        require(msg.sender == ICurveLockerOwner(factory).owner() && recipient != address(0), "owner only");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native rescue failed");
        emit NativeRescued(amount, recipient);
    }
}

interface ICurveLockerOwner {
    function owner() external view returns (address);
}
