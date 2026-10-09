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
import {CurveGraduationGuard} from "./CurveGraduationGuard.sol";
import {CurveGraduationExecutor} from "./CurveGraduationExecutor.sol";
import {CurveLpLocker} from "./LpLocker.sol";
import {CurveLauncherToken} from "./CurveLauncherToken.sol";
import {CurveMemeHook} from "./CurveMemeHook.sol";
import {CurveLaunchAndBuy} from "./CurveLaunchAndBuy.sol";

interface ITokenBuyAdapterBinding {
    function factory() external view returns (address);
    function quote() external view returns (address);
}

/// @notice V2 registry and policy authority. Existing markets retain their launch snapshot.
contract CurveLaunchFactory is Ownable2Step, ReentrancyGuard {
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
        address guard;
        address executor;
        address locker;
        address hook;
        address launchAndBuy;
    }

    address public immutable quote;
    address public immutable icarusFactory;
    uint256 public immutable supply;
    uint256 public immutable curveSupply;
    uint256 public immutable initialVQ;
    CurveLaunchDeployer public deployer;
    CurveFeeEscrow public escrow;
    CurveBuybackVault public vault;
    CurveGraduationGuard public guard;
    CurveGraduationExecutor public executor;
    CurveLpLocker public locker;
    CurveMemeHook public hook;
    CurveLaunchAndBuy public launchAndBuy;
    address public tokenBuyAdapter;
    bool public tokenBuyEnabled;
    uint16 public feeBps = 50;
    uint16 public creatorShareBps = 5_000;
    uint16 public buybackShareBps = 2_500;
    uint16 public creatorTaxCapBps = 50;
    address public treasury;
    mapping(address => uint256) public creatorNonce;
    mapping(address => Market) public market;

    event LaunchCreated(address indexed token, address indexed curve, address indexed creator, string name, string symbol, string uri);
    event FeeDefaultsUpdated(uint16 feeBps, uint16 creatorShareBps, uint16 buybackShareBps, uint16 creatorTaxCapBps, address treasury);
    event GraduationStarted(address indexed token, address indexed curve);
    event Graduated(address indexed token, address indexed pool, uint256 tokenLiquidity, uint256 quoteLiquidity, uint256 liquidity);
    event ServicesInitialized(address indexed deployer, address indexed escrow, address indexed vault);
    event TokensRescued(address indexed asset, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);
    event GraduationDeferred(address indexed token, bytes reason);
    event TokenBuyAdapterSet(address indexed adapter);
    event TokenBuyEnabledSet(bool enabled);

    constructor(address quote_, address icarusFactory_, address treasury_, uint256 supply_, uint256 curveSupply_, uint256 initialVQ_)
        Ownable(msg.sender)
    {
        require(quote_ != address(0) && icarusFactory_ != address(0) && treasury_ != address(0), "bad dependency");
        require(supply_ > curveSupply_ && curveSupply_ > 0 && initialVQ_ > 0, "bad curve");
        require(supply_ <= type(uint128).max && initialVQ_ <= type(uint128).max, "curve too large");
        quote = quote_;
        icarusFactory = icarusFactory_;
        treasury = treasury_;
        supply = supply_;
        curveSupply = curveSupply_;
        initialVQ = initialVQ_;
    }

    function initialize(Services calldata s) external onlyOwner nonReentrant {
        require(address(deployer) == address(0), "already initialized");
        require(
            s.deployer.code.length > 0 && s.escrow.code.length > 0 && s.vault.code.length > 0
                && s.guard.code.length > 0 && s.executor.code.length > 0 && s.locker.code.length > 0
                && s.hook.code.length > 0 && s.launchAndBuy.code.length > 0,
            "missing service"
        );
        require(
            CurveLaunchDeployer(s.deployer).factory() == address(this)
                && CurveFeeEscrow(s.escrow).factory() == address(this)
                && CurveBuybackVault(s.vault).factory() == address(this)
                && CurveBuybackVault(s.vault).quote() == quote
                && address(CurveGraduationGuard(s.guard).icarusFactory()) == icarusFactory
                && CurveGraduationExecutor(s.executor).factory() == address(this)
                && address(CurveGraduationExecutor(s.executor).icarusFactory()) == icarusFactory
                && CurveGraduationExecutor(s.executor).quote() == quote
                && address(CurveGraduationExecutor(s.executor).locker()) == s.locker
                && CurveLpLocker(s.locker).factory() == address(this)
                && CurveMemeHook(s.hook).factory() == address(this)
                && CurveMemeHook(s.hook).locker() == s.locker
                && CurveMemeHook(s.hook).quote() == quote
                && address(CurveMemeHook(s.hook).escrow()) == s.escrow
                && address(CurveMemeHook(s.hook).vault()) == s.vault
                && CurveLaunchAndBuy(s.launchAndBuy).factory() == address(this)
                && CurveLaunchAndBuy(s.launchAndBuy).quote() == quote,
            "service mismatch"
        );
        deployer = CurveLaunchDeployer(s.deployer);
        escrow = CurveFeeEscrow(s.escrow);
        vault = CurveBuybackVault(s.vault);
        guard = CurveGraduationGuard(s.guard);
        executor = CurveGraduationExecutor(s.executor);
        locker = CurveLpLocker(s.locker);
        hook = CurveMemeHook(s.hook);
        launchAndBuy = CurveLaunchAndBuy(s.launchAndBuy);
        locker.setExecutor(s.executor);
        locker.setHook(s.hook);
        escrow.authorize(s.hook);
        vault.authorize(s.hook);
        emit ServicesInitialized(s.deployer, s.escrow, s.vault);
    }

    /// @notice Compatibility reads for clients of the invited-beta factory.
    function publicLaunchOpen() external view returns (bool) { return address(deployer) != address(0); }
    function invited(address) external pure returns (bool) { return false; }

    function setTokenBuyAdapter(address adapter) external onlyOwner {
        require(tokenBuyAdapter == address(0) && adapter.code.length > 0, "adapter already set or missing");
        require(ITokenBuyAdapterBinding(adapter).factory() == address(this)
            && ITokenBuyAdapterBinding(adapter).quote() == quote, "adapter mismatch");
        tokenBuyAdapter = adapter;
        tokenBuyEnabled = true;
        emit TokenBuyAdapterSet(adapter);
        emit TokenBuyEnabledSet(true);
    }

    function setTokenBuyEnabled(bool enabled) external onlyOwner {
        require(tokenBuyAdapter != address(0), "adapter not set");
        tokenBuyEnabled = enabled;
        emit TokenBuyEnabledSet(enabled);
    }

    function setFeeDefaults(uint16 newFee, uint16 newCreatorShare, uint16 newBuybackShare, uint16 newTaxCap, address newTreasury)
        external onlyOwner
    {
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
        external nonReentrant returns (address token, address curve)
    {
        return _createToken(msg.sender, name_, symbol_, uri_, creatorTaxBps);
    }

    function createFor(address creator, string calldata name_, string calldata symbol_, string calldata uri_, uint16 creatorTaxBps)
        external nonReentrant returns (address token, address curve)
    {
        require(msg.sender == address(launchAndBuy), "wrapper only");
        return _createToken(creator, name_, symbol_, uri_, creatorTaxBps);
    }

    function _createToken(address creator, string calldata name_, string calldata symbol_, string calldata uri_, uint16 creatorTaxBps)
        private returns (address token, address curve)
    {
        require(address(deployer) != address(0), "factory not initialized");
        require(creator != address(0), "bad creator");
        require(bytes(name_).length > 0 && bytes(symbol_).length > 0, "missing metadata");
        require(
            bytes(name_).length <= 64 && bytes(symbol_).length <= 12 && bytes(uri_).length <= 2048,
            "metadata too long"
        );
        require(creatorTaxBps <= creatorTaxCapBps, "creator tax too high");
        bytes32 salt = keccak256(abi.encode(creator, creatorNonce[creator]++, block.chainid));
        CurveLaunchDeployer.LaunchParams memory p = CurveLaunchDeployer.LaunchParams({
            name: name_, symbol: symbol_, uri: uri_, quote: quote,
            supply: supply, curveSupply: curveSupply, initialVQ: initialVQ,
            escrow: address(escrow), vault: address(vault), executor: address(executor),
            policy: CurveBondingCurve.Policy({
                creator: creator, treasury: treasury, feeBps: feeBps,
                creatorShareBps: creatorShareBps, buybackShareBps: buybackShareBps,
                creatorTaxBps: creatorTaxBps
            })
        });
        (token, curve) = deployer.deployLaunch(salt, p);
        market[token] = Market(curve, creator, feeBps, creatorShareBps, buybackShareBps, creatorTaxBps, treasury);
        escrow.authorize(curve);
        vault.authorize(curve);
        emit LaunchCreated(token, curve, creator, name_, symbol_, uri_);
    }

    function canBuy(address) external pure returns (bool) {
        return true;
    }

    function graduate(address token) external nonReentrant {
        Market memory m = market[token];
        require(m.curve != address(0), "unknown market");
        CurveBondingCurve curve = CurveBondingCurve(m.curve);
        require(curve.sold() == curveSupply && !curve.graduated(), "not sold out");
        try guard.check(token, quote, supply - curveSupply, curve.realQuote()) returns (address) {
        } catch (bytes memory reason) {
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
        guard.check(token, quote, supply - curveSupply, curve.realQuote());
        // Icarus may skim even a zero token balance; unlock inside this atomic call.
        // Any executor failure reverts the unlock with every other state change.
        CurveLauncherToken(token).enableTrading();
        uint256 liquidity;
        uint256 quoteLiquidity;
        (pool, liquidity, quoteLiquidity) = executor.execute(token, m.curve, m.creator);
        curve.finalizeGraduation(pool);
        emit Graduated(token, pool, supply - curveSupply, quoteLiquidity, liquidity);
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
