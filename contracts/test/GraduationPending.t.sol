// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {MemeToken} from "../contracts/MemeToken.sol";
import {PoCBrokenFactory} from "../contracts/test/PoCIcarus.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {TestBase} from "./TestBase.sol";

contract GraduationPendingTest is TestBase {
    address private constant HOLDER = address(0xA11CE);

    struct PendingMarket {
        MockWETH quote;
        PoCBrokenFactory factory;
        CurveballLaunchpad launchpad;
        address token;
        uint128 sold;
        uint128 realQ;
    }

    function testHolderCanExitWhenGraduationDefers() external {
        PendingMarket memory market = _pendingMarket();
        MemeToken token = MemeToken(market.token);
        vm.prank(HOLDER);
        token.approve(address(market.launchpad), market.sold);
        uint256 before = market.quote.balanceOf(HOLDER);
        vm.prank(HOLDER);
        market.launchpad.sellTokens(market.token, market.sold, 0, DEADLINE);

        assertEq(market.quote.balanceOf(HOLDER) - before, market.realQ, "quote not recovered");
        assertEq(token.balanceOf(HOLDER), 0, "token not returned");
        (,,, uint128 realQ, uint128 sold,,,) = market.launchpad.markets(market.token);
        assertEq(realQ, 0, "market quote remains");
        assertEq(sold, 0, "market tokens remain sold");
    }

    function testSellBelowCapReopensPendingMarket() external {
        PendingMarket memory market = _pendingMarket();
        vm.prank(HOLDER);
        MemeToken(market.token).approve(address(market.launchpad), market.sold);
        vm.prank(HOLDER);
        market.launchpad.sellTokens(market.token, 1 ether, 0, DEADLINE);
        (,,,, uint128 sold,, bool pending,) = market.launchpad.markets(market.token);
        assertTrue(!pending, "pending flag stayed set");
        assertTrue(sold < 800_000 ether, "curve is still full");
    }

    function testMarketRetriesGraduationAfterUpstreamRecovers() external {
        PendingMarket memory market = _pendingMarket();
        vm.prank(HOLDER);
        MemeToken(market.token).approve(address(market.launchpad), market.sold);
        vm.prank(HOLDER);
        market.launchpad.sellTokens(market.token, 1 ether, 0, DEADLINE);
        market.factory.setBroken(false);
        market.quote.mint(HOLDER, 1_000 ether);
        vm.prank(HOLDER);
        market.quote.approve(address(market.launchpad), 1_000 ether);
        vm.prank(HOLDER);
        market.launchpad.buyTokens(market.token, 1_000 ether, 1, DEADLINE);

        (,,, uint128 realQ,, bool graduated, bool pending,) = market.launchpad.markets(market.token);
        assertTrue(graduated, "market did not graduate");
        assertTrue(!pending, "market stayed pending");
        assertEq(realQ, 0, "quote was not moved to pool");
        assertTrue(MemeToken(market.token).tradingEnabled(), "token stayed locked");
    }

    function testPendingMarketCannotBuyOrGraduate() external {
        PendingMarket memory market = _pendingMarket();
        vm.prank(HOLDER);
        vm.expectRevert();
        market.launchpad.buyTokens(market.token, 1, 0, DEADLINE);
        vm.expectRevert();
        market.launchpad.graduate(market.token);
    }

    function testExitingPendingMarketKeepsOtherMarketsSolvent() external {
        MockWETH quote = new MockWETH();
        PoCBrokenFactory factory = new PoCBrokenFactory();
        LpLocker locker = new LpLocker(address(this), 5_000);
        CurveballLaunchpad launchpad = new CurveballLaunchpad(
            address(quote), address(factory), address(locker), 1_000_000 ether, 800_000 ether, 10 ether
        );
        locker.setLaunchpad(address(launchpad));
        address firstHolder = address(0xA);
        address secondHolder = address(0xB);
        launchpad.setInvited(firstHolder, true);
        launchpad.setInvited(secondHolder, true);
        address first = _open(quote, launchpad, firstHolder, "AAA", 1_000 ether);
        address second = _open(quote, launchpad, secondHolder, "BBB", 5 ether);
        (,,, uint128 firstQuote, uint128 firstSold,, bool firstPending,) = launchpad.markets(first);
        assertTrue(firstPending, "first market is not pending");
        assertTrue(firstQuote > 0, "first market holds no quote");

        vm.prank(firstHolder);
        MemeToken(first).approve(address(launchpad), firstSold);
        vm.prank(firstHolder);
        launchpad.sellTokens(first, firstSold, 0, DEADLINE);
        _assertSolvent(quote, launchpad, first, second);

        (,,, uint128 secondQuote, uint128 secondSold,,,) = launchpad.markets(second);
        vm.prank(secondHolder);
        MemeToken(second).approve(address(launchpad), secondSold);
        uint256 before = quote.balanceOf(secondHolder);
        vm.prank(secondHolder);
        launchpad.sellTokens(second, secondSold, 0, DEADLINE);
        uint256 repaid = quote.balanceOf(secondHolder) - before;
        assertTrue(repaid <= secondQuote, "second market was overpaid");
        assertTrue(secondQuote - repaid <= 2, "rounding dust too large");
        _assertSolvent(quote, launchpad, first, second);
    }

    function _pendingMarket() private returns (PendingMarket memory market) {
        market.quote = new MockWETH();
        market.factory = new PoCBrokenFactory();
        LpLocker locker = new LpLocker(address(this), 5_000);
        market.launchpad = new CurveballLaunchpad(
            address(market.quote), address(market.factory), address(locker), 1_000_000 ether, 800_000 ether, 10 ether
        );
        locker.setLaunchpad(address(market.launchpad));
        market.launchpad.setInvited(HOLDER, true);
        vm.prank(HOLDER);
        market.token = market.launchpad.createToken("T", "T", "u");
        market.quote.mint(HOLDER, 1_000 ether);
        vm.prank(HOLDER);
        market.quote.approve(address(market.launchpad), 1_000 ether);
        vm.prank(HOLDER);
        market.launchpad.buyTokens(market.token, 1_000 ether, 1, DEADLINE);
        (
            address creator,
            uint128 vt,
            uint128 vq,
            uint128 realQ,
            uint128 sold,
            bool graduated,
            bool pending,
            address pool
        ) = market.launchpad.markets(market.token);
        creator;
        vt;
        vq;
        pool;
        market.realQ = realQ;
        market.sold = sold;
        assertTrue(pending, "graduation did not defer");
        assertTrue(!graduated, "market unexpectedly graduated");
        assertTrue(market.realQ > 0, "launchpad holds no quote");
    }

    function _open(MockWETH quote, CurveballLaunchpad launchpad, address holder, string memory name, uint256 amount)
        private
        returns (address token)
    {
        vm.prank(holder);
        token = launchpad.createToken(name, name, "u");
        quote.mint(holder, amount);
        vm.prank(holder);
        quote.approve(address(launchpad), amount);
        vm.prank(holder);
        launchpad.buyTokens(token, amount, 1, DEADLINE);
    }

    function _assertSolvent(MockWETH quote, CurveballLaunchpad launchpad, address first, address second) private view {
        (,,, uint128 firstQuote,,,,) = launchpad.markets(first);
        (,,, uint128 secondQuote,,,,) = launchpad.markets(second);
        assertEq(
            quote.balanceOf(address(launchpad)),
            uint256(firstQuote) + uint256(secondQuote),
            "market funds are insolvent"
        );
    }
}
