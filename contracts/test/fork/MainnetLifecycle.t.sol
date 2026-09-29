// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveballLaunchpad} from "../../contracts/CurveballLaunchpad.sol";
import {LpLocker} from "../../contracts/LpLocker.sol";
import {MemeToken} from "../../contracts/MemeToken.sol";
import {PoCBrokenFactory} from "../../contracts/test/PoCIcarus.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TestBase} from "../TestBase.sol";

interface IMainnetFactory {
    function implementation() external view returns (address);
    function isPaused() external view returns (bool);
    function volatileFee() external view returns (uint256);
    function getPool(address a, address b, bool stable) external view returns (address);
    function isPool(address pool) external view returns (bool);
}

interface IMainnetPool {
    function token0() external view returns (address);
    function getAmountOut(uint256 amountIn, address tokenIn) external view returns (uint256);
    function swap(uint256 amount0Out, uint256 amount1Out, address to, bytes calldata data) external;
}

interface IMainnetWeth is IERC20 {
    function deposit() external payable;
}

contract MainnetLifecycleTest is TestBase {
    address private constant FACTORY = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;
    address private constant IMPLEMENTATION = 0xA24Bdf8ee26658c822796a30770F23c2425de966;
    address private constant WETH = 0x4200000000000000000000000000000000000006;
    address private constant TRADER = address(0xA11CE);
    address private constant CREATOR = address(0xCAFE);
    address private constant TREASURY = address(0xB0B);

    function _fork() private returns (bool) {
        string memory rpc = vm.envOr("RISE_RPC_URL", "");
        if (bytes(rpc).length == 0) return false;
        vm.createSelectFork(rpc);
        return true;
    }

    function testLiveDependenciesMatchPinnedCodeAndTradingState() external {
        if (!_fork()) return;
        assertEq(IMainnetFactory(FACTORY).implementation(), IMPLEMENTATION, "implementation changed");
        assertTrue(!IMainnetFactory(FACTORY).isPaused(), "factory paused");
        assertEq(IMainnetFactory(FACTORY).volatileFee(), 30, "volatile fee changed");
        assertTrue(
            FACTORY.codehash == 0x6c1342d984ac76dfe9ec5b20d4657e68390078c6747ccc0b6bbaafbe1379e628,
            "factory code changed"
        );
        assertTrue(
            IMPLEMENTATION.codehash == 0x86d3cb4be9f4f211f6df84b9cc262297750aaa84dcd26fa034e80010aad5055e,
            "pool code changed"
        );
        assertTrue(
            WETH.codehash == 0xe354d52f6267708b1b69faf84795aaf6abfa01e623ca8f912023399888e58fdb, "WETH code changed"
        );
    }

    function testCurveGraduatesSwapsLocksLpAndPaysFees() external {
        if (!_fork()) return;
        LpLocker locker = new LpLocker(TREASURY, 5_000);
        CurveballLaunchpad launchpad =
            new CurveballLaunchpad(WETH, FACTORY, address(locker), 1_000_000 ether, 800_000 ether, 10 ether);
        locker.setLaunchpad(address(launchpad));
        launchpad.setInvited(CREATOR, true);
        launchpad.setInvited(TRADER, true);
        vm.prank(CREATOR);
        address token = launchpad.createToken("Curveball", "CURVE", "ipfs://test");
        vm.deal(TRADER, 50 ether);
        vm.prank(TRADER);
        IMainnetWeth(WETH).deposit{value: 41 ether}();
        vm.prank(TRADER);
        IMainnetWeth(WETH).approve(address(launchpad), 40 ether);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 40 ether, 800_000 ether, DEADLINE);
        (,,, uint128 realQ,, bool graduated,, address pool) = launchpad.markets(token);
        assertTrue(graduated && IMainnetFactory(FACTORY).isPool(pool), "market not graduated");
        assertEq(realQ, 0, "market quote remains");
        assertEq(launchpad.totalReservedQuote(), 0, "reserve remains");
        assertTrue(IERC20(pool).balanceOf(address(locker)) > 0, "LP not locked");
        vm.expectRevert();
        locker.rescueTokens(pool, 1);
        uint256 out = IMainnetPool(pool).getAmountOut(1 ether, WETH);
        vm.prank(TRADER);
        IMainnetWeth(WETH).transfer(pool, 1 ether);
        vm.prank(TRADER);
        if (IMainnetPool(pool).token0() == WETH) IMainnetPool(pool).swap(0, out, TRADER, "");
        else IMainnetPool(pool).swap(out, 0, TRADER, "");
        uint256 beforeCreator = IMainnetWeth(WETH).balanceOf(CREATOR);
        uint256 beforeTreasury = IMainnetWeth(WETH).balanceOf(TREASURY);
        locker.claim(pool);
        assertTrue(IMainnetWeth(WETH).balanceOf(CREATOR) > beforeCreator, "creator fee missing");
        assertTrue(IMainnetWeth(WETH).balanceOf(TREASURY) > beforeTreasury, "treasury fee missing");
    }

    function testGraduationFailureKeepsSellingAvailable() external {
        if (!_fork()) return;
        LpLocker locker = new LpLocker(TREASURY, 5_000);
        CurveballLaunchpad launchpad = new CurveballLaunchpad(
            WETH, address(new PoCBrokenFactory()), address(locker), 1_000_000 ether, 800_000 ether, 10 ether
        );
        locker.setLaunchpad(address(launchpad));
        launchpad.setInvited(TRADER, true);
        vm.prank(TRADER);
        address token = launchpad.createToken("Curveball", "CURVE", "");
        vm.deal(TRADER, 50 ether);
        vm.prank(TRADER);
        IMainnetWeth(WETH).deposit{value: 40 ether}();
        vm.prank(TRADER);
        IMainnetWeth(WETH).approve(address(launchpad), 40 ether);
        vm.prank(TRADER);
        launchpad.buyTokens(token, 40 ether, 800_000 ether, DEADLINE);
        (,,, uint128 reserve, uint128 sold,, bool pending,) = launchpad.markets(token);
        assertTrue(pending, "graduation did not defer");
        vm.prank(TRADER);
        MemeToken(token).approve(address(launchpad), sold);
        uint256 before = IMainnetWeth(WETH).balanceOf(TRADER);
        vm.prank(TRADER);
        launchpad.sellTokens(token, sold, 0, DEADLINE);
        assertEq(IMainnetWeth(WETH).balanceOf(TRADER) - before, reserve, "holder could not exit");
    }
}
