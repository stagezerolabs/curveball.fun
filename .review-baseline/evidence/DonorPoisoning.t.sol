// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "../Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockIcarusFactory, MockIcarusPool} from "../mocks/MockIcarus.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";
import {CurveToken} from "../../contracts/CurveToken.sol";

/// @dev Probes the ADR 0003 claim "nothing a donor does can make this revert" for graduate().
///      Each case documents what a hostile donor CAN and CANNOT achieve.
contract DonorPoisoningTest is Fixture {
    function _launchSoldOut() internal returns (address token) {
        token = _launch(alice, 0, 0);
        // Buy the whole curve supply; buy() caps tokensOut at `remaining`.
        _buy(bob, token, 100 ether);
        assertEq(uint8(launchpad.market(token).state), uint8(CurveLaunchpad.State.Ready));
    }

    /// CASE 1: a donor creates the pool and syncs WETH into it before graduation.
    /// Expected per ADR: graduation still succeeds; opening price is >= curve-end spot.
    function test_donorWethIntoPreCreatedPool_stillGraduates() public {
        address token = _launchSoldOut();
        address pool = icarus.createPool(token, address(weth), false);

        // Donate 5 WETH directly into the pool, then sync so reserves pick it up.
        weth.mint(address(this), 5 ether);
        weth.transfer(pool, 5 ether);
        MockIcarusPool(pool).sync();
        (uint256 r0, uint256 r1,) = MockIcarusPool(pool).getReserves();
        assertGt(r0 + r1, 0, "donation landed in the pool reserves");

        // Graduation must still succeed.
        launchpad.graduate(token);
        assertEq(uint8(launchpad.market(token).state), uint8(CurveLaunchpad.State.Graduated));
    }

    /// CASE 2: a donor tries to move TOKENS into the pool before graduation.
    /// The pre-graduation transfer lock should make this impossible for a third party.
    function test_donorCannotSeedPoolTokens_beforeGraduation() public {
        address token = _launchSoldOut();
        address pool = icarus.createPool(token, address(weth), false);

        // bob actually holds tokens from the buy; try to send them to the pool.
        uint256 held = IERC20(token).balanceOf(bob);
        assertGt(held, 0, "bob holds curve tokens");

        // Resolve the pool address BEFORE expectRevert: expectRevert applies to the very
        // next external call, and an argument-evaluated getPool() call would consume it.
        vm.prank(bob);
        vm.expectRevert(CurveToken.Locked.selector);
        IERC20(token).transfer(pool, 1);

        // Control: a plain transfer to an unrelated EOA is locked too.
        vm.prank(bob);
        vm.expectRevert(CurveToken.Locked.selector);
        IERC20(token).transfer(makeAddr("randomEoa"), 1);

        assertEq(IERC20(token).balanceOf(pool), 0, "pool token side stayed empty");
    }

    /// CASE 3: what does the donor actually pay? Compare pool opening price vs curve-end spot.
    function test_donorWeth_opensPoolAtOrAboveCurveEndSpot() public {
        address token = _launchSoldOut();
        CurveLaunchpad.Market memory m = launchpad.market(token);
        uint256 curveSpotX18 = m.virtualQuote * 1e18 / m.virtualToken;

        address pool = icarus.createPool(token, address(weth), false);
        weth.mint(address(this), 5 ether);
        weth.transfer(pool, 5 ether);
        MockIcarusPool(pool).sync();

        launchpad.graduate(token);

        MockIcarusPool p = MockIcarusPool(pool);
        (uint256 r0, uint256 r1,) = p.getReserves();
        bool tokenIs0 = p.token0() == token;
        (uint256 tokenReserve, uint256 quoteReserve) = tokenIs0 ? (r0, r1) : (r1, r0);
        uint256 openSpotX18 = quoteReserve * 1e18 / tokenReserve;

        emit log_named_uint("curve end spot (x18)   ", curveSpotX18);
        emit log_named_uint("pool opening spot (x18)", openSpotX18);
        assertGe(openSpotX18, curveSpotX18, "ADR: pool opens at or above curve-end spot");
    }
}
