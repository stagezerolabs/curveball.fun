// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveV2Deployment} from "../historical/CurveV2Deployment.sol";
import {CurveLaunchFactory} from "../historical/CurveLaunchFactory.sol";
import {CurveLauncherToken} from "../historical/CurveLauncherToken.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveHolderReserve} from "../contracts/CurveHolderReserve.sol";

contract HolderReserveTest is TestBase {
    address private constant CREATOR = address(0xCAFE);
    address private constant HOLDER = address(0xBEEF);
    address private constant OTHER = address(0xABCD);

    function testReserveBoundsAndZeroOption() external {
        (CurveLaunchFactory factory,) = _factory();
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createToken("Too much", "HIGH", "", 0, 501);
        vm.prank(CREATOR);
        (address token, address curve) = factory.createToken("Zero", "ZERO", "", 0, 0);
        assertEq(CurveLauncherToken(token).balanceOf(curve), 1_000_000 ether, "zero reserve changed curve");
        assertEq(factory.reserveBps(token), 0, "wrong zero setting");
        vm.prank(CREATOR);
        (address partialToken,) = factory.createToken("Partial", "PART", "", 0, 250);
        assertEq(
            CurveLauncherToken(partialToken).balanceOf(address(factory.holderReserve())),
            25_000 ether,
            "wrong partial reserve"
        );
    }

    function testSnapshotRoundsAndPermissionlessClaims() external {
        (CurveLaunchFactory factory, MockWETH quote) = _factory();
        vm.prank(CREATOR);
        (address tokenAddress, address curveAddress) = factory.createToken("Holders", "HOLD", "", 0);
        CurveLauncherToken token = CurveLauncherToken(tokenAddress);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        CurveHolderReserve reserve = factory.holderReserve();
        assertEq(token.balanceOf(address(reserve)), 50_000 ether, "missing reserve");
        vm.prank(CREATOR);
        vm.expectRevert();
        reserve.createRound(tokenAddress, block.number, 1 ether);

        quote.mint(HOLDER, 50 ether);
        vm.prank(HOLDER);
        quote.approve(curveAddress, 50 ether);
        vm.prank(HOLDER);
        curve.buyTokens(50 ether, 800_000 ether, DEADLINE);
        factory.graduate(tokenAddress);
        address pool = factory.createGraduatedPool(tokenAddress);
        assertEq(token.balanceOf(pool), 150_000 ether, "wrong pool allocation");
        uint256 graduationBlock = block.number;
        vm.roll(block.number + 1);
        vm.prank(OTHER);
        vm.expectRevert();
        reserve.createRound(tokenAddress, graduationBlock, 1 ether);
        vm.prank(CREATOR);
        vm.expectRevert();
        reserve.createRound(tokenAddress, block.number, 1 ether);
        vm.prank(HOLDER);
        token.transfer(OTHER, 400_000 ether);
        vm.prank(CREATOR);
        uint256 first = reserve.createRound(tokenAddress, graduationBlock, 20_000 ether);
        assertEq(reserve.claimable(tokenAddress, first, HOLDER), 20_000 ether, "past balance changed");
        assertEq(reserve.claimable(tokenAddress, first, OTHER), 0, "future holder included");
        vm.prank(OTHER);
        reserve.claim(tokenAddress, first, HOLDER);
        assertEq(token.balanceOf(HOLDER), 420_000 ether, "claim not paid to holder");
        vm.expectRevert();
        reserve.claim(tokenAddress, first, HOLDER);

        uint256 secondSnapshot = block.number;
        vm.roll(block.number + 1);
        vm.prank(CREATOR);
        uint256 second = reserve.createRound(tokenAddress, secondSnapshot, 30_000 ether);
        assertEq(
            reserve.claimable(tokenAddress, second, HOLDER),
            uint256(30_000 ether) * 420_000 / 820_000,
            "holder split wrong"
        );
        assertEq(
            reserve.claimable(tokenAddress, second, OTHER),
            uint256(30_000 ether) * 400_000 / 820_000,
            "other split wrong"
        );
        assertEq(reserve.claimable(tokenAddress, second, pool), 0, "pool can claim");
        assertEq(reserve.claimable(tokenAddress, second, address(reserve)), 0, "reserve can claim");
        vm.prank(CREATOR);
        vm.expectRevert();
        reserve.createRound(tokenAddress, secondSnapshot, 1 ether);
        vm.prank(CREATOR);
        vm.expectRevert();
        reserve.createRound(tokenAddress, secondSnapshot, 50_001 ether);
    }

    function _factory() private returns (CurveLaunchFactory factory, MockWETH quote) {
        quote = new MockWETH();
        factory = CurveV2Deployment.deploy(
            address(quote), address(new MockIcarusFactory()), address(this), 1_000_000 ether, 800_000 ether, 10 ether
        );
    }
}
