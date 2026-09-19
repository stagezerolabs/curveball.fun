// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {MemeToken} from "../contracts/MemeToken.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";

contract CurveballProperties {
    uint256 private constant SUPPLY = 1_000_000 ether;
    uint256 private constant CURVE_SUPPLY = 800_000 ether;
    uint256 private constant INITIAL_VQ = 10 ether;
    uint256 private constant INITIAL_K = SUPPLY * INITIAL_VQ;

    MockWETH public immutable quote;
    LpLocker public immutable locker;
    CurveballLaunchpad public immutable launchpad;
    MemeToken public immutable token;

    constructor() {
        quote = new MockWETH();
        MockIcarusFactory factory = new MockIcarusFactory();
        locker = new LpLocker(address(this), 5_000);
        launchpad = new CurveballLaunchpad(
            address(quote), address(factory), address(locker), SUPPLY, CURVE_SUPPLY, INITIAL_VQ
        );
        locker.setLaunchpad(address(launchpad));
        token = MemeToken(launchpad.createToken("Invariant", "INV", ""));
        quote.approve(address(launchpad), type(uint256).max);
        token.approve(address(launchpad), type(uint256).max);
    }

    function buy(uint96 rawAmount) external {
        uint256 amount = uint256(rawAmount) % (100 ether) + 1;
        quote.mint(address(this), amount);
        try launchpad.buyTokens(address(token), amount, 1, type(uint256).max) {} catch {}
    }

    function sell(uint96 rawAmount) external {
        uint256 balance = token.balanceOf(address(this));
        if (balance == 0) return;
        uint256 amount = uint256(rawAmount) % balance + 1;
        try launchpad.sellTokens(address(token), amount, 1, type(uint256).max) {} catch {}
    }

    function echidna_sold_never_exceeds_curve_supply() external view returns (bool) {
        (,,,, uint128 sold,,,) = launchpad.markets(address(token));
        return sold <= CURVE_SUPPLY;
    }

    function echidna_each_active_market_is_quote_backed() external view returns (bool) {
        (,,, uint128 realQ,, bool graduated,,) = launchpad.markets(address(token));
        return graduated || quote.balanceOf(address(launchpad)) == realQ;
    }

    function echidna_virtual_and_real_quote_accounting_match() external view returns (bool) {
        (,, uint128 vq, uint128 realQ,, bool graduated,,) = launchpad.markets(address(token));
        return graduated || uint256(vq) == INITIAL_VQ + uint256(realQ);
    }

    function echidna_curve_product_never_decreases() external view returns (bool) {
        (, uint128 vt, uint128 vq,,, bool graduated,,) = launchpad.markets(address(token));
        return graduated || uint256(vt) * uint256(vq) >= INITIAL_K;
    }

    function echidna_graduation_is_fully_wired() external view returns (bool) {
        (,,,,, bool graduated,, address pool) = launchpad.markets(address(token));
        if (!graduated) return true;
        return pool != address(0) && token.tradingEnabled() && IERC20(pool).balanceOf(address(locker)) > 0;
    }
}
