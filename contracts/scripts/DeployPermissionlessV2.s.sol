// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";

interface IPermissionlessDeployVm {
    function envAddress(string calldata name) external returns (address);
    function envString(string calldata name) external returns (string memory);
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
}

/// @notice New V2 deployment path. Running `forge script` without `--broadcast` only simulates.
contract DeployPermissionlessV2 {
    IPermissionlessDeployVm private constant vm =
        IPermissionlessDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant TESTNET_CHAIN_ID = 11_155_931;
    uint256 public constant LOCAL_CHAIN_ID = 31_337;
    address public constant TESTNET_TREASURY = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address public constant TESTNET_WETH = 0x4200000000000000000000000000000000000006;
    address public constant TESTNET_ICARUS = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;

    function run() external returns (CurveLaunchFactory factory) {
        address quote;
        address icarus;
        address treasury;
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        if (block.chainid == TESTNET_CHAIN_ID) {
            require(
                keccak256(bytes(vm.envString("CONFIRM_PERMISSIONLESS_V2_TESTNET")))
                    == keccak256("DEPLOY_PERMISSIONLESS_CURVEBALL_V2_RISE_TESTNET_11155931"),
                "replacement confirmation missing"
            );
            require(vm.envAddress("TREASURY") == TESTNET_TREASURY, "unexpected testnet treasury");
            quote = TESTNET_WETH;
            icarus = TESTNET_ICARUS;
            treasury = TESTNET_TREASURY;
            require(
                IERC20Metadata(quote).decimals() == 18
                    && keccak256(bytes(IERC20Metadata(quote).symbol())) == keccak256("WETH")
                    && keccak256(bytes(IERC20Metadata(quote).name())) == keccak256("Wrapped Ether"),
                "unexpected quote token"
            );
        } else {
            require(block.chainid == LOCAL_CHAIN_ID, "unsupported chain");
            quote = vm.envAddress("QUOTE_TOKEN");
            icarus = vm.envAddress("ICARUS_FACTORY");
            treasury = vm.envAddress("TREASURY");
        }
        require(quote.code.length > 0 && icarus.code.length > 0 && treasury != address(0), "missing dependency");
        require(deployer == treasury, "deployer must be treasury");

        vm.startBroadcast(deployer);
        factory = CurveV2Deployment.deploy(quote, icarus, treasury, 1_000_000 ether, 800_000 ether, 10 ether);
        vm.stopBroadcast();
        require(factory.owner() == deployer && factory.treasury() == treasury, "factory authority mismatch");
        require(factory.quote() == quote && factory.icarusFactory() == icarus, "factory dependencies mismatch");
        require(
            address(factory.deployer()).code.length > 0 && address(factory.escrow()).code.length > 0
                && address(factory.vault()).code.length > 0 && address(factory.guard()).code.length > 0
                && address(factory.executor()).code.length > 0 && address(factory.locker()).code.length > 0
                && address(factory.hook()).code.length > 0 && address(factory.launchAndBuy()).code.length > 0,
            "factory services not initialized"
        );
        require(
            factory.deployer().factory() == address(factory) && factory.escrow().factory() == address(factory)
                && factory.vault().factory() == address(factory) && factory.executor().factory() == address(factory)
                && factory.locker().factory() == address(factory) && factory.hook().factory() == address(factory)
                && factory.launchAndBuy().factory() == address(factory),
            "factory service binding mismatch"
        );
        require(factory.publicLaunchOpen(), "factory is not permissionless");
    }
}
