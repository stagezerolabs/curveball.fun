// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveFactoryFeeController} from "../contracts/CurveFactoryFeeController.sol";

interface IV21ControllerVm {
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
}

contract DeployV21FeeController {
    IV21ControllerVm private constant vm = IV21ControllerVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant DOT = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address private constant FEE_ADMIN = 0x5CC42e772F67089b4670eec4dcD904be2F2D511c;
    address private constant FACTORY = 0x6c12CCE962944EbB6A28536eD23baeFAa15c79cD;

    function run() external returns (CurveFactoryFeeController controller) {
        require(block.chainid == 11_155_931, "wrong chain");
        CurveLaunchFactory factory = CurveLaunchFactory(FACTORY);
        require(factory.owner() == DOT && factory.pendingOwner() == address(0), "factory authority changed");
        require(address(factory.holderReserve()) == 0x06791a55D94B7EA697C00E2B33bA2F16A9160999, "wrong release");
        vm.startBroadcast(DOT);
        controller = new CurveFactoryFeeController(FACTORY, DOT, FEE_ADMIN);
        factory.transferOwnership(address(controller));
        controller.acceptFactoryOwnership();
        vm.stopBroadcast();
        require(factory.owner() == address(controller) && controller.owner() == DOT && controller.feeAdmin() == FEE_ADMIN, "handoff failed");
    }
}
