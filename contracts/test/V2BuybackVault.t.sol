// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {CurveBuybackVault} from "../contracts/CurveBuybackVault.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";

contract V2BuybackVaultTest is TestBase {
    function owner() external view returns (address) { return address(this); }
    function testIndependentLotsVestAndCanBeClaimedInBoundedRanges() external {
        MockWETH quote = new MockWETH();
        MockWETH meme = new MockWETH();
        CurveBuybackVault vault = new CurveBuybackVault(address(this), address(quote));
        vault.authorize(address(this));
        meme.mint(address(vault), 100 ether);
        vault.creditMeme(address(meme), 100 ether);
        vm.warp(block.timestamp + 365 days);
        meme.mint(address(vault), 100 ether);
        vault.creditMeme(address(meme), 100 ether);
        vm.warp(block.timestamp + 365 days);

        uint256 first = vault.claimVested(address(meme), 0, 1);
        uint256 second = vault.claimVested(address(meme), 1, 1);
        assertEq(first, 40 ether, "first lot vesting changed by later receipt");
        assertEq(second, 20 ether, "second lot vesting started too early");
        assertEq(vault.memeBalance(address(meme)), 140 ether, "unclaimed balance wrong");
        assertEq(vault.claimVested(address(meme), 0, 2), 0, "same time double claim");
        vm.warp(block.timestamp + 4 * 365 days);
        assertEq(vault.claimVested(address(meme), 0, 2), 140 ether, "vested remainder missing");
        assertEq(vault.memeBalance(address(meme)), 0, "vested tokens remain locked");
    }

    function testClaimCannotExceedBoundedBatch() external {
        MockWETH quote = new MockWETH();
        MockWETH meme = new MockWETH();
        CurveBuybackVault vault = new CurveBuybackVault(address(this), address(quote));
        vault.authorize(address(this));
        meme.mint(address(vault), 1 ether);
        vault.creditMeme(address(meme), 1 ether);
        vm.expectRevert();
        vault.claimVested(address(meme), 0, 51);
    }

    function testPermissionlessCurveSweepBuysOnlyOwnTokenWithinImpactBound() external {
        vm.warp(1);
        MockWETH quote = new MockWETH();
        CurveLaunchFactory factory = CurveV2Deployment.deploy(
            address(quote), address(new MockIcarusFactory()), address(this), 1_000_000 ether, 800_000 ether, 10 ether
        );
        (address token, address curveAddress) = factory.createToken("Sweep", "SWP", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        quote.mint(address(this), 2 ether);
        quote.approve(curveAddress, 2 ether);
        curve.buyTokens(2 ether, 1, DEADLINE);
        CurveBuybackVault vault = factory.vault();
        uint256 budget = vault.quoteBalance(token);
        assertTrue(budget > 0, "no buyback budget");
        vm.warp(block.timestamp + 31 minutes);
        (uint256 expected,,,,) = curve.quoteBuy(budget);
        uint256 received = vault.sweepCurve(token, budget, expected, DEADLINE);
        assertEq(received, expected, "sweep quote/execution differs");
        assertEq(vault.memeBalance(token), expected, "bought token not vested");
        assertTrue(vault.quoteBalance(token) < budget, "quote budget not spent");
    }

    function testCurveSweepWaitsForPriceReference() external {
        vm.warp(1);
        MockWETH quote = new MockWETH();
        CurveLaunchFactory factory = CurveV2Deployment.deploy(
            address(quote), address(new MockIcarusFactory()), address(this), 1_000_000 ether, 800_000 ether, 10 ether
        );
        (address token, address curveAddress) = factory.createToken("Sweep", "SWP", "", 0);
        quote.mint(address(this), 2 ether);
        quote.approve(curveAddress, 2 ether);
        CurveBondingCurve(curveAddress).buyTokens(2 ether, 1, DEADLINE);
        CurveBuybackVault vault = factory.vault();
        uint256 budget = vault.quoteBalance(token);
        vm.expectRevert();
        vault.sweepCurve(token, budget, 1, DEADLINE);
    }
}
