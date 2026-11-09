// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CurveBuybackTreasury} from "./CurveBuybackTreasury.sol";
import {ICurveLaunchpad} from "./interfaces/ICurveLaunchpad.sol";
import {ICurveFeeEscrow} from "./interfaces/ICurveSingletons.sol";
import {IIcarusFactory} from "./interfaces/IIcarus.sol";
import {CurveMath} from "./libraries/CurveMath.sol";

/// @notice Splits fees into backed creator/protocol claims and a shared CURVE buyback treasury.
/// @dev Every credit must be backed by a balance the caller already transferred in. `totalOwed`
///      tracks all liabilities per asset, so `rescue` can only take the surplus.
contract CurveFeeEscrow is ICurveFeeEscrow, Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    address public immutable launchpad;
    address public immutable quoteToken;
    IIcarusFactory public immutable icarusFactory;
    CurveBuybackTreasury public immutable buybackTreasury;

    mapping(address account => mapping(address asset => uint256)) public claimable;
    mapping(address asset => uint256) public totalOwed;

    event FeeAccrued(
        address indexed token,
        address indexed asset,
        uint256 creatorAmount,
        uint256 buybackAmount,
        uint256 protocolAmount
    );
    event FeeClaimed(address indexed account, address indexed asset, uint256 amount);
    event Rescued(address indexed asset, address indexed to, uint256 amount);

    error Unauthorized();
    error InvalidAsset();
    error Unbacked();
    error ExceedsSurplus();
    error RenounceDisabled();

    constructor(
        address launchpad_,
        address quoteToken_,
        address icarusFactory_,
        address owner_,
        address buybackTreasury_
    ) Ownable(owner_) {
        buybackTreasury = CurveBuybackTreasury(buybackTreasury_);
        launchpad = launchpad_;
        quoteToken = quoteToken_;
        icarusFactory = IIcarusFactory(icarusFactory_);
    }

    /// @inheritdoc ICurveFeeEscrow
    /// @dev `asset` is the quote token (curve fees, pool fees) or `token` itself (pool fees).
    function distribute(address token, address asset, uint256 fee, uint256 tax) external nonReentrant {
        if (msg.sender != launchpad && msg.sender != ICurveLaunchpad(launchpad).locker()) revert Unauthorized();
        if (asset != quoteToken && asset != token) revert InvalidAsset();
        uint256 amount = fee + tax;
        if (IERC20(asset).balanceOf(address(this)) < totalOwed[asset] + amount) revert Unbacked();

        (address creator, uint16 creatorShareBps, uint16 buybackShareBps) = ICurveLaunchpad(launchpad).feePolicy(token);
        (uint256 toCreator, uint256 toBuyback, uint256 toProtocol) =
            CurveMath.splitFee(fee, tax, creatorShareBps, buybackShareBps);
        claimable[creator][asset] += toCreator;
        claimable[ICurveLaunchpad(launchpad).treasury()][asset] += toProtocol;
        totalOwed[asset] += toCreator + toProtocol;
        if (toBuyback != 0) {
            IERC20(asset).safeTransfer(address(buybackTreasury), toBuyback);
            buybackTreasury.fund(token, asset, toBuyback);
        }
        emit FeeAccrued(token, asset, toCreator, toBuyback, toProtocol);
    }

    /// @notice Pays the caller everything they are owed in `asset`; returns 0 when nothing is owed.
    function claim(address asset) external nonReentrant returns (uint256 amount) {
        amount = claimable[msg.sender][asset];
        if (amount == 0) return 0;
        claimable[msg.sender][asset] = 0;
        totalOwed[asset] -= amount;
        IERC20(asset).safeTransfer(msg.sender, amount);
        emit FeeClaimed(msg.sender, asset, amount);
    }

    /// @notice Forwards the seeded-pool observation boundary to the buyback treasury.
    function markGraduated(address token, address pool) external {
        if (msg.sender != launchpad) revert Unauthorized();
        buybackTreasury.markGraduated(token, pool);
    }

    /// @notice Sends `asset` the escrow holds beyond its liabilities.
    function rescue(address asset, address to, uint256 amount) external onlyOwner nonReentrant {
        if (amount > IERC20(asset).balanceOf(address(this)) - totalOwed[asset]) revert ExceedsSurplus();
        IERC20(asset).safeTransfer(to, amount);
        emit Rescued(asset, to, amount);
    }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }
}
