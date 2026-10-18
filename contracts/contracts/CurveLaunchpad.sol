// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {CurveToken} from "./CurveToken.sol";
import {ICurveLaunchpad} from "./interfaces/ICurveLaunchpad.sol";
import {ICurveFeeEscrow, ICurveHolderReserve} from "./interfaces/ICurveSingletons.sol";
import {CurveMath} from "./libraries/CurveMath.sol";

/// @notice Singleton launchpad: launches fixed-supply tokens on virtual-reserve curves and graduates
///         each sold-out curve into an Icarus pool.
/// @dev Owner (a timelocked multisig) bounds fees and the graduation target for new launches only,
///      unpauses, and rotates the guardian. The guardian can only pause `launch` and `buy`.
contract CurveLaunchpad is ICurveLaunchpad, Ownable2Step, ReentrancyGuard {
    using SafeCast for uint256;
    using SafeERC20 for IERC20;

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
    uint256 internal constant MAX_URI_LENGTH = 2048;

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

    /// @dev Name 1–64 bytes and symbol 1–12 (checked by the token); uri 1–2048 bytes.
    struct Metadata {
        string name;
        string symbol;
        string uri;
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

    mapping(address token => Market) internal markets;
    mapping(address creator => uint256) public launchNonce;
    mapping(address token => mapping(address account => uint256)) public held;

    event LaunchCreated(
        address indexed token,
        address indexed creator,
        string name,
        string symbol,
        string uri,
        uint16 taxBps,
        uint256 reserveTokens
    );
    /// @param quoteAmount What the trader paid on a buy (curve quote, fee and tax) or received on a sell.
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 fee,
        uint256 tax,
        uint256 virtualToken,
        uint256 virtualQuote
    );
    event GraduationReady(address indexed token);
    event FeeDefaultsUpdated(uint16 feeBps, uint16 creatorShareBps, uint16 buybackShareBps, uint16 taxCapBps);
    event GraduationTargetUpdated(uint256 target);
    event GuardianUpdated(address indexed guardian);
    event Paused();
    event Unpaused();

    error InvalidConfig();
    error InvalidLaunch();
    error NotTrading();
    error Slippage();
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

    // ---------------------------------------------------------------- launch

    /// @notice Launches a token on a fresh curve, optionally buying from it in the same transaction.
    /// @dev The fee policy and starting virtual quote are snapshotted; later admin changes never reach
    ///      this market. `uri` is emitted, not stored. The first buy goes to the caller, like any buy.
    /// @param reserveBps Share of supply minted to the holder reserve, at most `MAX_RESERVE_BPS`.
    /// @param maxSpend Quote to spend on the first buy (curve quote, fee and tax); 0 skips it.
    function launch(Metadata calldata meta, uint16 taxBps, uint16 reserveBps, uint256 maxSpend, uint256 minOut)
        external
        nonReentrant
        whenNotPaused
        returns (address token, uint256 tokensOut)
    {
        uint256 uriLength = bytes(meta.uri).length;
        if (uriLength == 0 || uriLength > MAX_URI_LENGTH) revert InvalidLaunch();
        uint256 reserveTokens = SUPPLY * reserveBps / BPS;
        token = _createMarket(taxBps, reserveTokens);

        if (launchFee != 0) IERC20(quoteToken).safeTransferFrom(msg.sender, treasury, launchFee);
        CurveToken(token).initialize(meta.name, meta.symbol, SUPPLY, reserve, reserveTokens);
        if (reserveTokens != 0) ICurveHolderReserve(reserve).register(token, reserveTokens);
        _emitLaunch(token, meta, taxBps, reserveTokens);

        if (maxSpend != 0) tokensOut = _buy(token, maxSpend, minOut);
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

    function market(address token) external view returns (Market memory) {
        return markets[token];
    }

    /// @notice The address `creator`'s next launch will deploy its token at.
    function predictToken(address creator) external view returns (address) {
        return Clones.predictDeterministicAddress(tokenImplementation, _salt(creator, launchNonce[creator]));
    }

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

    /// @dev Clones the token at the caller's next deterministic address and snapshots its market.
    function _createMarket(uint16 taxBps, uint256 reserveTokens) internal returns (address token) {
        FeeDefaults memory fees = feeDefaults;
        if (taxBps > fees.taxCapBps || reserveTokens > MAX_RESERVE_TOKENS) revert InvalidLaunch();
        uint128 vQ0 = CurveMath.initialVirtualQuote(graduationTarget, SUPPLY, CURVE_SUPPLY).toUint128();
        token = Clones.cloneDeterministic(tokenImplementation, _salt(msg.sender, launchNonce[msg.sender]++));
        markets[token] = Market({
            creator: msg.sender,
            feeBps: fees.feeBps,
            creatorShareBps: fees.creatorShareBps,
            buybackShareBps: fees.buybackShareBps,
            taxBps: taxBps,
            state: State.Trading,
            virtualToken: uint128(SUPPLY),
            virtualQuote: vQ0,
            initialVirtualQuote: vQ0,
            realQuote: 0,
            reserveTokens: uint128(reserveTokens),
            readyAt: 0,
            pool: address(0)
        });
    }

    /// @dev Buys for `msg.sender`, the only recipient any curve buy can have.
    function _buy(address token, uint256 maxSpend, uint256 minOut) internal returns (uint256) {
        Market storage m = markets[token];
        State state = m.state;
        if (state != State.Trading && state != State.Aborted) revert NotTrading();
        uint256 vT = m.virtualToken;
        uint256 vQ = m.virtualQuote;
        uint256 remaining = vT - (SUPPLY - CURVE_SUPPLY);
        CurveMath.Buy memory b = CurveMath.quoteBuy(vT, vQ, remaining, maxSpend, m.feeBps, m.taxBps);
        if (b.tokensOut < minOut) revert Slippage();

        vT -= b.tokensOut;
        vQ += b.curveQuote;
        m.virtualToken = uint128(vT);
        m.virtualQuote = vQ.toUint128();
        m.realQuote += b.curveQuote.toUint128();
        totalRealQuote += b.curveQuote;
        held[token][msg.sender] += b.tokensOut;
        if (b.tokensOut == remaining && state == State.Trading) {
            m.state = State.Ready;
            m.readyAt = uint40(block.timestamp);
            emit GraduationReady(token);
        }

        IERC20(quoteToken).safeTransferFrom(msg.sender, address(this), b.curveQuote);
        if (b.fee + b.tax != 0) {
            IERC20(quoteToken).safeTransferFrom(msg.sender, escrow, b.fee + b.tax);
            ICurveFeeEscrow(escrow).distribute(token, quoteToken, b.fee, b.tax);
        }
        IERC20(token).safeTransfer(msg.sender, b.tokensOut);
        emit Trade(token, msg.sender, true, b.spent, b.tokensOut, b.fee, b.tax, vT, vQ);
        return b.tokensOut;
    }

    /// @dev Its own frame: emitting three calldata strings inside `launch` runs out of stack.
    function _emitLaunch(address token, Metadata calldata meta, uint16 taxBps, uint256 reserveTokens) internal {
        emit LaunchCreated(token, msg.sender, meta.name, meta.symbol, meta.uri, taxBps, reserveTokens);
    }

    function _salt(address creator, uint256 nonce) internal pure returns (bytes32) {
        return keccak256(abi.encode(creator, nonce));
    }

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
