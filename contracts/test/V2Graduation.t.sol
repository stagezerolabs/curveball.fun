// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory, MockPool} from "../contracts/mocks/MockIcarus.sol";
import {IIcarusFactory} from "../contracts/interfaces/IIcarus.sol";
import {PoCBrokenFactory} from "../contracts/test/PoCIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";
import {CurveLpLocker} from "../contracts/LpLocker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract WrongPairFactory is IIcarusFactory {
    mapping(address => bool) public isPool;
    function isPaused() external pure returns (bool) { return false; }
    function getPool(address, address, bool) external pure returns (address) { return address(0); }
    function createPool(address, address quote, bool) external returns (address pool) {
        pool = address(new MockPool(quote, address(0xBAD)));
        isPool[pool] = true;
    }
}

contract V2GraduationTest is TestBase {
    address private constant TRADER = address(0xBEEF);

    function testTwoCallsGraduateAndLockLp() external {
        (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) =
            _market(address(new MockIcarusFactory()));
        _buyToFull(quote, curve);
        assertEq(curve.sold(), 800_000 ether, "curve did not sell out");
        factory.graduate(address(token));
        assertTrue(curve.ready(), "curve not ready");
        assertEq(quote.balanceOf(address(curve)), curve.realQuote(), "prepare moved reserve");
        address pool = factory.createGraduatedPool(address(token));
        assertTrue(curve.graduated(), "not graduated");
        assertEq(curve.pool(), pool, "wrong pool");
        assertEq(curve.realQuote(), 0, "reserve remains");
        assertTrue(IERC20(pool).balanceOf(address(factory.locker())) > 0, "LP not locked");
        assertTrue(token.tradingEnabled(), "token stayed locked");
        vm.prank(TRADER);
        vm.expectRevert();
        curve.sellTokens(1 ether, 0, DEADLINE);
    }

    function testPoolCreationRevertLeavesSellerExit() external {
        PoCBrokenFactory broken = new PoCBrokenFactory();
        broken.setBroken(false);
        (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) =
            _market(address(broken));
        _buyToFull(quote, curve);
        factory.graduate(address(token));
        uint256 reserve = curve.realQuote();
        broken.setBroken(true);
        vm.expectRevert();
        factory.createGraduatedPool(address(token));
        assertEq(quote.balanceOf(address(curve)), reserve, "failed creation drained quote");
        assertTrue(curve.ready() && !curve.graduated(), "bad failed state");
        vm.prank(TRADER);
        token.approve(address(curve), 800_000 ether);
        vm.prank(TRADER);
        uint256 net = curve.sellTokens(800_000 ether, 0, DEADLINE);
        assertTrue(net > 0 && !curve.ready(), "seller could not exit");
    }

    function testPreparationDefersOnPausedVenueAndCanRetry() external {
        PoCBrokenFactory venue = new PoCBrokenFactory();
        venue.setBroken(false);
        (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) =
            _market(address(venue));
        _buyToFull(quote, curve);
        uint256 reserve = curve.realQuote();
        venue.setBroken(true);
        factory.graduate(address(token));
        assertTrue(!curve.ready() && !curve.graduated(), "deferred market was prepared");
        assertEq(quote.balanceOf(address(curve)), reserve, "deferred market lost reserve");
        venue.setBroken(false);
        factory.graduate(address(token));
        assertTrue(curve.ready(), "retry did not prepare market");
    }

    function testWrongNewPoolCannotReceiveReserves() external {
        (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) =
            _market(address(new WrongPairFactory()));
        _buyToFull(quote, curve);
        factory.graduate(address(token));
        uint256 reserve = curve.realQuote();
        vm.expectRevert();
        factory.createGraduatedPool(address(token));
        assertEq(quote.balanceOf(address(curve)), reserve, "wrong pool drained WETH");
        assertEq(token.balanceOf(address(curve)), 200_000 ether, "wrong pool drained tokens");
        assertTrue(!token.tradingEnabled() && !curve.graduated(), "failed graduation changed market");
    }

    function _market(address icarus)
        private returns (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve)
    {
        quote = new MockWETH();
        factory = CurveV2Deployment.deploy(address(quote), icarus, address(this), 1_000_000 ether, 800_000 ether, 10 ether);
        factory.setInvited(TRADER, true);
        vm.prank(TRADER);
        (address t, address c) = factory.createToken("V2", "V2", "", 0);
        token = CurveLauncherToken(t);
        curve = CurveBondingCurve(c);
    }

    function _buyToFull(MockWETH quote, CurveBondingCurve curve) private {
        quote.mint(TRADER, 50 ether);
        vm.prank(TRADER);
        quote.approve(address(curve), 50 ether);
        vm.prank(TRADER);
        curve.buyTokens(50 ether, 800_000 ether, DEADLINE);
    }
}
