// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {MockBetaWETH} from "../contracts/mocks/MockBetaWETH.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockQuoteBridge} from "../contracts/mocks/MockQuoteBridge.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";

contract AsdPaymentFlowTest is TestBase {
    struct Scenario {
        MockBetaWETH mockWeth;
        MockWETH weth;
        CurveLauncherToken asd;
        CurveLauncherToken farm;
        CurveBondingCurve asdCurve;
        CurveBondingCurve farmCurve;
        MockQuoteBridge bridge;
    }

    function testLockedBetaTokenCanFundMainCurveThroughSellAndRedeem() external {
        Scenario memory s = _setup();
        s.mockWeth.mint(address(this), 0.5 ether);
        s.mockWeth.approve(address(s.asdCurve), 0.5 ether);
        s.asdCurve.buyTokens(0.5 ether, 1, DEADLINE);
        uint256 asdAmount = s.asd.balanceOf(address(this)) / 2;
        vm.expectRevert();
        s.asd.transfer(address(s.bridge), asdAmount);

        s.asd.approve(address(s.asdCurve), asdAmount);
        (uint256 expectedMock,,,) = s.asdCurve.quoteSell(asdAmount);
        uint256 beforeMock = s.mockWeth.balanceOf(address(this));
        s.asdCurve.sellTokens(asdAmount, expectedMock * 97 / 100, DEADLINE);
        uint256 proceeds = s.mockWeth.balanceOf(address(this)) - beforeMock;
        assertEq(proceeds, expectedMock, "sell output mismatch");
        s.mockWeth.approve(address(s.bridge), proceeds);
        s.bridge.redeem(proceeds, DEADLINE);
        assertEq(s.weth.balanceOf(address(this)), proceeds, "bridge output mismatch");
        s.weth.approve(address(s.farmCurve), proceeds);
        (uint256 expectedFarm,,,,) = s.farmCurve.quoteBuy(proceeds);
        s.farmCurve.buyTokens(proceeds, expectedFarm * 97 / 100, DEADLINE);
        assertEq(s.farm.balanceOf(address(this)), expectedFarm, "FARM buy output mismatch");
        assertEq(s.weth.balanceOf(address(s.farmCurve)), s.farmCurve.realQuote(), "main reserve unbacked");
    }

    function _setup() private returns (Scenario memory s) {
        vm.deal(address(this), 2 ether);
        s.mockWeth = new MockBetaWETH();
        s.weth = new MockWETH();
        CurveLaunchFactory betaFactory = CurveV2Deployment.deploy(address(s.mockWeth), address(new MockIcarusFactory()),
            address(this), 1_000_000 ether, 800_000 ether, 10 ether);
        CurveLaunchFactory mainFactory = CurveV2Deployment.deploy(address(s.weth), address(new MockIcarusFactory()),
            address(this), 1_000_000 ether, 800_000 ether, 10 ether);
        (address asdAddress, address asdCurveAddress) = betaFactory.createToken("ASD", "ASD", "", 0);
        (address farmAddress, address farmCurveAddress) = mainFactory.createToken("FARM", "FARM", "", 0);
        s.asd = CurveLauncherToken(asdAddress);
        s.farm = CurveLauncherToken(farmAddress);
        s.asdCurve = CurveBondingCurve(asdCurveAddress);
        s.farmCurve = CurveBondingCurve(farmCurveAddress);
        s.bridge = new MockQuoteBridge{value: 1 ether}(address(s.mockWeth), address(s.weth));
    }
}
