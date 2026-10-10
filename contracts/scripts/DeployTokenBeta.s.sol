// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {MockBetaUSDC} from "../contracts/mocks/MockBetaUSDC.sol";
import {MockBetaWETH} from "../contracts/mocks/MockBetaWETH.sol";
import {FixedRateVenue} from "../contracts/mocks/FixedRateVenue.sol";
import {CurveTokenBuyAdapter} from "../contracts/CurveTokenBuyAdapter.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";

interface ITokenBetaVm {
    function envAddress(string calldata name) external returns (address);
    function envString(string calldata name) external returns (string memory);
    function startBroadcast(address sender) external;
    function stopBroadcast() external;
}

/// @notice Isolated mock-asset beta. A call without --broadcast is simulation only.
contract DeployTokenBeta {
    ITokenBetaVm private constant vm = ITokenBetaVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant TESTNET = 11_155_931;
    address private constant TESTNET_TREASURY = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address private constant TESTNET_ICARUS = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;

    function run() external returns (CurveLaunchFactory factory, MockBetaUSDC usdc, MockBetaWETH quote,
        FixedRateVenue venue, CurveTokenBuyAdapter adapter)
    {
        require(block.chainid == TESTNET, "not RISE testnet");
        require(keccak256(bytes(vm.envString("CONFIRM_TOKEN_BETA_TESTNET")))
            == keccak256("DEPLOY_TOKEN_BETA_RISE_TESTNET_11155931"), "confirmation missing");
        address deployer = vm.envAddress("DEPLOYER_ADDRESS");
        require(deployer == TESTNET_TREASURY && vm.envAddress("TREASURY") == TESTNET_TREASURY, "wrong authority");
        require(TESTNET_ICARUS.code.length > 0, "Icarus missing");

        vm.startBroadcast(deployer);
        usdc = new MockBetaUSDC();
        quote = new MockBetaWETH();
        venue = new FixedRateVenue(address(usdc), address(quote));
        quote.mint(address(venue), 1_000 ether);
        factory = CurveV2Deployment.deploy(address(quote), TESTNET_ICARUS, deployer,
            1_000_000 ether, 800_000 ether, 10 ether);
        adapter = new CurveTokenBuyAdapter(address(factory), address(usdc), address(quote), address(venue));
        factory.setTokenBuyAdapter(address(adapter));
        vm.stopBroadcast();

        require(factory.quote() == address(quote) && factory.tokenBuyAdapter() == address(adapter)
            && factory.tokenBuyEnabled(), "beta binding failed");
        require(quote.balanceOf(address(venue)) == 1_000 ether, "venue not funded");
    }
}
