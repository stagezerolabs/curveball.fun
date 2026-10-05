// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveballLaunchpad} from "../contracts/CurveballLaunchpad.sol";

interface ITokenDeployVm {
    function envAddress(string calldata name) external returns (address);
    function envString(string calldata name) external returns (string memory);
    function startBroadcast() external;
    function stopBroadcast() external;
}

contract CreateNominateBear {
    ITokenDeployVm private constant vm = ITokenDeployVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address private constant RISE_WETH = 0x4200000000000000000000000000000000000006;
    address private constant ICARUS_POOL_FACTORY = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;

    function run() external returns (address token) {
        require(block.chainid == 4153, "not RISE mainnet");
        require(
            keccak256(bytes(vm.envString("CONFIRM_TOKEN"))) == keccak256("CREATE_NOMINATEBEAR_NBR"),
            "token confirmation missing"
        );
        CurveballLaunchpad launchpad = CurveballLaunchpad(payable(vm.envAddress("LAUNCHPAD_ADDRESS")));
        require(address(launchpad).code.length > 0, "missing launchpad code");
        require(
            address(launchpad.quote()) == RISE_WETH && address(launchpad.factory()) == ICARUS_POOL_FACTORY
                && launchpad.supply() == 1_000_000 ether && launchpad.curveSupply() == 800_000 ether
                && launchpad.initialVQ() == 10 ether,
            "unexpected launchpad configuration"
        );

        vm.startBroadcast();
        token =
            launchpad.createToken("NominateBear", "NBR", "https://curveball-fun.netlify.app/api/metadata/nominatebear");
        vm.stopBroadcast();
    }
}
