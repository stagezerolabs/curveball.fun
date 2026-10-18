// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CurveToken} from "./CurveToken.sol";
import {ICurveLaunchpad} from "./interfaces/ICurveLaunchpad.sol";
import {CurveMath} from "./libraries/CurveMath.sol";

/// @notice Singleton launchpad: launches fixed-supply tokens on virtual-reserve curves and graduates
///         each sold-out curve into an Icarus pool.
/// @dev Owner (a timelocked multisig) bounds fees and the graduation target for new launches only,
///      unpauses, and rotates the guardian. The guardian can only pause `launch` and `buy`.
contract CurveLaunchpad is ICurveLaunchpad, Ownable2Step, ReentrancyGuard {
    uint256 internal constant BPS = 10_000;
    uint256 public constant SUPPLY = 1_000_000 ether;
    uint256 public constant CURVE_SUPPLY = 800_000 ether;
    /// @dev The largest reserve for which the pool still gets enough tokens at the closing price:
    ///      the ideal seed is (S − C)·C/S, which leaves (S − C)²/S of the non-curve supply.
    uint256 public constant MAX_RESERVE_TOKENS = (SUPPLY - CURVE_SUPPLY) * (SUPPLY - CURVE_SUPPLY) / SUPPLY;
    uint256 public constant MAX_RESERVE_BPS = MAX_RESERVE_TOKENS * BPS / SUPPLY;
    uint256 public constant MAX_FEE_BPS = 200;
    uint256 public constant MAX_TAX_BPS = 50;
    uint256 public constant MAX_LAUNCH_FEE = 0.01 ether;
    /// @dev Far above the pool's MINIMUM_LIQUIDITY at any seed the curve can produce.
    uint256 public constant MIN_TARGET = 0.01 ether;
    uint256 public constant GRADUATION_TIMEOUT = 7 days;

    struct Config {
        address owner;
        address guardian;
        address treasury;
        address quoteToken;
        address icarusFactory;
        address escrow;
        address locker;
        address reserve;
        uint256 launchFee;
        uint256 graduationTarget;
        FeeDefaults fees;
    }

    struct FeeDefaults {
        uint16 feeBps;
        uint16 creatorShareBps;
        uint16 buybackShareBps;
        uint16 taxCapBps;
    }

    /// @dev Trading → Ready (sold out) → Graduated, or Ready → Aborted after `GRADUATION_TIMEOUT`.
    ///      Aborted is sticky: sells always work, buys while sold < C, graduation whenever sold == C.
    enum State {
        None,
        Trading,
        Ready,
        Graduated,
        Aborted
    }

    /// @dev `sold == SUPPLY − virtualToken` and, before graduation, `realQuote == virtualQuote − initialVirtualQuote`.
    struct Market {
        address creator;
        uint16 feeBps;
        uint16 creatorShareBps;
        uint16 buybackShareBps;
        uint16 taxBps;
        State state;
        uint128 virtualToken;
        uint128 virtualQuote;
        uint128 initialVirtualQuote;
        uint128 realQuote;
        uint128 reserveTokens;
        uint40 readyAt;
        address pool;
    }

    address public immutable treasury;
    address public immutable quoteToken;
    address public immutable icarusFactory;
    address public immutable escrow;
    address public immutable locker;
    address public immutable reserve;
    address public immutable tokenImplementation;
    uint256 public immutable launchFee;

    FeeDefaults public feeDefaults;
    uint256 public graduationTarget;
    address public guardian;
    bool public paused;
    /// @notice Quote owed to curve sellers across every ungraduated market.
    uint256 public totalRealQuote;

    mapping(address token => Market) public markets;
    mapping(address token => mapping(address account => uint256)) public held;

    event FeeDefaultsUpdated(uint16 feeBps, uint16 creatorShareBps, uint16 buybackShareBps, uint16 taxCapBps);
    event GraduationTargetUpdated(uint256 target);
    event GuardianUpdated(address indexed guardian);
    event Paused();
    event Unpaused();

    error InvalidConfig();
    error NotGuardian();
    error EnforcedPause();
    error RenounceDisabled();

    modifier whenNotPaused() {
        if (paused) revert EnforcedPause();
        _;
    }

    constructor(Config memory config) Ownable(config.owner) {
        if (
            config.treasury == address(0) || config.quoteToken == address(0) || config.icarusFactory == address(0)
                || config.escrow == address(0) || config.locker == address(0) || config.reserve == address(0)
                || config.launchFee > MAX_LAUNCH_FEE
        ) revert InvalidConfig();
        treasury = config.treasury;
        quoteToken = config.quoteToken;
        icarusFactory = config.icarusFactory;
        escrow = config.escrow;
        locker = config.locker;
        reserve = config.reserve;
        launchFee = config.launchFee;
        tokenImplementation = address(new CurveToken());
        _setGuardian(config.guardian);
        _setFeeDefaults(config.fees);
        _setGraduationTarget(config.graduationTarget);
    }

    // ---------------------------------------------------------------- admin

    /// @notice Fee policy for launches made from now on; existing markets keep their snapshot.
    function setFeeDefaults(FeeDefaults calldata fees) external onlyOwner {
        _setFeeDefaults(fees);
    }

    /// @notice Curve raise for launches made from now on.
    function setGraduationTarget(uint256 target) external onlyOwner {
        _setGraduationTarget(target);
    }

    function setGuardian(address guardian_) external onlyOwner {
        _setGuardian(guardian_);
    }

    /// @notice Stops new exposure: `launch` and `buy`. Sells, graduation, aborts and claims stay open.
    function pause() external {
        if (msg.sender != guardian) revert NotGuardian();
        paused = true;
        emit Paused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function renounceOwnership() public pure override {
        revert RenounceDisabled();
    }

    // ---------------------------------------------------------------- views

    /// @inheritdoc ICurveLaunchpad
    function curveSupply() external pure returns (uint256) {
        return CURVE_SUPPLY;
    }

    /// @inheritdoc ICurveLaunchpad
    function feePolicy(address token)
        external
        view
        returns (address creator, uint16 creatorShareBps, uint16 buybackShareBps)
    {
        Market storage m = markets[token];
        return (m.creator, m.creatorShareBps, m.buybackShareBps);
    }

    /// @inheritdoc ICurveLaunchpad
    function poolOf(address token) external view returns (address) {
        return markets[token].pool;
    }

    // ---------------------------------------------------------------- internal

    function _setFeeDefaults(FeeDefaults memory fees) internal {
        if (
            fees.feeBps > MAX_FEE_BPS || fees.taxCapBps > MAX_TAX_BPS
                || uint256(fees.creatorShareBps) + fees.buybackShareBps > BPS
        ) revert InvalidConfig();
        feeDefaults = fees;
        emit FeeDefaultsUpdated(fees.feeBps, fees.creatorShareBps, fees.buybackShareBps, fees.taxCapBps);
    }

    function _setGraduationTarget(uint256 target) internal {
        if (target < MIN_TARGET) revert InvalidConfig();
        // Reverts unless the target divides exactly into the starting virtual quote and fits uint128.
        CurveMath.initialVirtualQuote(target, SUPPLY, CURVE_SUPPLY);
        graduationTarget = target;
        emit GraduationTargetUpdated(target);
    }

    function _setGuardian(address guardian_) internal {
        if (guardian_ == address(0)) revert InvalidConfig();
        guardian = guardian_;
        emit GuardianUpdated(guardian_);
    }
}
