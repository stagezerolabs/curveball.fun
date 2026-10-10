// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {MockBetaUSDC} from "../contracts/mocks/MockBetaUSDC.sol";
import {MockBetaWETH} from "../contracts/mocks/MockBetaWETH.sol";
import {FixedRateVenue} from "../contracts/mocks/FixedRateVenue.sol";
import {CurveTokenBuyAdapter} from "../contracts/CurveTokenBuyAdapter.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";

contract V2TokenBuyTest is TestBase {
    address private constant BUYER = address(0xBEEF);

    function testClaimAndAtomicBuyPreserveBalances() external {
        (MockBetaUSDC usdc, MockBetaWETH quote, FixedRateVenue venue, CurveTokenBuyAdapter adapter,
            CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) = _setup();
        vm.prank(BUYER);
        usdc.claim();
        vm.prank(BUYER);
        usdc.approve(address(adapter), 1_000e6);
        uint256 quoteOut = venue.quoteExactInput(1_000e6);
        (uint256 expected,,,,) = curve.quoteBuy(quoteOut);
        vm.prank(BUYER);
        uint256 received = adapter.buyWithToken(address(token), 1_000e6, quoteOut, expected, DEADLINE);
        assertEq(received, expected, "buyer output mismatch");
        assertEq(token.balanceOf(BUYER), expected, "buyer missing token");
        assertEq(usdc.balanceOf(BUYER), 0, "input not spent");
        assertEq(quote.balanceOf(address(adapter)), 0, "adapter retained quote");
        assertEq(usdc.balanceOf(address(adapter)), 0, "adapter retained input");
        assertEq(quote.balanceOf(address(curve)), curve.realQuote(), "curve reserve unbacked");
        assertEq(address(factory.tokenBuyAdapter()), address(adapter), "adapter not bound");
    }

    function testRevertedBuyIsAtomicAndClaimIsOneTime() external {
        (MockBetaUSDC usdc, MockBetaWETH quote, FixedRateVenue venue, CurveTokenBuyAdapter adapter,, CurveLauncherToken token,) = _setup();
        vm.prank(BUYER);
        usdc.claim();
        vm.prank(BUYER);
        vm.expectRevert();
        usdc.claim();
        vm.prank(BUYER);
        usdc.approve(address(adapter), 1_000e6);
        uint256 before = usdc.balanceOf(BUYER);
        vm.prank(BUYER);
        vm.expectRevert();
        adapter.buyWithToken(address(token), 1_000e6, 1 ether, 1, DEADLINE);
        assertEq(usdc.balanceOf(BUYER), before, "failed swap spent input");
        vm.prank(BUYER);
        vm.expectRevert();
        adapter.buyWithToken(address(token), 1_000e6, 1, type(uint256).max, DEADLINE);
        assertEq(usdc.balanceOf(BUYER), before, "failed curve buy spent input");
        assertEq(quote.balanceOf(address(adapter)), 0, "failed buy retained quote");
        assertEq(quote.balanceOf(address(venue)), 1_000 ether, "failed buy depleted venue");
    }

    function testUnknownMarketExpiredAndPausedFail() external {
        (MockBetaUSDC usdc,, FixedRateVenue venue, CurveTokenBuyAdapter adapter, CurveLaunchFactory factory,
            CurveLauncherToken token,) = _setup();
        vm.prank(BUYER);
        usdc.claim();
        vm.prank(BUYER);
        usdc.approve(address(adapter), 1_000e6);
        vm.prank(BUYER);
        vm.expectRevert();
        adapter.buyWithToken(address(0xBAD), 1_000e6, 1, 1, DEADLINE);
        vm.warp(block.timestamp + 1);
        vm.prank(BUYER);
        vm.expectRevert();
        adapter.buyWithToken(address(token), 1_000e6, 1, 1, 0);
        factory.setTokenBuyEnabled(false);
        uint256 quoted = venue.quoteExactInput(1_000e6);
        vm.prank(BUYER);
        vm.expectRevert();
        adapter.buyWithToken(address(token), 1_000e6, quoted, 1, DEADLINE);
    }

    function _setup() private returns (
        MockBetaUSDC usdc, MockBetaWETH quote, FixedRateVenue venue, CurveTokenBuyAdapter adapter,
        CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve
    ) {
        usdc = new MockBetaUSDC();
        quote = new MockBetaWETH();
        venue = new FixedRateVenue(address(usdc), address(quote));
        quote.mint(address(venue), 1_000 ether);
        factory = CurveV2Deployment.deploy(address(quote), address(new MockIcarusFactory()), address(this),
            1_000_000 ether, 800_000 ether, 10 ether);
        adapter = new CurveTokenBuyAdapter(address(factory), address(usdc), address(quote), address(venue));
        factory.setTokenBuyAdapter(address(adapter));
        (address tokenAddress, address curveAddress) = factory.createToken("Beta", "BETA", "", 0);
        token = CurveLauncherToken(tokenAddress);
        curve = CurveBondingCurve(curveAddress);
    }
}
