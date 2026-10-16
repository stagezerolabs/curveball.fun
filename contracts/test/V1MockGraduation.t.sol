// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveV1Factory} from "../contracts/CurveV1Factory.sol";
import {CurveV1Deployment} from "../contracts/CurveV1Deployment.sol";
import {CurveV1PoolAdapter} from "../contracts/CurveV1PoolAdapter.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";

contract V1MockGraduationTest is TestBase {
    address private constant TRADER = address(0xBEEF);

    function testMockGraduationAndFuturePolicySnapshot() external {
        MockWETH weth = new MockWETH();
        MockIcarusFactory mock = new MockIcarusFactory();
        CurveV1Factory factory = CurveV1Deployment.deploy(address(weth), address(mock), address(this), address(0), 0);
        (address token, address curveAddress) = factory.createToken("V1", "V1", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        assertEq(curve.initialVQ(), 0.00125 ether, "wrong initial reserve");
        address firstAdapter = factory.venueOf(token);

        factory.setGraduationTarget(0.01 ether);
        CurveV1PoolAdapter next =
            new CurveV1PoolAdapter(address(factory), address(weth), address(factory.locker()), address(mock), true);
        factory.setVenue(address(next));
        (address nextToken, address nextCurveAddress) = factory.createToken("V1 Two", "V1T", "", 0);
        assertEq(factory.venueOf(token), firstAdapter, "old venue changed");
        assertEq(factory.venueOf(nextToken), address(next), "new venue not selected");
        assertEq(CurveBondingCurve(nextCurveAddress).initialVQ(), 0.0025 ether, "new target not applied");

        weth.mint(TRADER, 0.006 ether);
        vm.prank(TRADER);
        weth.approve(curveAddress, 0.006 ether);
        vm.prank(TRADER);
        curve.buyTokens(0.006 ether, 800_000 ether, DEADLINE);
        assertEq(curve.realQuote(), 0.005 ether, "wrong graduation proceeds");
        factory.graduate(token);
        address pool = factory.createGraduatedPool(token);
        assertTrue(curve.graduated(), "curve did not graduate");
        assertEq(weth.balanceOf(pool), 0.005 ether, "WETH not deposited");
        assertTrue(IERC20(pool).balanceOf(address(factory.locker())) > 0, "LP not locked");
        assertEq(factory.locker().tokenOfPool(pool), token, "pool not registered");
    }
}
