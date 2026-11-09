// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "../Fixture.sol";
import {CurveBuybackTreasury} from "../../contracts/CurveBuybackTreasury.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockIcarusPool} from "../mocks/MockIcarus.sol";

contract CurveBuybackTreasuryTest is Fixture {
    function test_allMarketsFundOneBudget_andOnlySelectedCurveBurns() public {
        CurveBuybackTreasury buybacks = escrow.buybackTreasury();
        address curve = _launch(creator, 0);
        address other = _launch(bob, 0);
        _sellOut(alice, curve);
        _sellOut(alice, other);
        uint256 budget = buybacks.quoteBudget();
        assertGt(budget, 0);
        vm.expectRevert(CurveBuybackTreasury.InvalidTarget.selector);
        vm.prank(owner);
        buybacks.setCurveToken(curve);
        launchpad.graduate(curve);
        launchpad.graduate(other);
        vm.prank(owner);
        buybacks.setCurveToken(curve);
        vm.expectRevert(CurveBuybackTreasury.AlreadySet.selector);
        vm.prank(owner);
        buybacks.setCurveToken(other);
        MockIcarusPool pool = MockIcarusPool(launchpad.poolOf(curve));
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + 1801);
            pool.sync();
        }
        uint256 curveSupply = IERC20(curve).totalSupply();
        uint256 otherSupply = IERC20(other).totalSupply();
        vm.prank(owner);
        uint256 burned = buybacks.buyback();
        assertGt(burned, 0);
        assertEq(IERC20(curve).totalSupply(), curveSupply - burned);
        assertEq(IERC20(other).totalSupply(), otherSupply);
        assertLt(buybacks.quoteBudget(), budget);
    }

    function test_marketTokenLpFeeShareIsHeldForConversion() public {
        CurveBuybackTreasury buybacks = escrow.buybackTreasury();
        address curve = _launch(creator, 0);
        _sellOut(alice, curve);
        address pool = launchpad.graduate(curve);
        vm.prank(owner);
        buybacks.setCurveToken(curve);
        MockIcarusPool p = MockIcarusPool(pool);
        uint256 input = 10_000 ether;
        vm.prank(alice);
        IERC20(curve).transfer(address(p), input);
        uint256 out = p.getAmountOut(input, curve);
        p.swap(p.token0() == curve ? 0 : out, p.token0() == curve ? out : 0, address(this), "");
        locker.claim(pool);
        assertGt(buybacks.tokenBudget(curve), 0);
        uint256 beforeSupply = IERC20(curve).totalSupply();
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + 1801);
            p.sync();
        }
        buybacks.convert(curve);
        assertEq(IERC20(curve).totalSupply(), beforeSupply);
    }
}
