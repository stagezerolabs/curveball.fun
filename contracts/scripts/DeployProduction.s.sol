// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveV1Factory} from "../contracts/CurveV1Factory.sol";
import {CurveV1Deployment} from "../contracts/CurveV1Deployment.sol";

interface IProductionDeployVm {
    function envAddress(string calldata name) external returns (address);
    function envUint(string calldata name) external returns (uint256);
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
}

interface IPausableVenueFactory {
    function isPaused() external view returns (bool);
}

/// @notice Deploys the current Curveball contracts against the verified Icarus venue on RISE mainnet.
contract DeployProduction {
    IProductionDeployVm private constant vm =
        IProductionDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));

    uint256 public constant RISE_MAINNET_CHAIN_ID = 4_153;
    address public constant RISE_WETH = 0x4200000000000000000000000000000000000006;
    address public constant ICARUS_FACTORY = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;

    function run() external returns (CurveV1Factory factory) {
        require(block.chainid == RISE_MAINNET_CHAIN_ID, "RISE mainnet only");
        require(RISE_WETH.code.length > 0 && ICARUS_FACTORY.code.length > 0, "dependency unavailable");
        require(!IPausableVenueFactory(ICARUS_FACTORY).isPaused(), "Icarus paused");

        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        address owner = vm.envAddress("OWNER_ADDRESS");
        address treasury = vm.envAddress("TREASURY_ADDRESS");
        address launchFeeTreasury = vm.envAddress("LAUNCH_FEE_TREASURY");
        uint256 launchFee = vm.envUint("LAUNCH_FEE_WEI");
        uint256 graduationTarget = vm.envUint("GRADUATION_TARGET_WEI");
        require(deployer == owner, "owner must deploy");
        require(treasury != address(0), "treasury required");
        require(
            (launchFee == 0 && launchFeeTreasury == address(0)) || (launchFee > 0 && launchFeeTreasury.code.length > 0),
            "bad launch fee"
        );

        vm.startBroadcast(deployer);
        factory = CurveV1Deployment.deploy(
            CurveV1Deployment.Config({
                quote: RISE_WETH,
                poolFactory: ICARUS_FACTORY,
                owner: owner,
                treasury: treasury,
                launchFeeTreasury: launchFeeTreasury,
                launchFee: launchFee,
                graduationTarget: graduationTarget,
                isMock: false
            })
        );
        vm.stopBroadcast();

        require(factory.owner() == owner && factory.treasury() == treasury, "authority mismatch");
        require(factory.quote() == RISE_WETH && factory.graduationTarget() == graduationTarget, "policy mismatch");
        require(factory.launchFee() == launchFee && factory.launchFeeTreasury() == launchFeeTreasury, "fee mismatch");
        require(address(factory.venue()) != address(0), "venue missing");
    }
}
