// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {MemeToken} from "../contracts/MemeToken.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {TestBase} from "./TestBase.sol";

contract BetaSafetyTest is TestBase {
    address private constant BUYER = address(0xBEEF);
    address private constant NEW_OWNER = address(0xCAFE);

    function testInvitationControlsCreationAndBuyingButNotSelling() external {
        (MockWETH quote, LpLocker locker, CurveballLaunchpad launchpad) = _deploy();
        locker;
        vm.prank(BUYER);
        vm.expectRevert();
        launchpad.createToken("Blocked", "NO", "");
        launchpad.setInvited(BUYER, true);
        vm.prank(BUYER);
        address token = launchpad.createToken("Curveball", "CURVE", "");
        quote.mint(BUYER, 10 ether);
        vm.prank(BUYER);
        quote.approve(address(launchpad), 10 ether);
        vm.prank(BUYER);
        launchpad.buyTokens(token, 10 ether, 1, DEADLINE);
        launchpad.setInvited(BUYER, false);
        vm.prank(BUYER);
        vm.expectRevert();
        launchpad.buyTokens(token, 1 ether, 1, DEADLINE);
        uint256 owned = MemeToken(token).balanceOf(BUYER);
        vm.prank(BUYER);
        MemeToken(token).approve(address(launchpad), owned);
        vm.prank(BUYER);
        launchpad.sellTokens(token, owned, 0, DEADLINE);
        assertEq(MemeToken(token).balanceOf(BUYER), 0, "exit blocked");
    }

    function testPublicOpeningIsIrreversibleAndOwnershipIsTwoStep() external {
        (, LpLocker locker, CurveballLaunchpad launchpad) = _deploy();
        launchpad.transferOwnership(NEW_OWNER);
        locker.transferOwnership(NEW_OWNER);
        assertEq(launchpad.owner(), address(this), "launchpad transferred early");
        assertEq(locker.owner(), address(this), "locker transferred early");
        vm.prank(NEW_OWNER);
        launchpad.acceptOwnership();
        vm.prank(NEW_OWNER);
        locker.acceptOwnership();
        vm.expectRevert();
        launchpad.openPublicLaunch();
        vm.prank(NEW_OWNER);
        launchpad.openPublicLaunch();
        vm.prank(BUYER);
        launchpad.createToken("Open", "OPEN", "");
        vm.prank(NEW_OWNER);
        vm.expectRevert();
        launchpad.openPublicLaunch();
    }

    function testRescueCannotWithdrawBuyerQuoteOrUnsoldTokens() external {
        (MockWETH quote,, CurveballLaunchpad launchpad) = _deploy();
        launchpad.setInvited(BUYER, true);
        launchpad.setInvited(address(this), true);
        address token = launchpad.createToken("Safe", "SAFE", "");
        quote.mint(BUYER, 10 ether);
        vm.prank(BUYER);
        quote.approve(address(launchpad), 10 ether);
        vm.prank(BUYER);
        launchpad.buyTokens(token, 10 ether, 1, DEADLINE);
        uint256 reserve = launchpad.totalReservedQuote();
        assertEq(reserve, 10 ether, "quote not reserved");
        vm.expectRevert();
        launchpad.rescueTokens(address(quote), reserve);
        vm.expectRevert();
        launchpad.rescueTokens(token, 1);
        quote.mint(address(launchpad), 2 ether);
        uint256 before = quote.balanceOf(address(this));
        launchpad.rescueTokens(address(quote), 2 ether);
        assertEq(quote.balanceOf(address(this)) - before, 2 ether, "excess not recovered");
        assertEq(quote.balanceOf(address(launchpad)), reserve, "seller reserve reduced");
        uint256 owned = MemeToken(token).balanceOf(BUYER);
        vm.prank(BUYER);
        MemeToken(token).approve(address(launchpad), owned);
        vm.prank(BUYER);
        launchpad.sellTokens(token, owned, 0, DEADLINE);
        assertEq(launchpad.totalReservedQuote(), 0, "reserve not released");
    }

    function testTokenRescueFollowsCurrentLaunchpadOwner() external {
        (MockWETH quote,, CurveballLaunchpad launchpad) = _deploy();
        launchpad.setInvited(address(this), true);
        address token = launchpad.createToken("Safe", "SAFE", "");
        quote.mint(token, 3 ether);
        launchpad.transferOwnership(NEW_OWNER);
        vm.prank(NEW_OWNER);
        launchpad.acceptOwnership();
        vm.expectRevert();
        MemeToken(token).rescueTokens(address(quote), 1 ether);
        vm.prank(NEW_OWNER);
        MemeToken(token).rescueTokens(address(quote), 3 ether);
        assertEq(quote.balanceOf(NEW_OWNER), 3 ether, "new owner not paid");
    }

    function testOnlyExcessLockerAssetsCanBeRecovered() external {
        (MockWETH quote, LpLocker locker,) = _deploy();
        quote.mint(address(locker), 2 ether);
        vm.prank(BUYER);
        vm.expectRevert();
        locker.rescueTokens(address(quote), 1 ether);
        locker.rescueTokens(address(quote), 2 ether);
        assertEq(quote.balanceOf(address(this)), 2 ether, "locker rescue failed");
    }

    function testNativeRescuePaysTheAcceptedOwner() external {
        (, LpLocker locker, CurveballLaunchpad launchpad) = _deploy();
        launchpad.setInvited(address(this), true);
        address token = launchpad.createToken("Safe", "SAFE", "");
        launchpad.transferOwnership(NEW_OWNER);
        locker.transferOwnership(NEW_OWNER);
        vm.prank(NEW_OWNER);
        launchpad.acceptOwnership();
        vm.prank(NEW_OWNER);
        locker.acceptOwnership();
        vm.deal(address(launchpad), 1 ether);
        vm.deal(address(locker), 2 ether);
        vm.deal(token, 3 ether);
        vm.prank(NEW_OWNER);
        launchpad.rescueNative(1 ether);
        vm.prank(NEW_OWNER);
        locker.rescueNative(2 ether);
        vm.prank(NEW_OWNER);
        MemeToken(token).rescueNative(3 ether);
        assertEq(NEW_OWNER.balance, 6 ether, "native recovery missed funds");
    }

    function _deploy() private returns (MockWETH quote, LpLocker locker, CurveballLaunchpad launchpad) {
        quote = new MockWETH();
        locker = new LpLocker(address(this), 5_000);
        launchpad = new CurveballLaunchpad(
            address(quote), address(new MockIcarusFactory()), address(locker), 1_000_000 ether, 800_000 ether, 10 ether
        );
        locker.setLaunchpad(address(launchpad));
    }
}
