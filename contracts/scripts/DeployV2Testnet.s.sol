// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";

interface IDeployV2Vm {
    function envAddress(string calldata name) external returns (address);
    function envString(string calldata name) external returns (string memory);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployV2Testnet {
    IDeployV2Vm private constant vm = IDeployV2Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 public constant CHAIN_ID = 11_155_931;
    address public constant TREASURY = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address public constant WETH = 0x4200000000000000000000000000000000000006;
    address public constant ICARUS = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;

    function run() external returns (CurveLaunchFactory factory) {
        require(block.chainid == CHAIN_ID, "not RISE testnet");
        require(keccak256(bytes(vm.envString("CONFIRM_V2_TESTNET"))) == keccak256("DEPLOY_CURVEBALL_V2_RISE_TESTNET_11155931"), "V2 confirmation missing");
        require(vm.envAddress("TREASURY") == TREASURY, "treasury must be dot");
        require(WETH.code.length > 0 && ICARUS.code.length > 0, "missing dependency");
        require(IERC20Metadata(WETH).decimals() == 18, "unexpected quote decimals");
        require(keccak256(bytes(IERC20Metadata(WETH).symbol())) == keccak256("WETH"), "unexpected quote symbol");
        require(keccak256(bytes(IERC20Metadata(WETH).name())) == keccak256("Wrapped Ether"), "unexpected quote name");

        vm.startBroadcast();
        factory = CurveV2Deployment.deploy(WETH, ICARUS, TREASURY, 1_000_000 ether, 800_000 ether, 10 ether);
        vm.stopBroadcast();
    }
}
