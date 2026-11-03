// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CurveDeploy} from "../../scripts/CurveDeploy.sol";
import {Deploy} from "../../scripts/Deploy.s.sol";

interface ITestnetFactoryPause {
    function pauser() external view returns (address);
    function setPauseState(bool paused) external;
}

/// @dev `Deploy.s.sol` against live RISE state: the testnet run end to end, and the mainnet preflight
///      rejecting an owner that isn't a timelock. Same skip and CI_FORK=1 rules as the lifecycle forks.
abstract contract DeployFork is Test {
    Deploy script;

    function _fork(string memory rpcVar, uint256 chainId) internal {
        string memory rpc = vm.envOr(rpcVar, string(""));
        if (bytes(rpc).length == 0) {
            require(vm.envOr("CI_FORK", uint256(0)) != 1, string.concat(rpcVar, " is required when CI_FORK=1"));
            vm.skip(true);
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, chainId, "RPC points at the wrong chain");
        script = new Deploy();
    }
}

contract DeployTestnetForkTest is DeployFork {
    address constant TESTNET_OPERATOR = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address constant TESTNET_ICARUS = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;

    function setUp() public {
        _fork("RISE_TESTNET_RPC_URL", 11_155_931);
    }

    function test_deploy_wiresTheTestnetRelease() public {
        // Broadcasts from forge's default sender, so the nonce prediction runs against a live account.
        CurveDeploy.Deployment memory d = script.run();

        assertEq(d.launchpad.owner(), TESTNET_OPERATOR);
        assertEq(d.launchpad.guardian(), TESTNET_OPERATOR);
        assertEq(d.launchpad.treasury(), TESTNET_OPERATOR);
        assertEq(d.escrow.owner(), TESTNET_OPERATOR);
        assertEq(d.launchpad.graduationTarget(), 0.01 ether);
        assertEq(d.launchpad.launchFee(), 0.001 ether);
        assertEq(d.escrow.launchpad(), address(d.launchpad));
        assertEq(d.locker.launchpad(), address(d.launchpad));
        assertEq(address(d.reserve.launchpad()), address(d.launchpad));
    }

    function test_preflight_allowsPausedFactoryBecauseOnlySwapsAreBlocked() public {
        ITestnetFactoryPause factory = ITestnetFactoryPause(TESTNET_ICARUS);
        vm.prank(factory.pauser());
        factory.setPauseState(true);
        script.preflight(script.params());
    }
}

contract DeployMainnetForkTest is DeployFork {
    function setUp() public {
        _fork("RISE_MAINNET_RPC_URL", 4_153);
    }

    function test_preflight_rejectsAnOwnerThatIsNotATimelock() public {
        vm.setEnv("CURVE_OWNER", vm.toString(makeAddr("eoa owner")));
        vm.setEnv("CURVE_GUARDIAN", vm.toString(makeAddr("guardian")));
        vm.setEnv("CURVE_TREASURY", vm.toString(makeAddr("treasury")));
        vm.setEnv("CURVE_GRADUATION_TARGET", "1000000000000000000");
        CurveDeploy.Params memory p = script.params();
        vm.expectRevert(abi.encodeWithSelector(Deploy.Preflight.selector, "owner is not a contract"));
        script.preflight(p);
    }
}
