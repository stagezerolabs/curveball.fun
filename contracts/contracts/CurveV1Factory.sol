// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CurveLaunchDeployer} from "./CurveLaunchDeployer.sol";
import {CurveBondingCurve} from "./CurveBondingCurve.sol";
import {CurveFeeEscrow} from "./CurveFeeEscrow.sol";
import {CurveBuybackVault} from "./CurveBuybackVault.sol";
import {CurveV1Locker} from "./CurveV1Locker.sol";
import {ICurveV1Venue} from "./interfaces/ICurveV1Venue.sol";
import {CurveLauncherToken} from "./CurveLauncherToken.sol";
import {CurveMemeHook} from "./CurveMemeHook.sol";
import {CurveLaunchAndBuy} from "./CurveLaunchAndBuy.sol";
import {CurveHolderReserve} from "./CurveHolderReserve.sol";

/// @notice Fresh V1 registry. Pricing and venue settings are snapshotted for each launch.
contract CurveV1Factory is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Market {
        address curve;
        address creator;
        uint16 feeBps;
        uint16 creatorShareBps;
        uint16 buybackShareBps;
        uint16 creatorTaxBps;
        address treasury;
    }

    struct Services {
        address deployer;
        address escrow;
        address vault;
        address locker;
        address hook;
        address launchAndBuy;
        address holderReserve;
    }

    address public immutable quote;
    address public immutable launchFeeTreasury;
    uint256 public immutable launchFee;
    uint256 public immutable supply;
    uint256 public immutable curveSupply;
    uint256 public graduationTarget;
    ICurveV1Venue public venue;
    CurveLaunchDeployer public deployer;
    CurveFeeEscrow public escrow;
    CurveBuybackVault public vault;
    CurveV1Locker public locker;
    CurveMemeHook public hook;
    CurveLaunchAndBuy public launchAndBuy;
    CurveHolderReserve public holderReserve;
    uint16 public feeBps = 75;
    uint16 public creatorShareBps = 5_000;
    uint16 public buybackShareBps = 2_500;
    uint16 public creatorTaxCapBps = 50;
    address public treasury;
    mapping(address => uint256) public creatorNonce;
    mapping(address => Market) public market;
    mapping(address => uint16) public reserveBps;
    mapping(address => address) public venueOf;

    event LaunchCreated(
        address indexed token, address indexed curve, address indexed creator, string name, string symbol, string uri
    );
    event FeeDefaultsUpdated(
        uint16 feeBps, uint16 creatorShareBps, uint16 buybackShareBps, uint16 creatorTaxCapBps, address treasury
    );
    event GraduationStarted(address indexed token, address indexed curve);
    event Graduated(
        address indexed token, address indexed pool, uint256 tokenLiquidity, uint256 quoteLiquidity, uint256 liquidity
    );
    event ServicesInitialized(address indexed deployer, address indexed escrow, address indexed vault);
    event TokensRescued(address indexed asset, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);
    event LaunchFeePaid(address indexed creator, address indexed treasury, uint256 amount);
    event GraduationDeferred(address indexed token, bytes reason);
    event ReserveConfigured(address indexed token, uint16 reserveBps, uint256 amount);
    event GraduationTargetUpdated(uint256 previousTarget, uint256 nextTarget);
    event VenueUpdated(address indexed previousVenue, address indexed nextVenue);

    constructor(
        address quote_,
        address treasury_,
        address launchFeeTreasury_,
        uint256 launchFee_,
        uint256 supply_,
        uint256 curveSupply_,
        uint256 graduationTarget_
    ) Ownable(msg.sender) {
        require(quote_ != address(0) && treasury_ != address(0), "bad dependency");
        require(supply_ > curveSupply_ && curveSupply_ > 0 && graduationTarget_ > 0, "bad curve");
        require(supply_ > curveSupply_ + supply_ * 500 / 10_000, "reserve leaves no pool");
        require(supply_ <= type(uint128).max, "curve too large");
        _initialVQ(graduationTarget_, supply_, curveSupply_);
        require(launchFee_ <= 0.01 ether, "launch fee too high");
        require(launchFee_ == 0 || launchFeeTreasury_.code.length > 0, "missing fee treasury");
        quote = quote_;
        launchFeeTreasury = launchFeeTreasury_;
        launchFee = launchFee_;
        treasury = treasury_;
        supply = supply_;
        curveSupply = curveSupply_;
        graduationTarget = graduationTarget_;
    }

    function initialize(Services calldata s) external onlyOwner nonReentrant {
        require(address(deployer) == address(0), "already initialized");
        require(
            s.deployer.code.length > 0 && s.escrow.code.length > 0 && s.vault.code.length > 0
                && s.locker.code.length > 0 && s.hook.code.length > 0 && s.launchAndBuy.code.length > 0
                && s.holderReserve.code.length > 0,
            "missing service"
        );
        require(
            CurveLaunchDeployer(s.deployer).factory() == address(this)
                && CurveFeeEscrow(s.escrow).factory() == address(this)
                && CurveBuybackVault(s.vault).factory() == address(this) && CurveBuybackVault(s.vault).quote() == quote
                && CurveV1Locker(s.locker).factory() == address(this)
                && CurveMemeHook(s.hook).factory() == address(this) && CurveMemeHook(s.hook).locker() == s.locker
                && CurveMemeHook(s.hook).quote() == quote && address(CurveMemeHook(s.hook).escrow()) == s.escrow
                && address(CurveMemeHook(s.hook).vault()) == s.vault
                && CurveLaunchAndBuy(s.launchAndBuy).factory() == address(this)
                && CurveLaunchAndBuy(s.launchAndBuy).quote() == quote
                && CurveHolderReserve(s.holderReserve).factory() == address(this),
            "service mismatch"
        );
        deployer = CurveLaunchDeployer(s.deployer);
        escrow = CurveFeeEscrow(s.escrow);
        vault = CurveBuybackVault(s.vault);
        locker = CurveV1Locker(s.locker);
        hook = CurveMemeHook(s.hook);
        launchAndBuy = CurveLaunchAndBuy(s.launchAndBuy);
        holderReserve = CurveHolderReserve(s.holderReserve);
        locker.setHook(s.hook);
        escrow.authorize(s.hook);
        vault.authorize(s.hook);
        emit ServicesInitialized(s.deployer, s.escrow, s.vault);
    }

    /// @notice Compatibility reads for clients of the invited-beta factory.
    function publicLaunchOpen() external view returns (bool) {
        return address(deployer) != address(0);
    }

    function invited(address) external pure returns (bool) {
        return false;
    }

    /// @notice Gross curve proceeds at sellout. Changes apply to launches made afterward.
    function setGraduationTarget(uint256 nextTarget) external onlyOwner {
        _initialVQ(nextTarget, supply, curveSupply);
        emit GraduationTargetUpdated(graduationTarget, nextTarget);
        graduationTarget = nextTarget;
    }

    function setVenue(address nextVenue) external onlyOwner {
        require(nextVenue.code.length > 0, "missing venue");
        ICurveV1Venue adapter = ICurveV1Venue(nextVenue);
        require(
            adapter.factory() == address(this) && adapter.quote() == quote && adapter.locker() == address(locker),
            "venue mismatch"
        );
        emit VenueUpdated(address(venue), nextVenue);
        venue = adapter;
    }

    function initialVQ() public view returns (uint256) {
        return _initialVQ(graduationTarget, supply, curveSupply);
    }

    function _initialVQ(uint256 target, uint256 total, uint256 soldSupply) private pure returns (uint256 value) {
        require(target > 0 && target <= type(uint128).max, "bad target");
        // A full sale collects initialVQ * curveSupply / (supply - curveSupply).
        // Require an exact ratio so the configured target is the quote asset deposited into the pool.
        uint256 remainder = total - soldSupply;
        require(target <= type(uint256).max / remainder, "target overflow");
        require(target * remainder % soldSupply == 0, "target precision");
        value = target * remainder / soldSupply;
        require(value > 0 && value <= type(uint128).max, "bad virtual reserve");
        require(target <= type(uint128).max - value, "target exceeds curve capacity");
    }

    function setFeeDefaults(
        uint16 newFee,
        uint16 newCreatorShare,
        uint16 newBuybackShare,
        uint16 newTaxCap,
        address newTreasury
    ) external onlyOwner {
        require(newFee <= 500 && newTaxCap <= 50 && newFee + newTaxCap <= 550, "fee too high");
        require(uint256(newCreatorShare) + newBuybackShare <= 10_000 && newTreasury != address(0), "bad split");
        feeBps = newFee;
        creatorShareBps = newCreatorShare;
        buybackShareBps = newBuybackShare;
        creatorTaxCapBps = newTaxCap;
        treasury = newTreasury;
        emit FeeDefaultsUpdated(newFee, newCreatorShare, newBuybackShare, newTaxCap, newTreasury);
    }

    function createToken(string calldata name_, string calldata symbol_, string calldata uri_, uint16 creatorTaxBps)
        external
        nonReentrant
        returns (address token, address curve)
    {
        return _createToken(msg.sender, name_, symbol_, uri_, creatorTaxBps, 500);
    }

    function createToken(
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint16 creatorTaxBps,
        uint16 holderReserveBps
    ) external nonReentrant returns (address token, address curve) {
        return _createToken(msg.sender, name_, symbol_, uri_, creatorTaxBps, holderReserveBps);
    }

    function createFor(
        address creator,
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint16 creatorTaxBps
    ) external nonReentrant returns (address token, address curve) {
        require(msg.sender == address(launchAndBuy), "wrapper only");
        return _createToken(creator, name_, symbol_, uri_, creatorTaxBps, 500);
    }

    function createFor(
        address creator,
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint16 creatorTaxBps,
        uint16 holderReserveBps
    ) external nonReentrant returns (address token, address curve) {
        require(msg.sender == address(launchAndBuy), "wrapper only");
        return _createToken(creator, name_, symbol_, uri_, creatorTaxBps, holderReserveBps);
    }

    function _createToken(
        address creator,
        string calldata name_,
        string calldata symbol_,
        string calldata uri_,
        uint16 creatorTaxBps,
        uint16 holderReserveBps
    ) private returns (address token, address curve) {
        require(address(deployer) != address(0) && address(venue) != address(0), "factory not initialized");
        require(creator != address(0), "bad creator");
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "missing metadata");
        require(
            bytes(name_).length <= 64 && bytes(symbol_).length <= 12 && bytes(uri_).length <= 2048, "metadata too long"
        );
        require(creatorTaxBps <= creatorTaxCapBps, "creator tax too high");
        require(holderReserveBps <= 500, "reserve too high");
        uint256 reservedTokens = supply * holderReserveBps / 10_000;
        if (launchFee > 0) {
            IERC20(quote).safeTransferFrom(msg.sender, launchFeeTreasury, launchFee);
            emit LaunchFeePaid(creator, launchFeeTreasury, launchFee);
        }
        {
            bytes32 salt = keccak256(abi.encode(creator, creatorNonce[creator]++, block.chainid));
            CurveLaunchDeployer.LaunchParams memory p;
            p.name = name_;
            p.symbol = symbol_;
            p.uri = uri_;
            p.quote = quote;
            p.supply = supply;
            p.curveSupply = curveSupply;
            p.reserveAmount = reservedTokens;
            p.reserve = address(holderReserve);
            p.initialVQ = initialVQ();
            p.escrow = address(escrow);
            p.vault = address(vault);
            p.executor = address(venue);
            p.policy =
                CurveBondingCurve.Policy(creator, treasury, feeBps, creatorShareBps, buybackShareBps, creatorTaxBps);
            (token, curve) = deployer.deployLaunch(salt, p);
        }
        market[token] = Market(curve, creator, feeBps, creatorShareBps, buybackShareBps, creatorTaxBps, treasury);
        venueOf[token] = address(venue);
        reserveBps[token] = holderReserveBps;
        holderReserve.register(token, creator, curve, address(vault), reservedTokens);
        escrow.authorize(curve);
        vault.authorize(curve);
        emit LaunchCreated(token, curve, creator, name_, symbol_, uri_);
        emit ReserveConfigured(token, holderReserveBps, reservedTokens);
    }

    function canBuy(address) external pure returns (bool) {
        return true;
    }

    function graduate(address token) external nonReentrant {
        Market memory m = market[token];
        require(m.curve != address(0), "unknown market");
        CurveBondingCurve curve = CurveBondingCurve(m.curve);
        require(curve.sold() == curveSupply && !curve.graduated(), "not sold out");
        try ICurveV1Venue(venueOf[token])
            .check(token, supply - curveSupply - curve.reserveAmount(), curve.realQuote()) {}
        catch (bytes memory reason) {
            emit GraduationDeferred(token, reason);
            return;
        }
        curve.markReady();
        emit GraduationStarted(token, m.curve);
    }

    function createGraduatedPool(address token) external nonReentrant returns (address pool) {
        Market memory m = market[token];
        require(m.curve != address(0), "unknown market");
        CurveBondingCurve curve = CurveBondingCurve(m.curve);
        require(curve.ready() && !curve.graduated() && curve.sold() == curveSupply, "not prepared");
        ICurveV1Venue adapter = ICurveV1Venue(venueOf[token]);
        adapter.check(token, supply - curveSupply - curve.reserveAmount(), curve.realQuote());
        // Icarus may skim even a zero token balance; unlock inside this atomic call.
        // A venue or locker failure reverts the unlock with every other state change.
        CurveLauncherToken(token).enableTrading();
        uint256 liquidity;
        uint256 quoteLiquidity;
        (pool, liquidity, quoteLiquidity) = adapter.graduate(token, m.curve);
        locker.register(pool, token, m.creator);
        curve.finalizeGraduation(pool);
        holderReserve.recordGraduation(token, pool);
        emit Graduated(token, pool, supply - curveSupply - curve.reserveAmount(), quoteLiquidity, liquidity);
    }

    function rescueTokens(address asset, uint256 amount, address recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "bad recipient");
        IERC20(asset).safeTransfer(recipient, amount);
        emit TokensRescued(asset, amount, recipient);
    }

    function rescueNative(uint256 amount, address payable recipient) external onlyOwner nonReentrant {
        require(recipient != address(0), "bad recipient");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native rescue failed");
        emit NativeRescued(amount, recipient);
    }
}
