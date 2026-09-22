// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ThrowawayERC20} from "../../contracts/test/ThrowawayERC20.sol";
import {CurveballLaunchpad} from "../../contracts/CurveballLaunchpad.sol";
import {LpLocker} from "../../contracts/LpLocker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestBase} from "../TestBase.sol";
import {DeployTestnet} from "../../scripts/DeployTestnet.s.sol";

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

    function testTestnetDeploymentScriptWiresCanonicalContracts() external {
        string memory rpcUrl = vm.envOr("RISE_TESTNET_RPC_URL", "");
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        vm.setEnv("CONFIRM_TESTNET", "DEPLOY_CURVEBALL_RISE_TESTNET_11155931");
        vm.setEnv("TREASURY", vm.toString(DOT));

        (LpLocker locker, CurveballLaunchpad launchpad) = new DeployTestnet().run();

        assertEq(locker.treasury(), DOT, "wrong treasury");
        assertEq(locker.launchpad(), address(launchpad), "wrong launchpad binding");
        assertEq(address(launchpad.quote()), WETH, "wrong quote token");
        assertEq(address(launchpad.factory()), FACTORY, "wrong factory");
        assertEq(launchpad.supply(), 1_000_000 ether, "wrong supply");
        assertEq(launchpad.curveSupply(), 800_000 ether, "wrong curve supply");
        assertEq(launchpad.initialVQ(), 10 ether, "wrong virtual quote");
        assertEq(locker.creatorShareBps(), 5_000, "wrong fee split");
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

    function testLaunchpadGraduatesAndClaimsIcarusFees() external {
        string memory rpcUrl = vm.envOr("RISE_TESTNET_RPC_URL", "");
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);

        LpLocker locker = new LpLocker(address(this), 5_000);
        CurveballLaunchpad launchpad =
            new CurveballLaunchpad(WETH, FACTORY, address(locker), 1_000_000 ether, 800_000 ether, 10 ether);
        locker.setLaunchpad(address(launchpad));
        address token = launchpad.createToken("Fork Token", "FORK", "");

        vm.deal(TRADER, 50 ether);
        vm.prank(TRADER);
        IWETH(WETH).deposit{value: 41 ether}();
        vm.prank(TRADER);
        IWETH(WETH).approve(address(launchpad), 40 ether);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 40 ether, 800_000 ether, DEADLINE);

        (,,,,, bool graduated,, address pool) = launchpad.markets(token);
        assertTrue(graduated && IIcarusFactoryFork(FACTORY).isPool(pool), "market did not graduate on Icarus");
        assertTrue(IERC20(pool).balanceOf(address(locker)) > 0, "locker received no LP");

        uint256 out = IIcarusPoolFork(pool).getAmountOut(1 ether, WETH);
        vm.prank(TRADER);
        IWETH(WETH).transfer(pool, 1 ether);
        vm.prank(TRADER);
        if (IIcarusPoolFork(pool).token0() == WETH) {
            IIcarusPoolFork(pool).swap(0, out, TRADER, "");
        } else {
            IIcarusPoolFork(pool).swap(out, 0, TRADER, "");
        }

        uint256 before = IERC20(WETH).balanceOf(address(this));
        locker.claim(pool);
        assertTrue(IERC20(WETH).balanceOf(address(this)) > before, "fee claim paid no WETH");
    }
}
