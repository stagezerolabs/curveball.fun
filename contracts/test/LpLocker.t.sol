// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {MemeToken} from "../contracts/MemeToken.sol";
import {PoCFactory, PoCFeePool} from "../contracts/test/PoCIcarus.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {TestBase} from "./TestBase.sol";

contract LpLockerTest is TestBase {
    address private constant TREASURY = address(0xB0B);
    address private constant ATTACKER = address(0xA11CE);
    address private constant VICTIM = address(0xBEEF);

    function testCreatorCannotDrainAnotherMarketsLockedLp() external {
        (MockWETH quote, LpLocker locker, CurveballLaunchpad launchpad) = _deploy();
        (, address victimPool) = _launch(quote, launchpad, VICTIM, "VICTIM");
        uint256 lockedLp = PoCFeePool(victimPool).balanceOf(address(locker));
        assertTrue(lockedLp > 0, "locker has no victim LP");

        (, address attackerPool) = _launch(quote, launchpad, ATTACKER, "EVIL");
        PoCFeePool(attackerPool).setFees(lockedLp, lockedLp, 0, 0);
        vm.prank(ATTACKER);
        locker.claim(attackerPool);

        assertEq(PoCFeePool(victimPool).balanceOf(ATTACKER), 0, "attacker stole LP");
        assertEq(PoCFeePool(victimPool).balanceOf(TREASURY), 0, "treasury received LP");
        assertEq(PoCFeePool(victimPool).balanceOf(address(locker)), lockedLp, "victim LP changed");
    }

    function testRejectsUnregisteredPool() external {
        (MockWETH quote, LpLocker locker,) = _deploy();
        PoCFeePool rogue = new PoCFeePool(address(quote), address(quote));
        vm.expectRevert();
        locker.claim(address(rogue));
    }

    function testPaysOnlyBalanceDeliveredByPool() external {
        (MockWETH quote, LpLocker locker, CurveballLaunchpad launchpad) = _deploy();
        (address token, address poolAddress) = _launch(quote, launchpad, VICTIM, "VICTIM");
        PoCFeePool pool = PoCFeePool(poolAddress);
        uint256 paid = 40 ether;
        uint256 surplus = 500 ether;
        quote.mint(poolAddress, paid);
        quote.mint(address(locker), surplus);
        pool.setFees(0, 100 ether, 0, paid);

        uint256 before = quote.balanceOf(VICTIM);
        locker.claim(poolAddress);

        assertEq(quote.balanceOf(VICTIM) - before, paid / 2, "creator share");
        assertEq(quote.balanceOf(TREASURY), paid / 2, "treasury share");
        assertEq(quote.balanceOf(address(locker)), surplus, "locker surplus moved");
        assertEq(MemeToken(token).balanceOf(TREASURY), 0, "token0 fee moved");
    }

    function testAnyoneCanClaimForRegisteredCreator() external {
        (MockWETH quote, LpLocker locker, CurveballLaunchpad launchpad) = _deploy();
        (, address poolAddress) = _launch(quote, launchpad, VICTIM, "VICTIM");
        uint256 paid = 10 ether;
        quote.mint(poolAddress, paid);
        PoCFeePool(poolAddress).setFees(0, paid, 0, paid);
        uint256 before = quote.balanceOf(VICTIM);

        vm.prank(ATTACKER);
        locker.claim(poolAddress);

        assertEq(quote.balanceOf(VICTIM) - before, paid / 2, "creator was not paid");
    }

    function _deploy() private returns (MockWETH quote, LpLocker locker, CurveballLaunchpad launchpad) {
        quote = new MockWETH();
        PoCFactory factory = new PoCFactory();
        locker = new LpLocker(TREASURY, 5_000);
        launchpad = new CurveballLaunchpad(
            address(quote), address(factory), address(locker), 1_000_000 ether, 800_000 ether, 10 ether
        );
        locker.setLaunchpad(address(launchpad));
    }

    function _launch(MockWETH quote, CurveballLaunchpad launchpad, address creator, string memory name)
        private
        returns (address token, address pool)
    {
        vm.prank(creator);
        token = launchpad.createToken(name, name, "ipfs://x");
        quote.mint(creator, 1_000 ether);
        vm.prank(creator);
        quote.approve(address(launchpad), 1_000 ether);
        vm.prank(creator);
        launchpad.buyTokens(token, 1_000 ether, 1, DEADLINE);
        (
            address marketCreator,
            uint128 vt,
            uint128 vq,
            uint128 realQ,
            uint128 sold,
            bool graduated,
            bool pending,
            address returnedPool
        ) = launchpad.markets(token);
        marketCreator;
        vt;
        vq;
        realQ;
        sold;
        pending;
        pool = returnedPool;
        assertTrue(graduated, "market did not graduate");
    }
}
