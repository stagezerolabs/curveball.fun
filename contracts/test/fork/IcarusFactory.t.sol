// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ThrowawayERC20} from "../../contracts/test/ThrowawayERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestBase} from "../TestBase.sol";
import {CurveLaunchFactory} from "../../historical/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../../historical/CurveV2Deployment.sol";
import {CurveBondingCurve} from "../../contracts/CurveBondingCurve.sol";

interface IIcarusFactoryFork {
    function createPool(address tokenA, address tokenB, bool stable) external returns (address);
    function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
    function isPool(address pool) external view returns (bool);
}

interface IIcarusPoolFork {
    function token0() external view returns (address);
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IWETH {
    function deposit() external payable;
    function approve(address spender, uint256 amount) external returns (bool);
    function transfer(address to, uint256 amount) external returns (bool);
}

contract IcarusFactoryForkTest is TestBase {
    address private constant FACTORY = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;
    address private constant WETH = 0x4200000000000000000000000000000000000006;
    address private constant TRADER = address(0xA11CE);
    address private constant DOT = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;

    function testV2LaunchTradeGraduateSwapAndClaim() external {
        string memory rpcUrl = vm.envOr("RISE_TESTNET_RPC_URL", "");
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        CurveLaunchFactory v2 = CurveV2Deployment.deploy(WETH, FACTORY, DOT, 1_000_000 ether, 800_000 ether, 10 ether);
        (address token, address curveAddress) = v2.createToken("V2 Fork", "V2F", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        vm.deal(TRADER, 50 ether);
        vm.prank(TRADER);
        IWETH(WETH).deposit{value: 42 ether}();
        vm.prank(TRADER);
        IWETH(WETH).approve(curveAddress, 42 ether);
        vm.prank(TRADER);
        curve.buyTokens(42 ether, 800_000 ether, DEADLINE);
        v2.graduate(token);
        address pool = v2.createGraduatedPool(token);
        assertTrue(curve.graduated() && IERC20(pool).balanceOf(address(v2.locker())) > 0, "V2 pool not locked");
        uint256 out = IIcarusPoolFork(pool).getAmountOut(1 ether, WETH);
        vm.prank(TRADER);
        IWETH(WETH).transfer(pool, 1 ether);
        vm.prank(TRADER);
        if (IIcarusPoolFork(pool).token0() == WETH) IIcarusPoolFork(pool).swap(0, out, TRADER, "");
        else IIcarusPoolFork(pool).swap(out, 0, TRADER, "");
        v2.locker().claim(pool);
        assertTrue(v2.escrow().claimable(token, WETH, address(this)) > 0, "V2 creator fees missing");
        vm.warp(block.timestamp + 31 minutes);
        vm.deal(TRADER, 2 ether);
        vm.prank(TRADER);
        IWETH(WETH).deposit{value: 1 ether}();
        uint256 secondOut = IIcarusPoolFork(pool).getAmountOut(0.1 ether, WETH);
        vm.prank(TRADER);
        IWETH(WETH).transfer(pool, 0.1 ether);
        vm.prank(TRADER);
        if (IIcarusPoolFork(pool).token0() == WETH) IIcarusPoolFork(pool).swap(0, secondOut, TRADER, "");
        else IIcarusPoolFork(pool).swap(secondOut, 0, TRADER, "");
        uint256 swept = v2.vault().sweepPool(token, v2.vault().quoteBalance(token), 1, DEADLINE);
        assertTrue(swept > 0 && v2.vault().memeBalance(token) >= swept, "pool sweep did not vest tokens");
    }

    function testCreateVolatilePoolWithThrowawayTokens() external {
        string memory rpcUrl = vm.envOr("RISE_TESTNET_RPC_URL", "");
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        ThrowawayERC20 tokenA = new ThrowawayERC20("Throwaway A", "TA");
        ThrowawayERC20 tokenB = new ThrowawayERC20("Throwaway B", "TB");
        IIcarusFactoryFork factory = IIcarusFactoryFork(FACTORY);
        factory.createPool(address(tokenA), address(tokenB), false);
        address pool = factory.getPool(address(tokenA), address(tokenB), false);
        assertTrue(factory.isPool(pool), "factory did not register pool");
    }
}
