// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveV1Factory} from "../contracts/CurveV1Factory.sol";
import {CurveV1Deployment} from "../contracts/CurveV1Deployment.sol";
import {CurveLaunchFeeTreasury} from "../contracts/CurveLaunchFeeTreasury.sol";

interface ITestnetDeployVm {
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
}

interface ITestnetPausableVenueFactory {
    function isPaused() external view returns (bool);
}

/// @notice Deploys the current Curveball release against the live Icarus venue on RISE Testnet.
contract DeployTestnet {
    ITestnetDeployVm private constant vm = ITestnetDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant RISE_TESTNET_CHAIN_ID = 11_155_931;
    address public constant DOT = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address public constant RISE_WETH = 0x4200000000000000000000000000000000000006;
    address public constant ICARUS_FACTORY = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;
    uint256 public constant LAUNCH_FEE = 0.001 ether;
    uint256 public constant GRADUATION_TARGET = 0.005 ether;

    function run() external returns (CurveV1Factory factory) {
        require(block.chainid == RISE_TESTNET_CHAIN_ID, "RISE testnet only");
        require(RISE_WETH.code.length > 0 && ICARUS_FACTORY.code.length > 0, "dependency unavailable");
        require(!ITestnetPausableVenueFactory(ICARUS_FACTORY).isPaused(), "Icarus paused");

        vm.startBroadcast(DOT);
        CurveLaunchFeeTreasury launchFeeTreasury = new CurveLaunchFeeTreasury(DOT);
        factory = CurveV1Deployment.deploy(
            CurveV1Deployment.Config({
                quote: RISE_WETH,
                poolFactory: ICARUS_FACTORY,
                owner: DOT,
                treasury: DOT,
                launchFeeTreasury: address(launchFeeTreasury),
                launchFee: LAUNCH_FEE,
                graduationTarget: GRADUATION_TARGET,
                isMock: false
            })
        );
        vm.stopBroadcast();

        require(factory.owner() == DOT && factory.treasury() == DOT, "authority mismatch");
        require(factory.quote() == RISE_WETH && factory.graduationTarget() == GRADUATION_TARGET, "policy mismatch");
        require(
            factory.launchFee() == LAUNCH_FEE && factory.launchFeeTreasury() == address(launchFeeTreasury),
            "fee mismatch"
        );
        require(launchFeeTreasury.owner() == DOT, "fee treasury owner mismatch");
        require(address(factory.venue()) != address(0), "venue missing");
    }
}
