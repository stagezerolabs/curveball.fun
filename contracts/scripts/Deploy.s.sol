// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LpLocker} from "../contracts/LpLocker.sol";
import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";

interface DeployVm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract Deploy {
    DeployVm constant vm = DeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run() external returns (LpLocker locker, CurveballLaunchpad launchpad) {
        require(
            block.chainid == vm.envUint("EXPECTED_CHAIN_ID") && block.chainid != 4153 && block.chainid != 11_155_931,
            "wrong chain"
        );
        address quote = vm.envAddress("QUOTE_TOKEN");
        address factory = vm.envAddress("ICARUS_FACTORY");
        address treasury = vm.envAddress("TREASURY");
        require(quote.code.length != 0 && factory.code.length != 0 && treasury != address(0), "bad deployment input");

        vm.startBroadcast();
        locker = new LpLocker(treasury, 5_000);
        launchpad = new CurveballLaunchpad(quote, factory, address(locker), 1_000_000 ether, 800_000 ether, 10 ether);
        locker.setLaunchpad(address(launchpad));
        vm.stopBroadcast();
    }
}
