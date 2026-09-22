// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Deploy} from "../scripts/Deploy.s.sol";
import {DeployTestnet} from "../scripts/DeployTestnet.s.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";

interface Env {
    function chainId(uint256 newChainId) external;
    function setEnv(string calldata name, string calldata value) external;
    function expectRevert() external;
    function expectRevert(bytes calldata reason) external;
    function toString(address value) external pure returns (string memory);
}

contract DeployTest {
    Env constant vm = Env(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testDeploymentWiring() external {
        vm.chainId(31_337);
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
        vm.chainId(31_337);
        Deploy script = new Deploy();
        vm.setEnv("EXPECTED_CHAIN_ID", "4153");
        vm.expectRevert(bytes("wrong chain"));
        script.run();
    }

    function testGenericDeploymentCannotBypassTestnetGuard() external {
        Deploy script = new Deploy();
        vm.chainId(11_155_931);
        vm.setEnv("EXPECTED_CHAIN_ID", "11155931");
        vm.expectRevert(bytes("wrong chain"));
        script.run();
    }

    function testTestnetDeploymentRejectsMissingDependencies() external {
        vm.chainId(11_155_931);
        vm.setEnv("CONFIRM_TESTNET", "DEPLOY_CURVEBALL_RISE_TESTNET_11155931");
        vm.setEnv("TREASURY", "0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3");

        DeployTestnet script = new DeployTestnet();
        vm.expectRevert();
        script.run();
    }
}
