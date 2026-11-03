// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveIcarusSwapAdapter} from "../../contracts/CurveIcarusSwapAdapter.sol";
import {IIcarusFactory, IIcarusPool} from "../../contracts/interfaces/IIcarus.sol";
import {Fixture} from "../Fixture.sol";

contract IcarusSwapAdapterTest is Fixture {
    CurveIcarusSwapAdapter adapter;
    address token;
    IIcarusPool pool;

    function setUp() public override {
        super.setUp();
        adapter = new CurveIcarusSwapAdapter(address(launchpad), address(weth), address(icarus));
        token = _launch(creator, 0, 0);
        _sellOut(alice, token);
        pool = IIcarusPool(launchpad.graduate(token));
    }

    function test_buyQuotesAndSwapsThroughTheRecordedPool() public {
        uint256 amountIn = 0.01 ether;
        weth.mint(bob, amountIn);
        vm.startPrank(bob);
        weth.approve(address(adapter), amountIn);
        uint256 quoted = pool.getAmountOut(amountIn, address(weth));
        assertEq(adapter.quoteExactIn(token, true, amountIn), quoted);

        uint256 beforeTokens = IERC20(token).balanceOf(bob);
        uint256 out = adapter.swapExactIn(token, true, amountIn, quoted, block.timestamp);
        vm.stopPrank();

        assertEq(out, quoted);
        assertEq(IERC20(token).balanceOf(bob) - beforeTokens, quoted);
        assertEq(weth.balanceOf(bob), 0);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(IERC20(token).balanceOf(address(adapter)), 0);
    }

    function test_sellQuotesAndPaysWethToTheTrader() public {
        uint256 amountIn = 1000 ether;
        vm.startPrank(alice);
        IERC20(token).approve(address(adapter), amountIn);
        uint256 quoted = pool.getAmountOut(amountIn, token);
        assertEq(adapter.quoteExactIn(token, false, amountIn), quoted);

        uint256 beforeWeth = weth.balanceOf(alice);
        uint256 out = adapter.swapExactIn(token, false, amountIn, quoted, block.timestamp);
        vm.stopPrank();

        assertEq(out, quoted);
        assertEq(weth.balanceOf(alice) - beforeWeth, quoted);
        assertEq(weth.balanceOf(address(adapter)), 0);
        assertEq(IERC20(token).balanceOf(address(adapter)), 0);
    }

    function test_rejectsChangedPriceBeforePullingInput() public {
        uint256 amountIn = 0.01 ether;
        weth.mint(bob, amountIn);
        vm.startPrank(bob);
        weth.approve(address(adapter), amountIn);
        uint256 quoted = adapter.quoteExactIn(token, true, amountIn);
        uint256 poolBefore = weth.balanceOf(address(pool));
        vm.expectRevert(CurveIcarusSwapAdapter.Slippage.selector);
        adapter.swapExactIn(token, true, amountIn, quoted + 1, block.timestamp);
        vm.stopPrank();

        assertEq(weth.balanceOf(bob), amountIn);
        assertEq(weth.balanceOf(address(pool)), poolBefore);
    }

    function test_rejectsExpiredAndZeroTrades() public {
        vm.warp(1000);
        vm.expectRevert(CurveIcarusSwapAdapter.Expired.selector);
        adapter.swapExactIn(token, true, 1, 1, block.timestamp - 1);
        vm.expectRevert(CurveIcarusSwapAdapter.InvalidTrade.selector);
        adapter.swapExactIn(token, true, 0, 1, block.timestamp);
        vm.expectRevert(CurveIcarusSwapAdapter.InvalidTrade.selector);
        adapter.swapExactIn(token, true, 1, 0, block.timestamp);
    }

    function test_rejectsPausedFactoryBeforePullingInput() public {
        weth.mint(bob, 0.01 ether);
        vm.prank(bob);
        weth.approve(address(adapter), type(uint256).max);
        icarus.setPauseState(true);

        vm.expectRevert(CurveIcarusSwapAdapter.PoolPaused.selector);
        vm.prank(bob);
        adapter.swapExactIn(token, true, 0.01 ether, 1, block.timestamp);
        assertEq(weth.balanceOf(bob), 0.01 ether);
    }

    function test_rejectsUngraduatedAndUnregisteredPools() public {
        address pending = _launch(creator, 0, 0);
        vm.expectRevert(CurveIcarusSwapAdapter.PoolUnavailable.selector);
        adapter.quoteExactIn(pending, true, 0.01 ether);

        vm.mockCall(
            address(icarus),
            abi.encodeWithSelector(IIcarusFactory.getPool.selector, token, address(weth), false),
            abi.encode(address(0))
        );
        vm.expectRevert(CurveIcarusSwapAdapter.PoolUnavailable.selector);
        adapter.quoteExactIn(token, true, 0.01 ether);
    }

    function test_rejectsPoolWithWrongTokenPair() public {
        vm.mockCall(address(pool), abi.encodeWithSelector(IIcarusPool.token0.selector), abi.encode(address(1)));
        vm.expectRevert(CurveIcarusSwapAdapter.PoolMismatch.selector);
        adapter.quoteExactIn(token, true, 0.01 ether);
    }

    function test_poolSwapRevertRollsBackInputTransfer() public {
        uint256 amountIn = 0.01 ether;
        weth.mint(bob, amountIn);
        vm.prank(bob);
        weth.approve(address(adapter), amountIn);
        uint256 bobBefore = weth.balanceOf(bob);
        uint256 poolBefore = weth.balanceOf(address(pool));
        vm.mockCallRevert(
            address(pool),
            abi.encodeWithSelector(IIcarusPool.swap.selector),
            abi.encodeWithSignature("Error(string)", "forced")
        );

        vm.expectRevert();
        vm.prank(bob);
        adapter.swapExactIn(token, true, amountIn, 1, block.timestamp);
        assertEq(weth.balanceOf(bob), bobBefore);
        assertEq(weth.balanceOf(address(pool)), poolBefore);
    }
}
