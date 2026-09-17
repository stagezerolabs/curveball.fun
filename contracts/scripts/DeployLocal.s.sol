// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {LpLocker} from "../contracts/LpLocker.sol";
import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";

interface DeployLocalVm {
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployLocal {
    DeployLocalVm private constant vm = DeployLocalVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function run()
        external
        returns (MockWETH quote, MockIcarusFactory factory, LpLocker locker, CurveballLaunchpad launchpad)
    {
        vm.startBroadcast();
        quote = new MockWETH();
        factory = new MockIcarusFactory();
        locker = new LpLocker(msg.sender, 5_000);
        launchpad = new CurveballLaunchpad(
            address(quote), address(factory), address(locker), 1_000_000 ether, 800_000 ether, 10 ether
        );
        locker.setLaunchpad(address(launchpad));
        vm.stopBroadcast();
    }
}
