// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveFactoryFeeController} from "../contracts/CurveFactoryFeeController.sol";

contract FactoryFeeControllerTest is TestBase {
    address private constant DOT = address(0xD07);
    address private constant FEE_ADMIN = address(0x5CC);
    address private constant STRANGER = address(0xBAD);

    function testFeeAdminCanChangeOnlyTradingFeeAfterDotHandsOff() external {
        (CurveLaunchFactory factory, CurveFactoryFeeController controller) = _setup();

        vm.prank(FEE_ADMIN);
        vm.expectRevert();
        controller.setTradingFeeBps(80);

        factory.transferOwnership(address(controller));
        vm.prank(STRANGER);
        vm.expectRevert();
        controller.acceptFactoryOwnership();
        vm.prank(DOT);
        controller.acceptFactoryOwnership();
        assertEq(factory.owner(), address(controller), "controller did not own factory");
        assertEq(controller.owner(), DOT, "dot lost super admin authority");
        vm.prank(DOT);
        vm.expectRevert();
        controller.renounceOwnership();

        vm.prank(FEE_ADMIN);
        controller.setTradingFeeBps(80);
        assertEq(factory.feeBps(), 80, "fee was not updated");
        assertEq(factory.creatorShareBps(), 5_000, "creator share changed");
        assertEq(factory.buybackShareBps(), 2_500, "buyback share changed");
        assertEq(factory.creatorTaxCapBps(), 50, "tax cap changed");
        assertEq(factory.treasury(), address(this), "treasury changed");

        vm.prank(FEE_ADMIN);
        vm.expectRevert();
        controller.executeFactory(abi.encodeCall(factory.setFeeDefaults, (90, 0, 0, 0, STRANGER)));
        vm.prank(FEE_ADMIN);
        vm.expectRevert();
        controller.setFeeAdmin(STRANGER);
        vm.prank(STRANGER);
        vm.expectRevert();
        controller.setTradingFeeBps(90);
    }

    function testDotCanManageFactoryAndRevokeFeeAdmin() external {
        (CurveLaunchFactory factory, CurveFactoryFeeController controller) = _setup();
        factory.transferOwnership(address(controller));
        vm.prank(DOT);
        controller.acceptFactoryOwnership();

        vm.prank(DOT);
        controller.executeFactory(abi.encodeCall(factory.setFeeDefaults, (100, 4_000, 3_000, 50, STRANGER)));
        assertEq(factory.feeBps(), 100, "dot cannot set factory defaults");
        assertEq(factory.treasury(), STRANGER, "dot cannot manage treasury");

        vm.prank(DOT);
        controller.setFeeAdmin(STRANGER);
        assertEq(controller.feeAdmin(), STRANGER, "fee admin was not rotated");
        vm.prank(FEE_ADMIN);
        vm.expectRevert();
        controller.setTradingFeeBps(75);
        vm.prank(STRANGER);
        controller.setTradingFeeBps(75);
        assertEq(factory.feeBps(), 75, "new fee admin cannot edit");

        vm.prank(DOT);
        controller.transferFactoryOwnership(DOT);
        assertEq(factory.pendingOwner(), DOT, "dot is not pending owner");
        vm.prank(DOT);
        factory.acceptOwnership();
        vm.prank(STRANGER);
        vm.expectRevert();
        controller.setTradingFeeBps(80);
    }

    function _setup() private returns (CurveLaunchFactory factory, CurveFactoryFeeController controller) {
        factory = new CurveLaunchFactory(address(0xA), address(0xB), address(this), address(0), 0, 1_000, 800, 10);
        controller = new CurveFactoryFeeController(address(factory), DOT, FEE_ADMIN);
    }
}
