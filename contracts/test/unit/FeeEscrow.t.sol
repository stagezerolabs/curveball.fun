// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {CurveBuybackTreasury} from "../../contracts/CurveBuybackTreasury.sol";
import {CurveFeeEscrow} from "../../contracts/CurveFeeEscrow.sol";
import {CurveToken} from "../../contracts/CurveToken.sol";
import {IIcarusPool} from "../../contracts/interfaces/IIcarus.sol";
import {MockIcarusFactory, MockIcarusPool} from "../mocks/MockIcarus.sol";
import {MockLaunchpad} from "../mocks/MockLaunchpad.sol";
import {MockWETH} from "../mocks/MockWETH.sol";

contract FeeEscrowTest is Test {
    uint256 constant SUPPLY = 1_000_000_000 ether;
    uint16 constant CREATOR_SHARE = 5_000;
    uint16 constant BUYBACK_SHARE = 2_000;

    address treasury = makeAddr("treasury");
    address creator = makeAddr("creator");
    address locker = makeAddr("locker");
    address owner = makeAddr("owner");
    address attacker = makeAddr("attacker");

    MockWETH weth = new MockWETH();
    MockIcarusFactory factory = new MockIcarusFactory();
    MockLaunchpad launchpad = new MockLaunchpad(treasury);
    CurveFeeEscrow escrow;
    CurveBuybackTreasury buybackTreasury;
    CurveToken token;
    MockIcarusPool pool;

    function setUp() public {
        address predicted = vm.computeCreateAddress(address(this), vm.getNonce(address(this)) + 1);
        escrow = new CurveFeeEscrow(address(launchpad), address(weth), address(factory), owner, predicted);
        buybackTreasury =
            new CurveBuybackTreasury(address(launchpad), address(escrow), address(weth), address(factory), owner);
        launchpad.setLocker(locker);
        token = launchpad.createToken(SUPPLY);
        launchpad.setFeePolicy(address(token), creator, CREATOR_SHARE, BUYBACK_SHARE);
    }

    // ---------------------------------------------------------------- distribute

    function _distribute(uint256 fee, uint256 tax) internal {
        weth.mint(address(escrow), fee + tax);
        vm.prank(address(launchpad));
        escrow.distribute(address(token), address(weth), fee, tax);
    }

    function testFuzz_distribute_splitsExactly(uint128 fee, uint128 tax, uint16 creatorShare, uint16 buybackShare)
        public
    {
        creatorShare = uint16(bound(creatorShare, 0, 10_000));
        buybackShare = uint16(bound(buybackShare, 0, 10_000 - creatorShare));
        launchpad.setFeePolicy(address(token), creator, creatorShare, buybackShare);
        _distribute(fee, tax);

        uint256 toCreator = escrow.claimable(creator, address(weth));
        uint256 toTreasury = escrow.claimable(treasury, address(weth));
        uint256 toBuyback = buybackTreasury.quoteBudget();
        assertEq(toCreator + toTreasury + toBuyback, uint256(fee) + tax);
        assertEq(toCreator, uint256(fee) * creatorShare / 10_000 + tax);
        assertEq(toBuyback, uint256(fee) * buybackShare / 10_000);
        assertEq(escrow.totalOwed(address(weth)), uint256(fee) + tax - toBuyback);
    }

    function test_distribute_revertsWhenUnbacked() public {
        vm.prank(address(launchpad));
        vm.expectRevert(CurveFeeEscrow.Unbacked.selector);
        escrow.distribute(address(token), address(weth), 1 ether, 0);

        // A balance that already backs earlier credits can't back a new one.
        _distribute(1 ether, 0);
        vm.prank(address(launchpad));
        vm.expectRevert(CurveFeeEscrow.Unbacked.selector);
        escrow.distribute(address(token), address(weth), 1, 0);
    }

    function test_distribute_onlyLaunchpadOrItsLocker() public {
        weth.mint(address(escrow), 2 ether);
        vm.prank(attacker);
        vm.expectRevert(CurveFeeEscrow.Unauthorized.selector);
        escrow.distribute(address(token), address(weth), 1 ether, 0);

        vm.prank(locker);
        escrow.distribute(address(token), address(weth), 1 ether, 0);
        vm.prank(address(launchpad));
        escrow.distribute(address(token), address(weth), 1 ether, 0);
        assertEq(escrow.totalOwed(address(weth)), 1.6 ether);
    }

    function test_distribute_revertsForForeignAsset() public {
        MockWETH other = new MockWETH();
        other.mint(address(escrow), 1 ether);
        vm.prank(address(launchpad));
        vm.expectRevert(CurveFeeEscrow.InvalidAsset.selector);
        escrow.distribute(address(token), address(other), 1 ether, 0);
    }

    function test_distribute_marketTokenFeeShareFundsConversionBudget() public {
        launchpad.unlock(token);
        pool = MockIcarusPool(factory.createPool(address(token), address(weth), false));
        launchpad.setPool(address(token), address(pool));
        launchpad.send(token, address(escrow), 100 ether);
        vm.prank(locker);
        escrow.distribute(address(token), address(token), 100 ether, 0);

        assertEq(token.totalSupply(), SUPPLY);
        assertEq(token.balanceOf(address(escrow)), 80 ether);
        assertEq(escrow.claimable(creator, address(token)), 50 ether);
        assertEq(escrow.claimable(treasury, address(token)), 30 ether);
        assertEq(escrow.totalOwed(address(token)), 80 ether);
        assertEq(buybackTreasury.tokenBudget(address(token)), 20 ether);
    }

    // ---------------------------------------------------------------- claim

    function test_claim_paysOnceThenZero() public {
        _distribute(10 ether, 1 ether);
        vm.prank(creator);
        assertEq(escrow.claim(address(weth)), 6 ether);
        assertEq(weth.balanceOf(creator), 6 ether);
        vm.prank(creator);
        assertEq(escrow.claim(address(weth)), 0);
        assertEq(weth.balanceOf(creator), 6 ether);

        vm.prank(treasury);
        escrow.claim(address(weth));
        assertEq(weth.balanceOf(treasury), 3 ether);
        assertEq(escrow.totalOwed(address(weth)), 0);
        assertEq(buybackTreasury.quoteBudget(), 2 ether);
    }

    // ---------------------------------------------------------------- buyback

    /// @dev Graduates `token` into a pool at 160k tokens / 10 WETH, records `observationWindows` TWAP
    ///      windows, and accrues `buybackFee` of which 20% goes to the buyback balance.
    function _graduate(uint256 observationWindows, uint256 buybackFee) internal {
        launchpad.unlock(token);
        pool = MockIcarusPool(factory.createPool(address(token), address(weth), false));
        launchpad.send(token, address(pool), 160_000 ether);
        weth.mint(address(pool), 10 ether);
        pool.mint(address(this));
        launchpad.setPool(address(token), address(pool));
        // The launchpad records the pool's observation count at graduation; the mock launchpad
        // does not, so mark it here like the real `graduate` flow does.
        vm.prank(address(launchpad));
        escrow.markGraduated(address(token), address(pool));
        vm.prank(owner);
        buybackTreasury.setCurveToken(address(token));
        for (uint256 i = 0; i < observationWindows; i++) {
            vm.warp(block.timestamp + 1801);
            pool.sync();
        }
        _distribute(buybackFee, 0);
    }

    function _frontRun(uint256 wethIn) internal {
        uint256 out = pool.getAmountOut(wethIn, address(weth));
        weth.mint(address(pool), wethIn);
        (uint256 out0, uint256 out1) = pool.token0() == address(token) ? (out, uint256(0)) : (uint256(0), out);
        pool.swap(out0, out1, attacker, "");
    }

    function _ownerBuyback() internal returns (uint256) {
        vm.prank(owner);
        return buybackTreasury.buyback();
    }

    function _expectSkip() internal {
        uint256 balance = buybackTreasury.quoteBudget();
        vm.prank(owner);
        assertEq(buybackTreasury.buyback(), 0);
        assertEq(buybackTreasury.quoteBudget(), balance);
        assertEq(buybackTreasury.lastBuyback(), 0);
    }

    function test_buyback_revertsBeforeGraduation() public {
        _distribute(4 ether, 0);
        vm.expectRevert(CurveBuybackTreasury.NotReady.selector);
        buybackTreasury.buyback();
    }

    function test_buybackBudget_staysAvailableAfterTargetSelection() public {
        _distribute(4 ether, 0);
        assertEq(buybackTreasury.quoteBudget(), 0.8 ether);
        assertEq(buybackTreasury.curveToken(), address(0));
        _graduate(3, 0);
        assertEq(buybackTreasury.quoteBudget(), 0.8 ether);
        assertEq(buybackTreasury.curveToken(), address(token));
    }

    function test_buyback_spendsAChunk_andBurnsTheOutput() public {
        _graduate(3, 0.2 ether);
        uint256 expectedOut = pool.getAmountOut(0.01 ether, address(weth));
        uint256 supplyBefore = token.totalSupply();

        uint256 burned = _ownerBuyback();

        assertEq(burned, expectedOut);
        assertEq(token.totalSupply(), supplyBefore - burned);
        assertEq(token.balanceOf(address(escrow)), 0);
        assertEq(buybackTreasury.quoteBudget(), 0.03 ether);
        assertEq(escrow.totalOwed(address(weth)), 0.16 ether);
        assertEq(weth.balanceOf(address(escrow)), 0.16 ether);
        assertEq(buybackTreasury.lastBuyback(), block.timestamp);
    }

    function test_buyback_capsTheChunkAtMaxPoolImpact() public {
        _graduate(3, 4 ether);
        _ownerBuyback();
        assertEq(buybackTreasury.quoteBudget(), 0.8 ether - 10 ether * 25 / 10_000);
    }

    function test_buyback_spendsADustBalanceWhole() public {
        _graduate(3, 15);
        assertEq(buybackTreasury.quoteBudget(), 3);
        assertGt(_ownerBuyback(), 0);
        assertEq(buybackTreasury.quoteBudget(), 0);
    }

    function test_buyback_worksForEitherPoolOrientation() public {
        bool firstIsToken0 = address(token) < address(weth);
        while ((address(token) < address(weth)) == firstIsToken0) {
            token = launchpad.createToken(SUPPLY);
        }
        launchpad.setFeePolicy(address(token), creator, CREATOR_SHARE, BUYBACK_SHARE);
        _graduate(3, 0.2 ether);
        uint256 expectedOut = pool.getAmountOut(0.01 ether, address(weth));
        assertEq(_ownerBuyback(), expectedOut);
    }

    function test_buyback_keepsWorkingOnAnIdlePoolForOwner() public {
        _graduate(3, 40 ether);
        _ownerBuyback();

        // Nobody else touches the pool: each buyback's own price move must not wedge the next one.
        vm.warp(block.timestamp + 1);
        for (uint256 i = 0; i < 6; i++) {
            uint256 balance = buybackTreasury.quoteBudget();
            assertGt(_ownerBuyback(), 0);
            assertLt(buybackTreasury.quoteBudget(), balance);
            vm.warp(block.timestamp + 1 hours);
        }
    }

    function test_buyback_recoversOnAnIdlePoolAfterAMarketMove() public {
        _graduate(3, 4 ether);
        vm.warp(block.timestamp + 1801);
        // A trader moves spot about 4% and the pool then goes quiet; without a sync the TWAP would
        // stay at the old price forever and every buyback would skip.
        _frontRun(0.2 ether);
        uint256 burned;
        for (uint256 i = 0; i < 2 && burned == 0; i++) {
            vm.warp(block.timestamp + 1 hours);
            burned = _ownerBuyback();
        }
        assertGt(burned, 0);
    }

    function test_buyback_revertsWithNothingToBuy() public {
        _graduate(3, 0);
        vm.prank(owner);
        vm.expectRevert(CurveBuybackTreasury.NothingToSpend.selector);
        buybackTreasury.buyback();
    }

    function test_buyback_skipsWithTooFewObservations() public {
        _graduate(2, 4 ether);
        _expectSkip();
    }

    /// @dev Fail-closed: a pool reachable through the launchpad but never recorded at graduation
    ///      (miswired singleton) must never be priced against, even after observations mature.
    function test_buyback_failsClosedWhenGraduationWasNotMarked() public {
        launchpad.unlock(token);
        pool = MockIcarusPool(factory.createPool(address(token), address(weth), false));
        launchpad.send(token, address(pool), 160_000 ether);
        weth.mint(address(pool), 10 ether);
        pool.mint(address(this));
        launchpad.setPool(address(token), address(pool));
        for (uint256 i = 0; i < 3; i++) {
            vm.warp(block.timestamp + 1801);
            pool.sync();
        }
        assertGt(pool.observationLength(), 3);
        assertEq(buybackTreasury.seedObservations(address(token)), 0, "the mock launchpad does not graduate");

        _distribute(4 ether, 0);
        vm.prank(owner);
        vm.expectRevert(CurveBuybackTreasury.InvalidTarget.selector);
        buybackTreasury.setCurveToken(address(token));
        assertEq(buybackTreasury.quoteBudget(), 0.8 ether);
    }

    function test_buyback_skipsWhenQuoteReverts() public {
        _graduate(3, 4 ether);
        vm.mockCallRevert(address(pool), abi.encodeWithSelector(IIcarusPool.quote.selector), "");
        _expectSkip();
    }

    function test_buyback_skipsWhileIcarusIsPaused() public {
        _graduate(3, 4 ether);
        factory.setPauseState(true);
        _expectSkip();
        assertEq(weth.balanceOf(address(pool)), 10 ether, "no quote left stranded in the pool");

        factory.setPauseState(false);
        assertGt(_ownerBuyback(), 0);
    }

    function test_buyback_toleratesASmallFrontRun() public {
        _graduate(3, 4 ether);
        _frontRun(0.01 ether);
        assertGt(_ownerBuyback(), 0);
    }

    function test_buyback_skipsWhenSandwichedBeyondTheBand() public {
        _graduate(3, 4 ether);
        _frontRun(0.1 ether);
        _expectSkip();
    }

    // ---------------------------------------------------------------- admin

    function test_rescue_cannotTouchLiabilities() public {
        _distribute(4 ether, 0);
        weth.mint(address(escrow), 1 ether);
        vm.startPrank(owner);
        vm.expectRevert(CurveFeeEscrow.ExceedsSurplus.selector);
        escrow.rescue(address(weth), owner, 1 ether + 1);
        escrow.rescue(address(weth), owner, 1 ether);
        vm.stopPrank();
        assertEq(weth.balanceOf(owner), 1 ether);
        assertEq(weth.balanceOf(address(escrow)), escrow.totalOwed(address(weth)));
    }

    function test_rescue_onlyOwner_andOwnershipCannotBeRenounced() public {
        weth.mint(address(escrow), 1 ether);
        vm.prank(attacker);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, attacker));
        escrow.rescue(address(weth), attacker, 1 ether);

        vm.prank(owner);
        vm.expectRevert(CurveFeeEscrow.RenounceDisabled.selector);
        escrow.renounceOwnership();
    }
}
