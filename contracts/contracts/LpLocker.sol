// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IIcarusPool} from "./interfaces/IIcarus.sol";

contract LpLocker is ReentrancyGuard, Ownable2Step {
    using SafeERC20 for IERC20;

    address public launchpad;
    address public treasury;
    uint16 public immutable creatorShareBps;
    mapping(address => address) public creatorOf;
    event LaunchpadSet(address indexed launchpad);
    event PoolRegistered(address indexed pool, address indexed creator);
    event TreasuryUpdated(address indexed previousTreasury, address indexed newTreasury);
    event FeesClaimed(address indexed pool, uint256 creator0, uint256 creator1, uint256 treasury0, uint256 treasury1);
    event TokensRescued(address indexed token, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);

    constructor(address t, uint16 share) Ownable(msg.sender) {
        require(share <= 10_000, "bad share");
        require(t != address(0), "bad treasury");
        treasury = t;
        creatorShareBps = share;
    }

    function setLaunchpad(address l) external onlyOwner {
        require(launchpad == address(0) && l != address(0), "already set");
        launchpad = l;
        emit LaunchpadSet(l);
    }

    function rescueTokens(address token, uint256 amount) external onlyOwner nonReentrant {
        require(creatorOf[token] == address(0), "locked LP");
        IERC20(token).safeTransfer(owner(), amount);
        emit TokensRescued(token, amount, owner());
    }

    function rescueNative(uint256 amount) external onlyOwner nonReentrant {
        (bool success,) = payable(owner()).call{value: amount}("");
        require(success, "native rescue failed");
        emit NativeRescued(amount, owner());
    }

    /// @notice Hands fee custody to a replacement treasury such as a multisig.
    /// @dev Authority follows the current fee recipient; there is no separate admin that can redirect fees.
    function setTreasury(address nextTreasury) external {
        require(msg.sender == treasury, "treasury only");
        require(nextTreasury != address(0), "bad treasury");
        address previousTreasury = treasury;
        treasury = nextTreasury;
        emit TreasuryUpdated(previousTreasury, nextTreasury);
    }

    function register(address pool, address creator) external {
        require(msg.sender == launchpad && creatorOf[pool] == address(0), "not launchpad");
        creatorOf[pool] = creator;
        emit PoolRegistered(pool, creator);
    }

    /// @notice Splits a pool's trading fees between its creator and the treasury.
    /// @dev The pool must be one this locker holds LP for: an unregistered `pool` is rejected, and the
    /// payout tokens are read from the pool itself rather than accepted from the caller. Amounts are
    /// measured as the balance delta across `claimFees()`, so a pool cannot authorise a payout larger
    /// than what it actually delivered. Both are required -- either alone lets a caller name a pool they
    /// control and drain unrelated tokens (including other markets' locked LP) out of this contract.
    function claim(address pool) external nonReentrant {
        address creator = creatorOf[pool];
        require(creator != address(0), "unknown pool");
        IERC20 t0 = IERC20(IIcarusPool(pool).token0());
        IERC20 t1 = IERC20(IIcarusPool(pool).token1());
        uint256 before0 = t0.balanceOf(address(this));
        uint256 before1 = t1.balanceOf(address(this));
        IIcarusPool(pool).claimFees();
        uint256 a = t0.balanceOf(address(this)) - before0;
        uint256 b = t1.balanceOf(address(this)) - before1;
        uint256 ca = a * creatorShareBps / 10_000;
        uint256 cb = b * creatorShareBps / 10_000;
        if (ca > 0) t0.safeTransfer(creator, ca);
        if (a > ca) t0.safeTransfer(treasury, a - ca);
        if (cb > 0) t1.safeTransfer(creator, cb);
        if (b > cb) t1.safeTransfer(treasury, b - cb);
        emit FeesClaimed(pool, ca, cb, a - ca, b - cb);
    }
}
