// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveLaunchAndBuy} from "../contracts/CurveLaunchAndBuy.sol";
import {CurveLaunchFeeTreasury} from "../contracts/CurveLaunchFeeTreasury.sol";

contract V2LaunchFeeTest is TestBase {
    uint256 private constant FEE = 0.0004 ether;
    address private constant CREATOR = address(0xCAFE);

    function testDirectLaunchChargesFeeAndTreasuryOwnerCanRecoverIt() external {
        MockWETH quote = new MockWETH();
        CurveLaunchFeeTreasury treasury = new CurveLaunchFeeTreasury(address(this));
        CurveLaunchFactory factory = CurveV2Deployment.deployWithFee(
            address(quote), address(new MockIcarusFactory()), address(this), address(treasury), FEE,
            1_000_000 ether, 800_000 ether, 10 ether
        );
        quote.mint(CREATOR, FEE);
        vm.prank(CREATOR);
        quote.approve(address(factory), FEE);
        vm.prank(CREATOR);
        factory.createToken("Fee", "FEE", "", 0);
        assertEq(quote.balanceOf(address(treasury)), FEE, "fee not received");
        treasury.withdrawToken(address(quote), FEE, address(this));
        assertEq(quote.balanceOf(address(this)), FEE, "owner could not recover fee");
    }

    function testLaunchFailsWithoutFeeApproval() external {
        MockWETH quote = new MockWETH();
        CurveLaunchFeeTreasury treasury = new CurveLaunchFeeTreasury(address(this));
        CurveLaunchFactory factory = CurveV2Deployment.deployWithFee(
            address(quote), address(new MockIcarusFactory()), address(this), address(treasury), FEE,
            1_000_000 ether, 800_000 ether, 10 ether
        );
        quote.mint(CREATOR, FEE);
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createToken("Free", "FREE", "", 0);
    }

    function testOnlyTreasuryOwnerCanWithdraw() external {
        MockWETH quote = new MockWETH();
        CurveLaunchFeeTreasury treasury = new CurveLaunchFeeTreasury(address(this));
        quote.mint(address(treasury), FEE);
        vm.prank(CREATOR);
        vm.expectRevert();
        treasury.withdrawToken(address(quote), FEE, CREATOR);
        assertEq(quote.balanceOf(address(treasury)), FEE, "unauthorized withdrawal");
    }

    function testTreasuryOwnerCanRescueNativeCurrency() external {
        CurveLaunchFeeTreasury treasury = new CurveLaunchFeeTreasury(address(this));
        vm.deal(address(treasury), FEE);
        uint256 beforeBalance = address(this).balance;
        treasury.withdrawNative(FEE, payable(address(this)));
        assertEq(address(this).balance, beforeBalance + FEE, "native withdrawal failed");
    }

    function testTreasuryOwnershipCannotBeRenounced() external {
        CurveLaunchFeeTreasury treasury = new CurveLaunchFeeTreasury(address(this));
        vm.expectRevert();
        treasury.renounceOwnership();
        assertEq(treasury.owner(), address(this), "treasury lost its admin");
    }

    receive() external payable {}

    function testLaunchAndBuyChargesFeeOnceOutsideBuyBudget() external {
        MockWETH quote = new MockWETH();
        CurveLaunchFeeTreasury treasury = new CurveLaunchFeeTreasury(address(this));
        CurveLaunchFactory factory = CurveV2Deployment.deployWithFee(
            address(quote), address(new MockIcarusFactory()), address(this), address(treasury), FEE,
            1_000_000 ether, 800_000 ether, 10 ether
        );
        CurveLaunchAndBuy wrapper = factory.launchAndBuy();
        quote.mint(CREATOR, 50 ether + FEE);
        vm.prank(CREATOR);
        quote.approve(address(wrapper), 50 ether + FEE);
        vm.prank(CREATOR);
        wrapper.launchAndBuy(CurveLaunchAndBuy.LaunchRequest({
            name: "Atomic", symbol: "ATM", uri: "", creatorTaxBps: 0, holderReserveBps: 500,
            maxSpend: 50 ether, minOut: 800_000 ether, deadline: DEADLINE
        }));
        assertEq(quote.balanceOf(address(treasury)), FEE, "fee charged incorrectly");
        assertEq(quote.balanceOf(address(wrapper)), 0, "wrapper retained WETH");
    }
}
