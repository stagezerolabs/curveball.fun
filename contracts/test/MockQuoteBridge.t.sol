// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockBetaWETH} from "../contracts/mocks/MockBetaWETH.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockQuoteBridge} from "../contracts/mocks/MockQuoteBridge.sol";

contract MockQuoteBridgeTest is TestBase {
    function testRedeemIsInventoryBacked() external {
        MockBetaWETH mockQuote = new MockBetaWETH();
        MockWETH weth = new MockWETH();
        vm.deal(address(this), 2 ether);
        MockQuoteBridge bridge = new MockQuoteBridge{value: 1 ether}(address(mockQuote), address(weth));
        mockQuote.mint(address(this), 2 ether);
        mockQuote.approve(address(bridge), 2 ether);
        assertEq(bridge.redeem(0.5 ether, DEADLINE), 0.5 ether, "wrong output");
        assertEq(weth.balanceOf(address(this)), 0.5 ether, "missing WETH");
        assertEq(mockQuote.balanceOf(address(bridge)), 0.5 ether, "missing mock quote");
        vm.expectRevert();
        bridge.redeem(1 ether, DEADLINE);
        assertEq(mockQuote.balanceOf(address(this)), 1.5 ether, "failed redemption spent input");
        bridge.fund{value: 0.5 ether}();
        assertEq(bridge.redeem(1 ether, DEADLINE), 1 ether, "top-up unavailable");
        vm.expectRevert();
        bridge.redeem(1, 0);
    }
}
