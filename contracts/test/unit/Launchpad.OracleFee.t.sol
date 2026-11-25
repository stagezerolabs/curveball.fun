// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "../Fixture.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";

contract LaunchpadOracleFeeTest is Fixture {
    function test_quote_roundsUpToAtLeastOneDollar() public {
        stork.setPrice(3_000 ether);
        (uint256 fee, uint256 price, uint64 timestampNs) = launchpad.quoteLaunchFee();
        assertEq(price, 3_000 ether);
        assertEq(timestampNs, uint64(block.timestamp * 1e9));
        assertEq(fee, 333_333_333_333_334);
        assertGe(fee * price, 1e36);
        assertLt((fee - 1) * price, 1e36);
    }

    function test_launch_chargesCurrentPriceAndEmitsActualPayment() public {
        stork.setPrice(1_600 ether);
        uint256 fee = 625_000_000_000_000;
        _fund(creator, fee);
        address predicted = launchpad.predictToken(creator);
        vm.expectEmit(address(launchpad));
        emit CurveLaunchpad.LaunchFeePaid(predicted, creator, fee, 1_600 ether, uint64(block.timestamp * 1e9));
        vm.prank(creator);
        launchpad.launch(_meta(), 0, 0, 0, fee);
        assertEq(weth.balanceOf(treasury), fee);
        assertEq(weth.balanceOf(creator), 0);
    }

    function test_launch_rejectsPriceMoveBeyondCreatorCapWithoutStateChange() public {
        _fund(creator, 1 ether);
        stork.setPrice(1_600 ether);
        vm.prank(creator);
        vm.expectRevert(abi.encodeWithSelector(CurveLaunchpad.LaunchFeeTooHigh.selector, 625_000_000_000_000, LAUNCH_FEE));
        launchpad.launch(_meta(), 0, 0, 0, LAUNCH_FEE);
        assertEq(launchpad.launchNonce(creator), 0);
        assertEq(weth.balanceOf(treasury), 0);
    }

    function test_staleOracleBlocksLaunchButExistingMarketStillTrades() public {
        address token = _launch(creator, 0);
        vm.warp(block.timestamp + 30 minutes);
        (uint256 fee,,) = launchpad.quoteLaunchFee();
        assertGt(fee, 0);
        vm.warp(block.timestamp + 1);
        _fund(bob, 1 ether);
        vm.prank(bob);
        vm.expectRevert(CurveLaunchpad.StaleOraclePrice.selector);
        launchpad.launch(_meta(), 0, 0, 0, LAUNCH_FEE);
        assertEq(launchpad.launchNonce(bob), 0);
        assertGt(_buy(bob, token, 0.01 ether), 0);
    }

    function test_futureOracleTimestampIsRejected() public {
        stork.setTimestamp(uint64((block.timestamp + 1) * 1e9));
        vm.expectRevert(CurveLaunchpad.StaleOraclePrice.selector);
        launchpad.quoteLaunchFee();
    }

    function test_invalidPricesAreRejected() public {
        int192[4] memory invalid = [int192(0), int192(-1), int192(99 ether), int192(100_001 ether)];
        for (uint256 i; i < invalid.length; ++i) {
            stork.setPrice(invalid[i]);
            vm.expectRevert(CurveLaunchpad.InvalidOraclePrice.selector);
            launchpad.quoteLaunchFee();
        }
    }

    function test_unavailableOracleBlocksLaunchWithoutTakingPayment() public {
        _fund(creator, 1 ether);
        stork.setUnavailable(true);
        vm.prank(creator);
        vm.expectRevert("oracle unavailable");
        launchpad.launch(_meta(), 0, 0, 0, 1 ether);
        assertEq(launchpad.launchNonce(creator), 0);
        assertEq(weth.balanceOf(treasury), 0);
    }
}
