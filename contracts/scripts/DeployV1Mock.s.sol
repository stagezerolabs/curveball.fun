// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveV1Factory} from "../contracts/CurveV1Factory.sol";
import {CurveV1Deployment} from "../contracts/CurveV1Deployment.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";

interface IV1DeployVm {
    function envAddress(string calldata name) external returns (address);
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
}

/// @notice Initial mock-venue release on RISE testnet, signed by the local dot keystore.
contract DeployV1Mock {
    IV1DeployVm private constant vm = IV1DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address public constant DOT = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address public constant TESTNET_WETH = 0x4200000000000000000000000000000000000006;

    function run() external returns (CurveV1Factory factory, MockIcarusFactory mockVenue) {
        require(block.chainid == 11_155_931, "RISE testnet only");
        require(vm.envAddress("DEPLOYER_ADDRESS") == DOT, "dot wallet required");
        require(TESTNET_WETH.code.length > 0, "WETH unavailable");
        vm.startBroadcast(DOT);
        mockVenue = new MockIcarusFactory();
        factory = CurveV1Deployment.deploy(TESTNET_WETH, address(mockVenue), DOT, address(0), 0);
        vm.stopBroadcast();
        require(factory.owner() == DOT && factory.graduationTarget() == 0.005 ether, "deployment mismatch");
        require(factory.initialVQ() == 0.00125 ether && address(factory.venue()) != address(0), "curve mismatch");
    }
}
