// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployPermissionlessV2} from "../scripts/DeployPermissionlessV2.s.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";

interface IPermissionlessTestVm {
    function chainId(uint256 newChainId) external;
    function setEnv(string calldata name, string calldata value) external;
    function expectRevert(bytes calldata reason) external;
    function toString(address value) external pure returns (string memory);
}

contract PermissionlessDeploymentTest {
    IPermissionlessTestVm private constant vm =
        IPermissionlessTestVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    function testLocalDeploymentStartsPermissionless() external {
        vm.chainId(31_337);
        MockWETH quote = new MockWETH();
        MockIcarusFactory icarus = new MockIcarusFactory();
        vm.setEnv("QUOTE_TOKEN", vm.toString(address(quote)));
        vm.setEnv("ICARUS_FACTORY", vm.toString(address(icarus)));
        vm.setEnv("TREASURY", vm.toString(address(this)));
        vm.setEnv("DEPLOYER_ADDRESS", vm.toString(address(this)));

        CurveLaunchFactory factory = new DeployPermissionlessV2().run();
        require(factory.publicLaunchOpen(), "launch is gated");
        require(address(factory.quote()) == address(quote), "wrong quote");
        require(factory.icarusFactory() == address(icarus), "wrong pool factory");
        require(factory.treasury() == address(this), "wrong treasury");
        require(factory.supply() == 1_000_000 ether, "wrong supply");
        require(factory.curveSupply() == 800_000 ether, "wrong curve supply");
        require(factory.initialVQ() == 10 ether, "wrong virtual quote");
        require(factory.owner() == address(this), "wrong owner");
        require(address(factory.deployer()).code.length > 0, "deployer not initialized");
        require(address(factory.launchAndBuy()).code.length > 0, "launch wrapper not initialized");
    }

    function testLocalDeploymentRejectsDifferentDeployer() external {
        vm.chainId(31_337);
        MockWETH quote = new MockWETH();
        MockIcarusFactory icarus = new MockIcarusFactory();
        vm.setEnv("QUOTE_TOKEN", vm.toString(address(quote)));
        vm.setEnv("ICARUS_FACTORY", vm.toString(address(icarus)));
        vm.setEnv("TREASURY", vm.toString(address(this)));
        vm.setEnv("DEPLOYER_ADDRESS", "0x000000000000000000000000000000000000bEEF");
        DeployPermissionlessV2 script = new DeployPermissionlessV2();
        vm.expectRevert(bytes("deployer must be treasury"));
        script.run();
        vm.setEnv("DEPLOYER_ADDRESS", vm.toString(address(this)));
    }

    function testUnsupportedChainReverts() external {
        vm.chainId(4_153);
        DeployPermissionlessV2 script = new DeployPermissionlessV2();
        vm.expectRevert(bytes("unsupported chain"));
        script.run();
    }
}
