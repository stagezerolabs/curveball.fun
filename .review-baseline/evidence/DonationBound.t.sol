// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "../Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockIcarusPool} from "../mocks/MockIcarus.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";

/// @dev The ADR and the graduate() comment say a donation "beyond the burn buffer" makes the pool
///      open "slightly higher at the donor's expense". This measures the actual magnitude and
///      whether it is bounded, since the buffer cap only applies to the token side.
contract DonationBoundTest is Fixture {
    uint256 constant S = 1_000_000 ether;
    uint256 constant C = 800_000 ether;

    function _launchSoldOut() internal returns (address token) {
        token = _launch(alice, 0, 0);
        _buy(bob, token, 100 ether);
    }

    function _spotAfterDonation(uint256 donation) internal returns (uint256) {
        address token = _launchSoldOut();
        CurveLaunchpad.Market memory m = launchpad.market(token);
        uint256 curveSpotX18 = m.virtualQuote * 1e18 / m.virtualToken;

        address pool = icarus.createPool(token, address(weth), false);
        if (donation != 0) {
            weth.mint(address(this), donation);
            weth.transfer(pool, donation);
            MockIcarusPool(pool).sync();
        }
        launchpad.graduate(token);

        MockIcarusPool p = MockIcarusPool(pool);
        (uint256 r0, uint256 r1,) = p.getReserves();
        (uint256 tokenReserve, uint256 quoteReserve) =
            p.token0() == token ? (r0, r1) : (r1, r0);
        emit log_named_uint("  curve spot x18", curveSpotX18);
        emit log_named_uint("  pool  spot x18", quoteReserve * 1e18 / tokenReserve);
        emit log_named_uint("  tokens seeded ", tokenReserve / 1e18);
        return quoteReserve * 1e18 / tokenReserve;
    }

    /// Derive the donation that exactly exhausts the burn buffer, then show growth beyond it.
    function test_donationPremiumIsUnbounded() public {
        emit log("--- donation = 0 (no bump) ---");
        uint256 base = _spotAfterDonation(0);

        emit log("--- donation = 1 ether (should equal curve spot) ---");
        uint256 atOne = _spotAfterDonation(1 ether);
        assertEq(atOne, base, "within the buffer the opening price equals the curve-end spot");

        emit log("--- donation = 2 ether ---");
        uint256 atTwo = _spotAfterDonation(2 ether);

        emit log("--- donation = 5 ether ---");
        uint256 atFive = _spotAfterDonation(5 ether);

        emit log("--- donation = 50 ether ---");
        uint256 atFifty = _spotAfterDonation(50 ether);

        assertGt(atTwo, atOne);
        assertGt(atFive, atTwo);
        assertGt(atFifty, atFive);

        // Report the multiple vs. the curve-end spot.
        emit log_named_uint("2 ether  multiple x1000", atTwo * 1_000 / base);
        emit log_named_uint("5 ether  multiple x1000", atFive * 1_000 / base);
        emit log_named_uint("50 ether multiple x1000", atFifty * 1_000 / base);
    }
}
