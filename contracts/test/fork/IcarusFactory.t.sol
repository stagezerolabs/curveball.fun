// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveV1Factory} from "../../contracts/CurveV1Factory.sol";
import {CurveV1Deployment} from "../../contracts/CurveV1Deployment.sol";
import {CurveBondingCurve} from "../../contracts/CurveBondingCurve.sol";
import {IIcarusFactory, IIcarusPool} from "../../contracts/interfaces/IIcarus.sol";
import {TestBase} from "../TestBase.sol";

interface IWETH is IERC20 {
    function deposit() external payable;
}

contract IcarusFactoryForkTest is TestBase {
    address private constant MAINNET_FACTORY = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;
    address private constant TESTNET_FACTORY = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;
    address private constant WETH = 0x4200000000000000000000000000000000000006;

    function testProductionLifecycleOnMainnetFork() external {
        string memory rpcUrl = vm.envOr("RISE_MAINNET_RPC_URL", "");
        if (bytes(rpcUrl).length == 0) return;
        _runLifecycle(rpcUrl, MAINNET_FACTORY);
    }

    function testCurrentLifecycleOnRiseTestnetFork() external {
        string memory rpcUrl = vm.envOr("RISE_TESTNET_RPC_URL", "");
        if (bytes(rpcUrl).length == 0) return;
        _runLifecycle(rpcUrl, TESTNET_FACTORY);
    }

    function _runLifecycle(string memory rpcUrl, address venueFactory) private {
        vm.createSelectFork(rpcUrl);

        CurveV1Factory factory = CurveV1Deployment.deploy(
            CurveV1Deployment.Config({
                quote: WETH,
                poolFactory: venueFactory,
                owner: address(this),
                treasury: address(this),
                launchFeeTreasury: address(0),
                launchFee: 0,
                graduationTarget: 0.005 ether,
                isMock: false
            })
        );
        (address token, address curveAddress) = factory.createToken("Fork launch", "FORK", "", 0);
        vm.deal(address(this), 0.01 ether);
        IWETH(WETH).deposit{value: 0.006 ether}();
        IERC20(WETH).approve(curveAddress, 0.006 ether);
        CurveBondingCurve(curveAddress).buyTokens(0.006 ether, factory.curveSupply(), DEADLINE);
        factory.graduate(token);
        address pool = factory.createGraduatedPool(token);

        assertTrue(IIcarusFactory(venueFactory).isPool(pool), "factory did not register pool");
        assertTrue(IIcarusPool(pool).poolFees() != address(0), "pool fees missing");
        assertTrue(IIcarusPool(pool).gaugeFees() != address(0), "gauge fees missing");
        assertEq(factory.holderReserve().feeEscrow(), address(factory.escrow()), "reserve escrow mismatch");
    }
}
