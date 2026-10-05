// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {CurveFeeEscrow} from "./CurveFeeEscrow.sol";
import {CurveBuybackVault} from "./CurveBuybackVault.sol";

interface ICurveFactoryAccess {
    function canBuy(address account) external view returns (bool);
    function launchAndBuy() external view returns (address);
    function owner() external view returns (address);
}

/// @notice Per-launch, quote-backed phantom-reserve AMM.
contract CurveBondingCurve is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    struct Policy {
        address creator;
        address treasury;
        uint16 feeBps;
        uint16 creatorShareBps;
        uint16 buybackShareBps;
        uint16 creatorTaxBps;
    }

    address public immutable deployer;
    address public immutable factory;
    address public immutable quote;
    address public immutable executor;
    CurveFeeEscrow public immutable escrow;
    CurveBuybackVault public immutable vault;
    uint256 public immutable supply;
    uint256 public immutable curveSupply;
    uint256 public immutable initialVQ;
    address public immutable creator;
    address public immutable treasury;
    uint16 public immutable feeBps;
    uint16 public immutable creatorShareBps;
    uint16 public immutable buybackShareBps;
    uint16 public immutable creatorTaxBps;
    address public token;
    uint128 public virtualToken;
    uint128 public virtualQuote;
    uint128 public realQuote;
    uint128 public sold;
    bool public ready;
    bool public graduated;
    address public pool;
    struct Observation { uint64 timestamp; uint256 cumulativePrice; }
    Observation[64] public observations;
    uint8 public observationCount;
    uint8 public nextObservation;
    uint64 public lastPriceTimestamp;
    uint256 public priceCumulative;

    event Trade(
        address indexed token, address indexed trader, bool isBuy,
        uint256 grossCurveQuote, uint256 netTraderQuote, uint256 feeQuote,
        uint256 creatorTaxQuote, uint256 tokenAmount,
        uint256 vQAfter, uint256 vTAfter, uint256 soldAfter
    );
    event TokensRescued(address indexed asset, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);

    constructor(
        address factory_, address quote_, address escrow_, address vault_, address executor_,
        uint256 supply_, uint256 curveSupply_, uint256 initialVQ_, Policy memory policy
    ) {
        require(factory_ != address(0) && quote_ != address(0) && escrow_ != address(0) && vault_ != address(0) && executor_ != address(0), "bad dependency");
        require(supply_ > curveSupply_ && curveSupply_ > 0 && initialVQ_ > 0, "bad curve");
        require(supply_ <= type(uint128).max && initialVQ_ <= type(uint128).max, "curve too large");
        require(policy.creator != address(0) && policy.treasury != address(0), "bad recipient");
        require(uint256(policy.creatorShareBps) + policy.buybackShareBps <= 10_000, "bad split");
        deployer = msg.sender;
        factory = factory_;
        quote = quote_;
        executor = executor_;
        escrow = CurveFeeEscrow(escrow_);
        vault = CurveBuybackVault(vault_);
        supply = supply_;
        curveSupply = curveSupply_;
        initialVQ = initialVQ_;
        creator = policy.creator;
        treasury = policy.treasury;
        feeBps = policy.feeBps;
        creatorShareBps = policy.creatorShareBps;
        buybackShareBps = policy.buybackShareBps;
        creatorTaxBps = policy.creatorTaxBps;
        virtualToken = supply_.toUint128();
        virtualQuote = initialVQ_.toUint128();
        lastPriceTimestamp = uint64(block.timestamp);
        observations[0] = Observation(uint64(block.timestamp), 0);
        observationCount = 1;
        nextObservation = 1;
    }

    function bindToken(address token_) external {
        require(msg.sender == deployer && token == address(0) && token_ != address(0), "cannot bind");
        token = token_;
    }

    /// @notice A gross WETH budget includes every fee and creator tax.
    function quoteBuy(uint256 maxSpend)
        public view returns (uint256 tokensOut, uint256 spent, uint256 curveQuote, uint256 fee, uint256 creatorTax)
    {
        require(token != address(0) && !graduated && maxSpend > 0 && maxSpend <= type(uint128).max, "bad spend");
        require(sold < curveSupply, "sold out");
        uint256 budget = maxSpend * 10_000 / (10_000 + feeBps + creatorTaxBps);
        uint256 k = uint256(virtualToken) * virtualQuote;
        uint256 newVt = _ceilDiv(k, uint256(virtualQuote) + budget);
        tokensOut = uint256(virtualToken) - newVt;
        uint256 remaining = curveSupply - sold;
        if (tokensOut > remaining) {
            tokensOut = remaining;
            newVt = uint256(virtualToken) - tokensOut;
            curveQuote = _ceilDiv(k, newVt) - virtualQuote;
        } else {
            curveQuote = budget;
        }
        fee = curveQuote * feeBps / 10_000;
        creatorTax = curveQuote * creatorTaxBps / 10_000;
        spent = curveQuote + fee + creatorTax;
        require(tokensOut > 0 && spent <= maxSpend, "insufficient spend");
    }

    function spotPrice() public view returns (uint256) {
        return uint256(virtualQuote) * 1e18 / virtualToken;
    }

    /// @notice Time-weighted WETH per token; requires at least 30 minutes of observations.
    function twapPrice() external view returns (uint256 average) {
        require(block.timestamp >= 30 minutes, "price history too short");
        uint256 target = block.timestamp - 30 minutes;
        bool found;
        Observation memory selected;
        for (uint256 i = 0; i < observationCount; i++) {
            Observation memory candidate = observations[i];
            if (candidate.timestamp <= target && (!found || candidate.timestamp > selected.timestamp)) {
                selected = candidate;
                found = true;
            }
        }
        require(found, "no aged observation");
        uint256 current = priceCumulative + spotPrice() * (block.timestamp - lastPriceTimestamp);
        average = (current - selected.cumulativePrice) / (block.timestamp - selected.timestamp);
        require(average > 0, "zero reference price");
    }

    function quoteSell(uint256 amount)
        public view returns (uint256 net, uint256 gross, uint256 fee, uint256 creatorTax)
    {
        require(token != address(0) && !graduated && amount > 0 && amount <= sold, "bad amount");
        uint256 k = uint256(virtualToken) * virtualQuote;
        uint256 newVq = _ceilDiv(k, uint256(virtualToken) + amount);
        gross = uint256(virtualQuote) - newVq;
        require(gross > 0 && gross <= realQuote, "insufficient reserve");
        fee = gross * feeBps / 10_000;
        creatorTax = gross * creatorTaxBps / 10_000;
        net = gross - fee - creatorTax;
    }

    function buyTokens(uint256 maxSpend, uint256 minOut, uint256 deadline)
        external nonReentrant returns (uint256 out)
    {
        out = _buy(msg.sender, msg.sender, maxSpend, minOut, deadline);
    }

    function buyTokensFor(address recipient, uint256 maxSpend, uint256 minOut, uint256 deadline)
        external nonReentrant returns (uint256 out)
    {
        require(msg.sender == ICurveFactoryAccess(factory).launchAndBuy() && recipient != address(0), "wrapper only");
        out = _buy(msg.sender, recipient, maxSpend, minOut, deadline);
    }

    function _buy(address payer, address recipient, uint256 maxSpend, uint256 minOut, uint256 deadline)
        private returns (uint256 out)
    {
        require(block.timestamp <= deadline && ICurveFactoryAccess(factory).canBuy(recipient), "buy unavailable");
        uint256 spent;
        uint256 curveQuote;
        uint256 fee;
        uint256 tax;
        (out, spent, curveQuote, fee, tax) = quoteBuy(maxSpend);
        require(out >= minOut, "slippage");
        _recordPrice();
        virtualToken = (uint256(virtualToken) - out).toUint128();
        virtualQuote = (uint256(virtualQuote) + curveQuote).toUint128();
        realQuote = (uint256(realQuote) + curveQuote).toUint128();
        sold = (uint256(sold) + out).toUint128();
        IERC20(quote).safeTransferFrom(payer, address(this), spent);
        _routeFees(fee, tax);
        IERC20(token).safeTransfer(recipient, out);
        emit Trade(token, recipient, true, curveQuote, spent, fee, tax, out, virtualQuote, virtualToken, sold);
    }

    function sellTokens(uint256 amount, uint256 minOut, uint256 deadline)
        external nonReentrant returns (uint256 net)
    {
        require(block.timestamp <= deadline, "expired");
        uint256 gross;
        uint256 fee;
        uint256 tax;
        (net, gross, fee, tax) = quoteSell(amount);
        require(net >= minOut, "slippage");
        _recordPrice();
        virtualToken = (uint256(virtualToken) + amount).toUint128();
        virtualQuote = (uint256(virtualQuote) - gross).toUint128();
        realQuote = (uint256(realQuote) - gross).toUint128();
        sold = (uint256(sold) - amount).toUint128();
        if (ready) ready = false;
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        _routeFees(fee, tax);
        IERC20(quote).safeTransfer(msg.sender, net);
        emit Trade(token, msg.sender, false, gross, net, fee, tax, amount, virtualQuote, virtualToken, sold);
    }

    function _routeFees(uint256 fee, uint256 tax) private {
        uint256 creatorFee = fee * creatorShareBps / 10_000 + tax;
        uint256 buybackFee = fee * buybackShareBps / 10_000;
        uint256 protocolFee = fee + tax - creatorFee - buybackFee;
        uint256 escrowAmount = creatorFee + protocolFee;
        if (escrowAmount > 0) IERC20(quote).safeTransfer(address(escrow), escrowAmount);
        if (creatorFee > 0) escrow.credit(token, quote, creator, creatorFee);
        if (protocolFee > 0) escrow.credit(token, quote, treasury, protocolFee);
        if (buybackFee > 0) {
            IERC20(quote).safeTransfer(address(vault), buybackFee);
            vault.creditQuote(token, buybackFee);
        }
    }

    function markReady() external {
        require(msg.sender == factory && !graduated && sold == curveSupply, "not ready");
        ready = true;
    }

    function releaseForGraduation(address pool_) external nonReentrant returns (uint256 tokenLiquidity, uint256 quoteLiquidity) {
        require(msg.sender == executor && ready && !graduated && sold == curveSupply && pool_ != address(0), "not prepared");
        tokenLiquidity = supply - sold;
        quoteLiquidity = realQuote;
        realQuote = 0;
        IERC20(token).safeTransfer(pool_, tokenLiquidity);
        IERC20(quote).safeTransfer(pool_, quoteLiquidity);
    }

    function finalizeGraduation(address pool_) external {
        require(msg.sender == factory && ready && !graduated && realQuote == 0 && pool_ != address(0), "not executed");
        ready = false;
        graduated = true;
        pool = pool_;
    }

    /// @notice Recovers unsolicited balances without touching trading reserves.
    function rescueTokens(address asset, uint256 amount, address recipient) external nonReentrant {
        require(msg.sender == ICurveFactoryAccess(factory).owner() && recipient != address(0), "owner only");
        uint256 reserved;
        if (asset == quote) reserved = realQuote;
        if (asset == token && !graduated) reserved = supply - sold;
        uint256 balance = IERC20(asset).balanceOf(address(this));
        require(balance >= reserved && amount <= balance - reserved, "reserved asset");
        IERC20(asset).safeTransfer(recipient, amount);
        emit TokensRescued(asset, amount, recipient);
    }

    function rescueNative(uint256 amount, address payable recipient) external nonReentrant {
        require(msg.sender == ICurveFactoryAccess(factory).owner() && recipient != address(0), "owner only");
        (bool sent,) = recipient.call{value: amount}("");
        require(sent, "native rescue failed");
        emit NativeRescued(amount, recipient);
    }

    function _ceilDiv(uint256 a, uint256 b) private pure returns (uint256) {
        return a / b + (a % b == 0 ? 0 : 1);
    }

    function _recordPrice() private {
        uint64 nowTime = uint64(block.timestamp);
        priceCumulative += spotPrice() * (nowTime - lastPriceTimestamp);
        lastPriceTimestamp = nowTime;
        uint8 last = nextObservation == 0 ? 63 : nextObservation - 1;
        if (nowTime - observations[last].timestamp >= 1 minutes) {
            observations[nextObservation] = Observation(nowTime, priceCumulative);
            nextObservation = uint8((uint256(nextObservation) + 1) % 64);
            if (observationCount < 64) observationCount++;
        }
    }
}
