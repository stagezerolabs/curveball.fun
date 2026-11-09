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
///      checking the pinned EOA roles before its timelock is created. Same skip and CI_FORK=1 rules.
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
        assertEq(d.launchpad.graduationTarget(), 4 ether);
        assertEq(d.launchpad.launchFee(), 0.00045 ether);
        assertEq(d.escrow.launchpad(), address(d.launchpad));
        assertEq(d.locker.launchpad(), address(d.launchpad));
    }

    function test_preflight_allowsPausedFactoryBecauseOnlySwapsAreBlocked() public {
        ITestnetFactoryPause factory = ITestnetFactoryPause(TESTNET_ICARUS);
        vm.prank(factory.pauser());
        factory.setPauseState(true);
        script.preflight(script.params());
    }
}

contract DeployMainnetForkTest is DeployFork {
    address constant MAINNET_DEPLOYER = 0xeEb364Ba1a9A4B6a75C41A39c4B91144a4aF156A;
    address constant MAINNET_TREASURY = 0x7e6B1bEfC7dd622c20961140779eF61cd9C62Ce4;

    function setUp() public {
        _fork("RISE_MAINNET_RPC_URL", 4_153);
    }

    function test_preflight_pinsMainnetRolesAndTarget() public {
        CurveDeploy.Params memory p = script.params();
        assertEq(p.guardian, MAINNET_DEPLOYER);
        assertEq(p.treasury, MAINNET_TREASURY);
        assertEq(p.graduationTarget, 4 ether);
        assertEq(p.owner, address(0), "the owner timelock is created during deployment");
        script.preflight(p);

        p.guardian = makeAddr("wrong guardian");
        vm.expectRevert(abi.encodeWithSelector(Deploy.Preflight.selector, "unexpected mainnet guardian"));
        script.preflight(p);
    }

    function test_preflight_rejectsAnotherTreasury() public {
        CurveDeploy.Params memory p = script.params();
        p.treasury = makeAddr("wrong treasury");
        vm.expectRevert(abi.encodeWithSelector(Deploy.Preflight.selector, "unexpected mainnet treasury"));
        script.preflight(p);
    }
}
