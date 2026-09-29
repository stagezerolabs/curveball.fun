// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MemeToken} from "../contracts/MemeToken.sol";
import {TestBase} from "./TestBase.sol";

contract LaunchpadTest is TestBase {
    address private constant TRADER = address(0xA11CE);

    function testMemeTokenRejectsZeroLaunchpad() external {
        vm.expectRevert();
        new MemeToken("Invalid", "BAD", "", 1, address(0));
    }

    function testTradesThenGraduatesByDirectPoolMint() external {
        MockWETH quote = new MockWETH();
        MockIcarusFactory factory = new MockIcarusFactory();
        LpLocker locker = new LpLocker(address(this), 5_000);
        CurveballLaunchpad launchpad =
            new CurveballLaunchpad(address(quote), address(factory), address(locker), 1_000_000, 800_000, 10);
        locker.setLaunchpad(address(launchpad));
        launchpad.setInvited(address(this), true);
        launchpad.setInvited(TRADER, true);
        quote.mint(TRADER, 100);

        address token = launchpad.createToken("Test", "T", "ipfs://t");
        vm.prank(TRADER);
        quote.approve(address(launchpad), 100);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 100, 1, DEADLINE);

        (,,,,, bool graduated,, address pool) = launchpad.markets(token);
        assertTrue(graduated, "market did not graduate");
        assertTrue(pool != address(0), "pool missing");
        assertTrue(MemeToken(token).tradingEnabled(), "token stayed locked");
    }

    function testOnlyOwnerCanBindLockerOnce() external {
        LpLocker locker = new LpLocker(address(this), 5_000);
        vm.prank(TRADER);
        vm.expectRevert();
        locker.setLaunchpad(TRADER);
        locker.setLaunchpad(address(this));
        vm.expectRevert();
        locker.setLaunchpad(TRADER);
    }

    function testRejectsValuesThatDoNotFitMarketState() external {
        MockWETH quote = new MockWETH();
        MockIcarusFactory factory = new MockIcarusFactory();
        LpLocker locker = new LpLocker(address(this), 5_000);
        vm.expectRevert();
        new CurveballLaunchpad(address(quote), address(factory), address(locker), uint256(type(uint128).max) + 1, 1, 1);
        vm.expectRevert();
        new CurveballLaunchpad(address(quote), address(factory), address(locker), 2, 1, uint256(type(uint128).max) + 1);
    }

    function testBuyRejectsExpiredDeadline() external {
        (MockWETH quote, CurveballLaunchpad launchpad) = _deploy(1_000_000, 800_000, 10);
        address token = launchpad.createToken("Expired", "EXP", "");
        quote.mint(TRADER, 1);
        vm.prank(TRADER);
        quote.approve(address(launchpad), 1);
        vm.expectRevert();
        vm.prank(TRADER);
        launchpad.buyTokens(token, 1, 1, 0);
    }

    function testSellRejectsExpiredDeadline() external {
        (MockWETH quote, CurveballLaunchpad launchpad) = _deploy(1_000_000, 800_000, 10);
        quote.mint(TRADER, 10);
        address token = launchpad.createToken("Expired", "EXP", "");
        vm.prank(TRADER);
        quote.approve(address(launchpad), 10);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 10, 1, DEADLINE);
        uint256 balance = MemeToken(token).balanceOf(TRADER);
        vm.prank(TRADER);
        MemeToken(token).approve(address(launchpad), balance);
        vm.expectRevert();
        vm.prank(TRADER);
        launchpad.sellTokens(token, balance, 1, 0);
    }

    function testHolderCanSellBackBeforeGraduation() external {
        (MockWETH quote, CurveballLaunchpad launchpad) = _deploy(1_000_000, 800_000, 10);
        quote.mint(TRADER, 20);
        address token = launchpad.createToken("Round", "R", "u");
        vm.prank(TRADER);
        quote.approve(address(launchpad), 20);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 10, 1, DEADLINE);
        uint256 balance = MemeToken(token).balanceOf(TRADER);
        vm.prank(TRADER);
        MemeToken(token).approve(address(launchpad), balance);
        vm.prank(TRADER);
        launchpad.sellTokens(token, balance, 1, DEADLINE);
        (,,,, uint128 sold,,,) = launchpad.markets(token);
        assertEq(sold, 0, "curve was not reset");
    }

    function testDefersWhenGraduationLiquidityIsTooSmall() external {
        (MockWETH quote, CurveballLaunchpad launchpad) = _deploy(1_001, 800, 1);
        quote.mint(TRADER, 100);
        address token = launchpad.createToken("Small", "S", "u");
        vm.prank(TRADER);
        quote.approve(address(launchpad), 100);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 100, 1, DEADLINE);
        (,,,,,, bool pending,) = launchpad.markets(token);
        assertTrue(pending, "graduation was not deferred");
    }

    function testReusesEmptyVolatilePool() external {
        (MockWETH quote, CurveballLaunchpad launchpad) = _deploy(1_000_000, 800_000, 10);
        MockIcarusFactory factory = MockIcarusFactory(address(launchpad.factory()));
        address token = launchpad.createToken("Pool", "P", "u");
        factory.createPool(token, address(quote), false);
        address pool = factory.getPool(token, address(quote), false);
        quote.mint(TRADER, 100);
        vm.prank(TRADER);
        quote.approve(address(launchpad), 100);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 100, 1, DEADLINE);
        (,,,,,,, address marketPool) = launchpad.markets(token);
        assertEq(marketPool, pool, "pre-created pool was not reused");
    }

    function _deploy(uint256 supply, uint256 curveSupply, uint256 initialVQ)
        private
        returns (MockWETH quote, CurveballLaunchpad launchpad)
    {
        quote = new MockWETH();
        MockIcarusFactory factory = new MockIcarusFactory();
        LpLocker locker = new LpLocker(address(this), 5_000);
        launchpad =
            new CurveballLaunchpad(address(quote), address(factory), address(locker), supply, curveSupply, initialVQ);
        locker.setLaunchpad(address(launchpad));
        launchpad.setInvited(address(this), true);
        launchpad.setInvited(TRADER, true);
    }
}
