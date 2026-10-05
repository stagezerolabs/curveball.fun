// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveLaunchAndBuy} from "../contracts/CurveLaunchAndBuy.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";

contract V2LaunchAndBuyTest is TestBase {
    address private constant CREATOR = address(0xCAFE);

    function testAtomicLaunchBuysForRealCreatorAndRefundsUnusedBudget() external {
        MockWETH quote = new MockWETH();
        CurveLaunchFactory factory = CurveV2Deployment.deploy(
            address(quote), address(new MockIcarusFactory()), address(this), 1_000_000 ether, 800_000 ether, 10 ether
        );
        CurveLaunchAndBuy wrapper = factory.launchAndBuy();
        factory.setInvited(CREATOR, true);
        quote.mint(CREATOR, 50 ether);
        vm.prank(CREATOR);
        quote.approve(address(wrapper), 50 ether);
        vm.prank(CREATOR);
        CurveLaunchAndBuy.LaunchRequest memory request = CurveLaunchAndBuy.LaunchRequest({
            name: "Atomic", symbol: "ATM", uri: "", creatorTaxBps: 0,
            maxSpend: 50 ether, minOut: 800_000 ether, deadline: DEADLINE
        });
        (address token, address curve, uint256 bought) = wrapper.launchAndBuy(request);
        assertEq(CurveLauncherToken(token).balanceOf(CREATOR), bought, "creator did not receive bought tokens");
        assertEq(CurveLauncherToken(token).balanceOf(address(wrapper)), 0, "wrapper retained tokens");
        assertEq(quote.balanceOf(address(wrapper)), 0, "wrapper retained WETH");
        assertTrue(quote.balanceOf(CREATOR) > 0, "unused budget not refunded");
        (address registeredCurve, address registeredCreator,,,,,) = factory.market(token);
        assertEq(registeredCurve, curve, "curve not registered");
        assertEq(registeredCreator, CREATOR, "wrapper became creator");
        assertEq(CurveBondingCurve(curve).sold(), bought, "curve did not record buy");
    }
}
