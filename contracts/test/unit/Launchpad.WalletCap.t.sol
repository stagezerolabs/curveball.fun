// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "../Fixture.sol";
import {CurveMath} from "../../contracts/libraries/CurveMath.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";

contract LaunchpadWalletCapTest is Fixture {
    uint256 private constant CAP = 40_000_000 ether;

    function setUp() public override {
        super.setUp();
        Params memory p = _params();
        p.walletCapBps = 500;
        Deployment memory d = _deployCurve(address(this), p);
        (launchpad, escrow, locker) = (d.launchpad, d.escrow, d.locker);
    }

    function test_launchFirstBuyClampsToFivePercent() public {
        address token = _launch(creator, 100 ether);
        assertEq(launchpad.walletCapBps(), 500);
        assertEq(launchpad.MAX_WALLET_CURVE_TOKENS(), CAP);
        assertEq(launchpad.held(token, creator), CAP);
        assertEq(launchpad.remainingWalletCapacity(token, creator), 0);
        vm.expectRevert(CurveLaunchpad.WalletCapExceeded.selector);
        launchpad.previewBuyFor(token, creator, 1 ether);
    }

    function test_buysAccumulateByWalletAndSellsReopenCapacity() public {
        address token = _launch(creator, 0);
        vm.warp(block.timestamp + 5);
        CurveMath.Buy memory firstQuote = launchpad.previewBuyFor(token, alice, 100 ether);
        assertEq(firstQuote.tokensOut, CAP);
        uint256 bought = _buy(alice, token, 100 ether);
        assertEq(bought, CAP);
        assertEq(launchpad.held(token, alice), CAP);
        vm.expectRevert(CurveLaunchpad.WalletCapExceeded.selector);
        launchpad.previewBuyFor(token, alice, 1 ether);
        _buy(bob, token, 100 ether);
        assertEq(launchpad.held(token, bob), CAP);
        _sell(alice, token, CAP / 2);
        assertEq(launchpad.remainingWalletCapacity(token, alice), CAP / 2);
        assertEq(launchpad.previewBuyFor(token, alice, 100 ether).tokensOut, CAP / 2);
        assertEq(_buy(alice, token, 100 ether), CAP / 2);
        assertEq(launchpad.held(token, alice), CAP);
    }
}
