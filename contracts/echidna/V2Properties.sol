// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";

contract V2CreatorActor {
    function create(CurveLaunchFactory factory) external returns (address token, address curve) {
        return factory.createToken("Property", "PROP", "", 25);
    }

    function attemptAdmin(CurveLaunchFactory factory, CurveBondingCurve curve, MockWETH quote) external returns (bool) {
        (bool feeChanged,) = address(factory).call(abi.encodeCall(factory.setFeeDefaults, (1, 1, 1, 1, address(this))));
        (bool reserveTaken,) = address(curve).call(abi.encodeCall(curve.rescueTokens, (address(quote), 1, address(this))));
        return feeChanged || reserveTaken;
    }
}

/// @notice Stateful S1-S8 harness with a separate creator and protocol owner.
contract V2Properties {
    uint256 private constant SUPPLY = 1_000_000 ether;
    uint256 private constant CURVE_SUPPLY = 800_000 ether;
    uint256 private constant INITIAL_VQ = 10 ether;
    MockWETH public immutable quote;
    CurveLaunchFactory public immutable factory;
    CurveBondingCurve public immutable curve;
    CurveLauncherToken public immutable token;
    V2CreatorActor public immutable creator;
    bool public postGraduationTradeSucceeded;
    bool public creatorAdminSucceeded;

    constructor() {
        quote = new MockWETH();
        factory = CurveV2Deployment.deploy(address(quote), address(new MockIcarusFactory()), address(this), SUPPLY, CURVE_SUPPLY, INITIAL_VQ);
        creator = new V2CreatorActor();
        factory.setInvited(address(this), true);
        factory.setInvited(address(creator), true);
        (address token_, address curve_) = creator.create(factory);
        token = CurveLauncherToken(token_);
        curve = CurveBondingCurve(curve_);
        quote.approve(curve_, type(uint256).max);
        token.approve(curve_, type(uint256).max);
    }

    function buy(uint96 raw) external {
        uint256 amount = uint256(raw) % (50 ether) + 1e12;
        quote.mint(address(this), amount);
        try curve.buyTokens(amount, 0, type(uint256).max) {
            if (curve.graduated()) postGraduationTradeSucceeded = true;
        } catch {}
    }

    function sell(uint96 raw) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = uint256(raw) % balance + 1;
        try curve.sellTokens(amount, 0, type(uint256).max) {
            if (curve.graduated()) postGraduationTradeSucceeded = true;
        } catch {}
    }

    function prepare() external { try factory.graduate(address(token)) {} catch {} }
    function finish() external { try factory.createGraduatedPool(address(token)) {} catch {} }

    function donateAndRescue(uint96 raw) external {
        uint256 amount = uint256(raw) % 1 ether + 1;
        quote.mint(address(curve), amount);
        try curve.rescueTokens(address(quote), amount, address(this)) {} catch {}
        if (!curve.graduated()) {
            uint256 held = token.balanceOf(address(this));
            if (held >= amount) {
                token.transfer(address(curve), amount);
                try curve.rescueTokens(address(token), amount, address(this)) {} catch {}
            }
        }
    }

    function attemptCreatorAuthority() external {
        if (creator.attemptAdmin(factory, curve, quote)) creatorAdminSucceeded = true;
    }

    function echidna_s1_fixed_supply() external view returns (bool) {
        return token.totalSupply() == SUPPLY;
    }

    function echidna_s2_phantom_reserves_and_product() external view returns (bool) {
        if (curve.graduated()) return true;
        return uint256(curve.virtualQuote()) == INITIAL_VQ + curve.realQuote()
            && uint256(curve.virtualToken()) * curve.virtualQuote() >= SUPPLY * INITIAL_VQ
            && curve.sold() <= CURVE_SUPPLY;
    }

    function echidna_s3_quote_identity() external view returns (bool) {
        return curve.quote() == factory.quote() && factory.executor().quote() == address(quote);
    }

    function echidna_s4_one_way_graduation() external view returns (bool) {
        return !postGraduationTradeSucceeded && (!curve.graduated() || curve.pool() != address(0));
    }

    function echidna_s5_lp_locked() external view returns (bool) {
        if (!curve.graduated()) return true;
        address pool = curve.pool();
        return IERC20(pool).balanceOf(address(factory.locker())) > 0 && factory.locker().tokenOfPool(pool) == address(token);
    }

    function echidna_s6_fees_backed() external view returns (bool) {
        return quote.balanceOf(address(factory.escrow())) >= factory.escrow().totalLiability(address(quote))
            && quote.balanceOf(address(factory.vault())) >= factory.vault().totalQuoteLiability();
    }

    function echidna_s7_reserves_survive_preparation() external view returns (bool) {
        return curve.graduated() || (quote.balanceOf(address(curve)) >= curve.realQuote()
            && token.balanceOf(address(curve)) >= SUPPLY - curve.sold());
    }

    function echidna_s8_creator_has_no_mint_or_reserve_authority() external view returns (bool) {
        (, address marketCreator,,,,,) = factory.market(address(token));
        return !creatorAdminSucceeded && factory.owner() != address(creator)
            && marketCreator == address(creator);
    }
}
