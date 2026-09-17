// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Deploy} from "../scripts/Deploy.s.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";

interface Env {
    function setEnv(string calldata name, string calldata value) external;
    function expectRevert() external;
    function toString(address value) external pure returns (string memory);
}

contract DeployTest {
    Env constant vm = Env(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testDeploymentWiring() external {
        MockWETH quote = new MockWETH();
        MockIcarusFactory factory = new MockIcarusFactory();
        vm.setEnv("EXPECTED_CHAIN_ID", "31337");
        vm.setEnv("QUOTE_TOKEN", vm.toString(address(quote)));
        vm.setEnv("ICARUS_FACTORY", vm.toString(address(factory)));
        vm.setEnv("TREASURY", vm.toString(address(this)));
        (LpLocker locker, CurveballLaunchpad launchpad) = new Deploy().run();
        require(locker.launchpad() == address(launchpad));
        require(locker.treasury() == address(this));
        require(launchpad.quote() == quote);
        require(address(launchpad.factory()) == address(factory));
        require(launchpad.supply() == 1_000_000 ether);
        require(launchpad.curveSupply() == 800_000 ether);
    }

    function testWrongChainFailsBeforeDeployment() external {
        Deploy script = new Deploy();
        vm.setEnv("EXPECTED_CHAIN_ID", "4153");
        vm.expectRevert();
        script.run();
    }
}
