// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockQuoteBridge} from "../contracts/mocks/MockQuoteBridge.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface IBridgeVm {
    function envAddress(string calldata name) external returns (address);
    function envString(string calldata name) external returns (string memory);
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
}

contract DeployAsdBridge {
    IBridgeVm private constant vm = IBridgeVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant TREASURY = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address private constant MOCK_WETH = 0x19556A38028A4018bae295670DAeCB1e74bd9f20;
    address private constant WETH = 0x4200000000000000000000000000000000000006;
    uint256 private constant INVENTORY = 0.02 ether;

    function run() external returns (MockQuoteBridge bridge) {
        require(block.chainid == 11_155_931, "not RISE Testnet");
        require(vm.envAddress("DEPLOYER_ADDRESS") == TREASURY, "wrong deployer");
        require(keccak256(bytes(vm.envString("CONFIRM_ASD_BRIDGE_TESTNET")))
            == keccak256("DEPLOY_ASD_BRIDGE_RISE_TESTNET_11155931"), "confirmation missing");
        require(MOCK_WETH.code.length > 0 && WETH.code.length > 0, "missing assets");

        vm.startBroadcast(TREASURY);
        bridge = new MockQuoteBridge{value: INVENTORY}(MOCK_WETH, WETH);
        vm.stopBroadcast();

        require(IERC20(WETH).balanceOf(address(bridge)) == INVENTORY, "unfunded bridge");
    }
}
