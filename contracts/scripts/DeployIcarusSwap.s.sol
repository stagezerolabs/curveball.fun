// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {CurveIcarusSwapAdapter} from "../contracts/CurveIcarusSwapAdapter.sol";
import {CurveLaunchpad} from "../contracts/CurveLaunchpad.sol";

/// @notice Deploys the permissionless swap adapter for a recorded Curveball launchpad.
/// @dev Reads the deployment record and checks canonical RISE contracts before broadcasting.
contract DeployIcarusSwap is Script {
    uint256 internal constant MAINNET = 4_153;
    uint256 internal constant TESTNET = 11_155_931;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant MAINNET_ICARUS = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;
    address internal constant TESTNET_ICARUS = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;

    error UnsupportedChain(uint256 chainId);
    error Preflight(string check);

    function run() external returns (CurveIcarusSwapAdapter adapter) {
        string memory recordPath;
        address expectedFactory;
        if (block.chainid == TESTNET) {
            recordPath = string.concat(vm.projectRoot(), "/../deployments/11155931/curveball.json");
            expectedFactory = TESTNET_ICARUS;
        } else if (block.chainid == MAINNET) {
            recordPath = string.concat(vm.projectRoot(), "/../deployments/4153/curveball.json");
            expectedFactory = MAINNET_ICARUS;
        } else {
            revert UnsupportedChain(block.chainid);
        }

        address launchpadAddress = vm.parseJsonAddress(vm.readFile(recordPath), ".launchpad");
        if (launchpadAddress.code.length == 0) revert Preflight("launchpad has no code");
        CurveLaunchpad launchpad = CurveLaunchpad(launchpadAddress);
        address quoteToken = launchpad.quoteToken();
        address factory = launchpad.icarusFactory();
        if (quoteToken != WETH || WETH.code.length == 0) revert Preflight("unexpected WETH");
        if (factory != expectedFactory || factory.code.length == 0) revert Preflight("unexpected Icarus factory");

        vm.startBroadcast();
        adapter = new CurveIcarusSwapAdapter(launchpadAddress, quoteToken, factory);
        vm.stopBroadcast();
    }
}
