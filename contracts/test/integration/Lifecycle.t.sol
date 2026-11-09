// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Fixture} from "../Fixture.sol";
import {CurveBuybackTreasury} from "../../contracts/CurveBuybackTreasury.sol";
import {CurveFeeEscrow} from "../../contracts/CurveFeeEscrow.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";
import {MockIcarusPool} from "../mocks/MockIcarus.sol";

/// @dev One market from launch to its last claim, asserting where every wei went at each step.
contract LifecycleTest is Fixture {
    uint256 constant S = 1_000_000_000 ether;
    uint256 constant C = 800_000_000 ether;

    address carol = makeAddr("carol");
    address token;
    MockIcarusPool pool;
    uint256 creatorTokens;
    uint256 aliceTokens;
    uint256 bobTokens;

    /// @dev Every WETH ever minted is held by an actor or a contract this test knows about. Pool fees sit in the pool's fee holders.
    function _assertWethConserved() internal view {
        uint256 accounted = weth.balanceOf(creator) + weth.balanceOf(alice) + weth.balanceOf(bob)
            + weth.balanceOf(carol) + weth.balanceOf(treasury) + weth.balanceOf(address(launchpad))
            + weth.balanceOf(address(escrow)) + weth.balanceOf(address(locker))
            + weth.balanceOf(address(escrow.buybackTreasury()));
        if (address(pool) != address(0)) {
            accounted += weth.balanceOf(address(pool)) + weth.balanceOf(pool.poolFees())
            + weth.balanceOf(pool.gaugeFees());
        }
        assertEq(accounted, weth.totalSupply(), "WETH conserved");
    }

    /// @dev Escrow claims and the treasury's buyback budget are backed separately.
    function _assertEscrowBacked() internal view {
        assertGe(weth.balanceOf(address(escrow)), escrow.totalOwed(address(weth)));
        assertGe(weth.balanceOf(address(escrow.buybackTreasury())), escrow.buybackTreasury().quoteBudget());
        assertGe(IERC20(token).balanceOf(address(escrow)), escrow.totalOwed(token));
    }

    function _swap(address who, address tokenIn, uint256 amountIn) internal returns (uint256 out) {
        out = pool.getAmountOut(amountIn, tokenIn);
        vm.prank(who);
        IERC20(tokenIn).transfer(address(pool), amountIn);
        bool outIsToken0 = pool.token0() != tokenIn;
        pool.swap(outIsToken0 ? out : 0, outIsToken0 ? 0 : out, who, "");
    }

    function test_lifecycle_launchToLastClaim() public {
        _launchWithFirstBuy();
        _tradeBothWays();
        _sellOutTheCurve();
        _graduate();
        _tradeInThePool();
        _claimLpFees();
        _claimFees();
        _buybackAndBurn();
    }

    function _launchWithFirstBuy() internal {
        _fund(creator, LAUNCH_FEE + 0.2 ether);
        vm.prank(creator);
        (token, creatorTokens) = launchpad.launch(_meta(), 50, 0.2 ether, 0);

        assertGt(weth.balanceOf(treasury), LAUNCH_FEE, "opening buy tax goes to treasury");
        vm.warp(block.timestamp + 5);
        assertEq(IERC20(token).totalSupply(), S);
        assertEq(IERC20(token).balanceOf(creator), creatorTokens);
        assertEq(launchpad.held(token, creator), creatorTokens);
        assertEq(IERC20(token).balanceOf(address(launchpad)), S - creatorTokens);
        _assertWethConserved();
        _assertEscrowBacked();
    }

    function _tradeBothWays() internal {
        aliceTokens = _buy(alice, token, 1.5 ether);
        bobTokens = _buy(bob, token, 0.7 ether);
        uint256 wethBefore = weth.balanceOf(alice);
        uint256 proceeds = _sell(alice, token, aliceTokens / 4);
        aliceTokens -= aliceTokens / 4;

        assertEq(weth.balanceOf(alice), wethBefore + proceeds);
        assertEq(IERC20(token).balanceOf(alice), aliceTokens);
        assertEq(launchpad.held(token, alice), aliceTokens);
        assertEq(weth.balanceOf(address(launchpad)), launchpad.totalRealQuote());
        _assertWethConserved();
        _assertEscrowBacked();
    }

    function _sellOutTheCurve() internal {
        bobTokens += _buy(bob, token, 100 ether);

        CurveLaunchpad.Market memory m = launchpad.market(token);
        assertEq(uint8(m.state), uint8(CurveLaunchpad.State.Ready));
        assertEq(S - m.virtualToken, C);
        assertEq(creatorTokens + aliceTokens + bobTokens, C, "every curve token has a holder");
        assertEq(launchpad.held(token, bob), bobTokens);
        assertGe(m.realQuote, TARGET);
        assertEq(weth.balanceOf(address(launchpad)), m.realQuote);
        _assertWethConserved();
    }

    function _graduate() internal {
        uint256 realQuote = launchpad.market(token).realQuote;
        pool = MockIcarusPool(launchpad.graduate(token));
        CurveBuybackTreasury buybacks = escrow.buybackTreasury();
        vm.prank(owner);
        buybacks.setCurveToken(token);

        (uint256 poolTokens, uint256 poolQuote) = _reserves();
        assertEq(poolQuote, realQuote);
        assertEq(launchpad.totalRealQuote(), 0);
        assertEq(weth.balanceOf(address(launchpad)), 0);
        assertEq(IERC20(token).balanceOf(address(launchpad)), 0);
        assertEq(IERC20(token).totalSupply(), C + poolTokens, "the rest is burned");
        assertEq(pool.balanceOf(address(locker)) + pool.balanceOf(address(1)), pool.totalSupply());
        _assertWethConserved();
    }

    function _tradeInThePool() internal {
        _fund(carol, 5 ether);
        // Each swap lands in a new 30-minute window, so the TWAP has observations by the buyback.
        for (uint256 i = 0; i < 4; i++) {
            vm.warp(block.timestamp + 1801);
            _swap(carol, address(weth), 0.5 ether);
            vm.warp(block.timestamp + 1801);
            _swap(carol, token, IERC20(token).balanceOf(carol) / 3);
        }
        vm.prank(alice);
        IERC20(token).transfer(carol, 1 ether);
        assertEq(launchpad.held(token, alice), aliceTokens, "post-graduation transfers leave the ledger frozen");
        _assertWethConserved();
    }

    function _claimLpFees() internal {
        uint256 supplyBefore = IERC20(token).totalSupply();
        uint256 wethOwedBefore = escrow.totalOwed(address(weth));
        (uint256 tokenFees, uint256 quoteFees) = locker.claim(address(pool));

        assertGt(tokenFees, 0);
        assertGt(quoteFees, 0);
        uint256 burned = supplyBefore - IERC20(token).totalSupply();
        assertEq(burned, 0, "LP fee shares do not burn market tokens directly");
        assertEq(escrow.buybackTreasury().tokenBudget(token), tokenFees * 2_500 / 10_000);
        assertEq(escrow.totalOwed(token), tokenFees - tokenFees * 2_500 / 10_000);
        assertEq(escrow.totalOwed(address(weth)), wethOwedBefore + quoteFees - quoteFees * 2_500 / 10_000);
        assertEq(weth.balanceOf(address(locker)), 0);
        assertEq(IERC20(token).balanceOf(address(locker)), 0);
        _assertEscrowBacked();
        _assertWethConserved();
    }

    function _claimFees() internal {
        uint256 creatorOwed = escrow.claimable(creator, address(weth));
        uint256 treasuryOwed = escrow.claimable(treasury, address(weth));
        uint256 creatorTokenFees = escrow.claimable(creator, token);
        uint256 creatorWethBefore = weth.balanceOf(creator);
        uint256 treasuryWethBefore = weth.balanceOf(treasury);
        assertGt(creatorOwed, 0);
        assertGt(creatorTokenFees, 0);

        vm.startPrank(creator);
        assertEq(escrow.claim(address(weth)), creatorOwed);
        escrow.claim(token);
        vm.stopPrank();
        vm.startPrank(treasury);
        assertEq(escrow.claim(address(weth)), treasuryOwed);
        escrow.claim(token);
        vm.stopPrank();

        assertEq(weth.balanceOf(creator), creatorWethBefore + creatorOwed);
        assertEq(weth.balanceOf(treasury), treasuryWethBefore + treasuryOwed);
        assertEq(IERC20(token).balanceOf(creator), creatorTokens + creatorTokenFees);
        assertEq(escrow.totalOwed(address(weth)), 0);
        assertEq(escrow.totalOwed(token), 0);
        assertEq(weth.balanceOf(address(escrow)), 0);
        _assertWethConserved();
    }

    function _buybackAndBurn() internal {
        CurveBuybackTreasury buybacks = escrow.buybackTreasury();
        for (uint256 i = 0; i < 3; i++) {
            uint256 balance = buybacks.quoteBudget();
            uint256 supplyBefore = IERC20(token).totalSupply();
            vm.prank(owner);
            uint256 burned = buybacks.buyback();
            assertGt(burned, 0);
            assertLt(buybacks.quoteBudget(), balance);
            assertEq(supplyBefore - IERC20(token).totalSupply(), burned);
            vm.warp(block.timestamp + 1 hours);
        }
        assertEq(weth.balanceOf(address(escrow)), 0);
        assertEq(IERC20(token).balanceOf(address(escrow)), 0, "every bought token is burned");
        _assertWethConserved();
    }

    function _reserves() internal view returns (uint256 tokens, uint256 quote) {
        (uint256 r0, uint256 r1,) = pool.getReserves();
        (tokens, quote) = pool.token0() == token ? (r0, r1) : (r1, r0);
    }
}
