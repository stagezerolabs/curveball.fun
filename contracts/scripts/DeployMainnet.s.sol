// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {LpLocker} from "../contracts/LpLocker.sol";
import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";

interface IMainnetDeployVm {
    function envAddress(string calldata name) external returns (address);
    function envString(string calldata name) external returns (string memory);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract DeployMainnet {
    IMainnetDeployVm private constant vm = IMainnetDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant RISE_CHAIN_ID = 4153;
    address public constant RISE_WETH = 0x4200000000000000000000000000000000000006;
    address public constant ICARUS_POOL_FACTORY = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;
    address public constant ICARUS_POOL_IMPLEMENTATION = 0xA24Bdf8ee26658c822796a30770F23c2425de966;
    bytes32 public constant FACTORY_CODE_HASH = 0x6c1342d984ac76dfe9ec5b20d4657e68390078c6747ccc0b6bbaafbe1379e628;
    bytes32 public constant POOL_CODE_HASH = 0x86d3cb4be9f4f211f6df84b9cc262297750aaa84dcd26fa034e80010aad5055e;
    bytes32 public constant WETH_CODE_HASH = 0xe354d52f6267708b1b69faf84795aaf6abfa01e623ca8f912023399888e58fdb;
    uint256 public constant TOKEN_SUPPLY = 1_000_000 ether;
    uint256 public constant CURVE_SUPPLY = 800_000 ether;
    uint256 public constant INITIAL_VIRTUAL_QUOTE = 10 ether;
    uint16 public constant CREATOR_SHARE_BPS = 5_000;

    function run() external returns (LpLocker locker, CurveballLaunchpad launchpad) {
        require(block.chainid == RISE_CHAIN_ID, "not RISE mainnet");
        require(
            keccak256(bytes(vm.envString("CONFIRM_MAINNET"))) == keccak256("DEPLOY_CURVEBALL_RISE_4153"),
            "mainnet confirmation missing"
        );
        address treasury = vm.envAddress("MULTISIG");
        require(treasury != address(0) && treasury.code.length > 0, "multisig required");
        require(RISE_WETH.code.length > 0 && ICARUS_POOL_FACTORY.code.length > 0, "missing dependency code");
        require(ICARUS_POOL_FACTORY.codehash == FACTORY_CODE_HASH, "factory code changed");
        require(ICARUS_POOL_IMPLEMENTATION.codehash == POOL_CODE_HASH, "pool code changed");
        require(RISE_WETH.codehash == WETH_CODE_HASH, "WETH code changed");
        require(
            IMainnetFactoryState(ICARUS_POOL_FACTORY).implementation() == ICARUS_POOL_IMPLEMENTATION,
            "implementation changed"
        );
        require(!IMainnetFactoryState(ICARUS_POOL_FACTORY).isPaused(), "factory paused");
        require(IMainnetFactoryState(ICARUS_POOL_FACTORY).volatileFee() == 30, "volatile fee changed");
        require(
            IERC20Metadata(RISE_WETH).decimals() == 18
                && keccak256(bytes(IERC20Metadata(RISE_WETH).symbol())) == keccak256("WETH")
                && keccak256(bytes(IERC20Metadata(RISE_WETH).name())) == keccak256("Wrapped Ether"),
            "unexpected quote token"
        );

        vm.startBroadcast();
        locker = new LpLocker(treasury, CREATOR_SHARE_BPS);
        launchpad = new CurveballLaunchpad(
            RISE_WETH, ICARUS_POOL_FACTORY, address(locker), TOKEN_SUPPLY, CURVE_SUPPLY, INITIAL_VIRTUAL_QUOTE
        );
        locker.setLaunchpad(address(launchpad));
        vm.stopBroadcast();
    }
}

interface IMainnetFactoryState {
    function implementation() external view returns (address);
    function isPaused() external view returns (bool);
    function volatileFee() external view returns (uint256);
}
