// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveFeeEscrow} from "../../contracts/CurveFeeEscrow.sol";
import {CurveHolderReserve} from "../../contracts/CurveHolderReserve.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";
import {CurveLpLocker} from "../../contracts/CurveLpLocker.sol";
import {MockIcarusFactory, MockIcarusPool} from "../mocks/MockIcarus.sol";
import {MockWETH} from "../mocks/MockWETH.sol";

/// @dev Drives the whole system through every action a user, keeper, donor or admin can take.
///      Rules the state machine promises (who may trade, what pause may block) are checked here,
///      on each call, and recorded as violations; monotonic quantities are checked after each call.
contract Handler is Test {
    enum Action {
        Launch,
        Buy,
        Sell,
        DonateWeth,
        DonatePool,
        DonateToken,
        Warp,
        Graduate,
        Abort,
        Swap,
        LpClaim,
        FeeClaim,
        Buyback,
        ReserveClaim,
        Pause
    }

    uint256 public constant ACTIONS = uint256(type(Action).max) + 1;
    uint256 internal constant S = 1_000_000 ether;
    uint256 internal constant C = 800_000 ether;
    uint256 internal constant MAX_MARKETS = 4;

    CurveLaunchpad public immutable launchpad;
    CurveFeeEscrow public immutable escrow;
    CurveLpLocker public immutable locker;
    CurveHolderReserve public immutable reserve;
    MockWETH public immutable weth;
    MockIcarusFactory public immutable icarus;
    address public immutable owner;
    address public immutable guardian;
    address public immutable treasury;

    address[] public actors;
    address[] public tokens;

    /// @notice How often each action did its work instead of returning early.
    mapping(Action => uint256) public reached;
    uint256 public calls;
    uint256 public violations;
    string public lastViolation;

    mapping(address token => uint256) public lastSupply;
    mapping(address pool => uint256) public lastLockerLp;
    mapping(address token => uint256) public reserveClaimed;
    /// @notice Tokens holders sent the launchpad after graduation, which it keeps for `rescue`.
    mapping(address token => uint256) public donatedAfterGraduation;

    modifier step() {
        calls++;
        _;
        _checkMonotonic();
    }

    constructor(
        CurveLaunchpad launchpad_,
        CurveFeeEscrow escrow_,
        CurveLpLocker locker_,
        CurveHolderReserve reserve_,
        MockWETH weth_,
        MockIcarusFactory icarus_,
        address owner_,
        address guardian_
    ) {
        (launchpad, escrow, locker, reserve, weth, icarus) = (launchpad_, escrow_, locker_, reserve_, weth_, icarus_);
        (owner, guardian, treasury) = (owner_, guardian_, launchpad_.treasury());
        actors.push(makeAddr("actor0"));
        actors.push(makeAddr("actor1"));
        actors.push(makeAddr("actor2"));
        actors.push(makeAddr("actor3"));
        // Two markets from the start, so trading actions have something to act on in every run.
        launch(0, 0, 400, 0.1 ether);
        launch(1, 50, 0, 0);
    }

    // ---------------------------------------------------------------- curve

    function launch(uint256 actorSeed, uint16 taxBps, uint16 reserveBps, uint256 firstBuy) public step {
        if (tokens.length >= MAX_MARKETS) return;
        address actor = _actor(actorSeed);
        taxBps = uint16(bound(taxBps, 0, 50));
        reserveBps = uint16(bound(reserveBps, 0, 400));
        firstBuy = firstBuy % 3 == 0 ? 0 : bound(firstBuy, 0.001 ether, 2 ether);
        _fund(actor, launchpad.launchFee() + firstBuy);
        CurveLaunchpad.Metadata memory meta = CurveLaunchpad.Metadata("Invariant", "INV", "ipfs://inv");

        bool paused = launchpad.paused();
        vm.prank(actor);
        try launchpad.launch(meta, taxBps, reserveBps, firstBuy, 0) returns (address token, uint256) {
            if (paused) _violate("launch while paused");
            tokens.push(token);
            lastSupply[token] = S;
            reached[Action.Launch]++;
        } catch {
            if (!paused) _violate("launch reverted");
        }
    }

    function buy(uint256 actorSeed, uint256 marketSeed, uint256 spend) external step {
        address actor = _actor(actorSeed);
        address token = _token(marketSeed);
        spend = bound(spend, 0.0001 ether, 3 ether);
        _fund(actor, spend);
        CurveLaunchpad.State state = launchpad.market(token).state;
        bool mustRevert = launchpad.paused() || state == CurveLaunchpad.State.Ready
            || state == CurveLaunchpad.State.Graduated || _soldOut(token);

        vm.prank(actor);
        try launchpad.buy(token, spend, 0, block.timestamp) {
            if (mustRevert) _violate("buy while paused, sold out or graduated");
            reached[Action.Buy]++;
        } catch {}
    }

    function sell(uint256 actorSeed, uint256 marketSeed, uint256 bps) external step {
        address token = _token(marketSeed);
        (address actor, uint256 sellable) = _seller(actorSeed, token);
        uint256 amount = sellable * bound(bps, 1, 10_000) / 10_000;
        if (amount == 0) return;

        CurveLaunchpad.Market memory m = launchpad.market(token);
        bool expired = block.timestamp >= uint256(m.readyAt) + launchpad.GRADUATION_TIMEOUT();
        bool mustRevert =
            m.state == CurveLaunchpad.State.Graduated || (m.state == CurveLaunchpad.State.Ready && !expired);
        // Pause never matters here: whenever the curve can quote it, an open sell must go through.
        bool mustSucceed = !mustRevert && _quotable(token, amount);

        vm.startPrank(actor);
        IERC20(token).approve(address(launchpad), amount);
        try launchpad.sell(token, amount, 0, block.timestamp) {
            if (mustRevert) _violate("sell on a graduated or unexpired ready market");
            reached[Action.Sell]++;
        } catch {
            if (mustSucceed) _violate("open sell reverted");
        }
        vm.stopPrank();
    }

    // ---------------------------------------------------------------- donations

    function donateWeth(uint256 amount) external step {
        weth.mint(address(launchpad), bound(amount, 1, 5 ether));
        reached[Action.DonateWeth]++;
    }

    /// @dev Pre-creating and funding the graduation pool, optionally synced: the griefing route.
    function donatePool(uint256 marketSeed, uint256 amount, bool sync) external step {
        address token = _token(marketSeed);
        address pool = icarus.getPool(token, address(weth), false);
        if (pool == address(0)) pool = icarus.createPool(token, address(weth), false);
        weth.mint(pool, bound(amount, 1, 2 ether));
        if (sync) MockIcarusPool(pool).sync();
        reached[Action.DonatePool]++;
    }

    /// @dev A holder sending curve tokens to the launchpad, the only place they can go before graduation.
    function donateToken(uint256 actorSeed, uint256 marketSeed, uint256 bps) external step {
        address token = _token(marketSeed);
        address actor = _holder(actorSeed, token);
        uint256 amount = IERC20(token).balanceOf(actor) * bound(bps, 1, 2_000) / 10_000;
        if (amount == 0) return;
        vm.prank(actor);
        IERC20(token).transfer(address(launchpad), amount);
        if (launchpad.poolOf(token) != address(0)) donatedAfterGraduation[token] += amount;
        reached[Action.DonateToken]++;
    }

    // ---------------------------------------------------------------- time, graduation and abort

    function warp(uint256 seconds_) external step {
        vm.warp(block.timestamp + bound(seconds_, 1, 8 days));
        reached[Action.Warp]++;
    }

    /// @dev Sells the market out first when it can, so graduation is exercised in most runs.
    function graduate(uint256 actorSeed, uint256 marketSeed) external step {
        address token = _token(marketSeed);
        CurveLaunchpad.State state = launchpad.market(token).state;
        if (state == CurveLaunchpad.State.Trading || state == CurveLaunchpad.State.Aborted) {
            if (!_soldOut(token) && !launchpad.paused()) _sellOut(_actor(actorSeed), token);
            state = launchpad.market(token).state;
        }
        bool mustSucceed =
            state == CurveLaunchpad.State.Ready || (state == CurveLaunchpad.State.Aborted && _soldOut(token));

        try launchpad.graduate(token) returns (address pool) {
            if (!mustSucceed) _violate("graduated an unready market");
            lastLockerLp[pool] = MockIcarusPool(pool).balanceOf(address(locker));
            reached[Action.Graduate]++;
        } catch {
            if (mustSucceed) _violate("ready market failed to graduate");
        }
    }

    /// @dev Sells out and waits out the timeout first when it can, so aborts are exercised in most runs.
    function abort(uint256 actorSeed, uint256 marketSeed) external step {
        address token = _token(marketSeed);
        CurveLaunchpad.Market memory m = launchpad.market(token);
        if (m.state == CurveLaunchpad.State.Trading && !launchpad.paused()) {
            _sellOut(_actor(actorSeed), token);
            m = launchpad.market(token);
        }
        if (m.state == CurveLaunchpad.State.Ready) {
            uint256 deadline = uint256(m.readyAt) + launchpad.GRADUATION_TIMEOUT();
            if (block.timestamp < deadline) vm.warp(deadline);
        }
        bool mustSucceed = m.state == CurveLaunchpad.State.Ready;

        try launchpad.abortGraduation(token) {
            if (!mustSucceed) _violate("aborted a market that was not ready");
            reached[Action.Abort]++;
        } catch {
            if (mustSucceed) _violate("expired ready market failed to abort");
        }
    }

    // ---------------------------------------------------------------- after graduation

    function swap(uint256 actorSeed, uint256 marketSeed, bool buyToken, uint256 amount) external step {
        (address token, MockIcarusPool pool) = _graduated(marketSeed);
        if (address(pool) == address(0)) return;
        address actor = _holder(actorSeed, token);
        // Holders sell into the pool; when nobody holds any, someone buys.
        buyToken = buyToken || IERC20(token).balanceOf(actor) == 0;
        address tokenIn = buyToken ? address(weth) : token;
        if (buyToken) {
            amount = bound(amount, 0.0001 ether, 1 ether);
            weth.mint(actor, amount);
        } else {
            amount = IERC20(token).balanceOf(actor) * bound(amount, 1, 5_000) / 10_000;
        }
        if (amount == 0) return;
        uint256 out = pool.getAmountOut(amount, tokenIn);
        if (out == 0) return;

        vm.prank(actor);
        IERC20(tokenIn).transfer(address(pool), amount);
        bool outIsToken0 = pool.token0() != tokenIn;
        try pool.swap(outIsToken0 ? out : 0, outIsToken0 ? 0 : out, actor, "") {
            reached[Action.Swap]++;
        } catch {
            // Only Icarus's pause stops a correctly quoted swap; the input stays in the pool as a donation.
            if (!icarus.isPaused()) _violate("pool swap reverted");
        }
    }

    function lpClaim(uint256 marketSeed) external step {
        (, MockIcarusPool pool) = _graduated(marketSeed);
        if (address(pool) == address(0)) return;
        try locker.claim(address(pool)) {
            reached[Action.LpClaim]++;
        } catch {
            _violate("locker claim reverted");
        }
    }

    function feeClaim(uint256 accountSeed, uint256 marketSeed, bool quote) external step {
        address asset = quote ? address(weth) : _token(marketSeed);
        address account = _account(accountSeed);
        for (uint256 i = 1; i <= actors.length && escrow.claimable(account, asset) == 0; i++) {
            account = _account(accountSeed % (actors.length + 1) + i);
        }
        uint256 owed = escrow.claimable(account, asset);
        uint256 balanceBefore = IERC20(asset).balanceOf(account);
        vm.prank(account);
        try escrow.claim(asset) returns (uint256 paid) {
            if (paid != owed || IERC20(asset).balanceOf(account) != balanceBefore + owed) _violate("claim paid wrong");
            if (owed != 0) reached[Action.FeeClaim]++;
        } catch {
            _violate("fee claim reverted");
        }
    }

    function buyback(uint256 marketSeed) external step {
        (address token,) = _graduated(marketSeed);
        if (token == address(0)) return;
        uint256 last = escrow.lastBuyback(token);
        bool due =
            escrow.buybackBalance(token) != 0 && (last == 0 || block.timestamp >= last + escrow.BUYBACK_INTERVAL());
        try escrow.buyback(token) returns (uint256 burned) {
            if (!due) _violate("buyback ran early or with nothing to buy");
            if (burned != 0) reached[Action.Buyback]++;
        } catch {
            if (due) _violate("due buyback reverted instead of skipping");
        }
    }

    function reserveClaim(uint256 actorSeed, uint256 marketSeed) external step {
        address token = _token(marketSeed);
        address actor = _actor(actorSeed);
        for (uint256 i = 0; i < actors.length && reserve.claimable(token, actor) == 0; i++) {
            actor = _actor(actorSeed % actors.length + i + 1);
        }
        uint256 claimable = reserve.claimable(token, actor);
        vm.prank(actor);
        try reserve.claim(token) returns (uint256 amount) {
            if (amount != claimable) _violate("reserve paid other than claimable");
            reserveClaimed[token] += amount;
            reached[Action.ReserveClaim]++;
        } catch {
            if (claimable != 0) _violate("claimable reserve reverted");
        }
    }

    // ---------------------------------------------------------------- admin

    /// @dev 0 pauses the launchpad, 1 unpauses it, 2 toggles the Icarus factory pause.
    function pause(uint256 choice) external step {
        choice %= 3;
        if (choice == 0) {
            vm.prank(guardian);
            launchpad.pause();
        } else if (choice == 1) {
            vm.prank(owner);
            launchpad.unpause();
        } else {
            icarus.setPauseState(!icarus.isPaused());
        }
        reached[Action.Pause]++;
    }

    // ---------------------------------------------------------------- views for the invariants

    function tokenCount() external view returns (uint256) {
        return tokens.length;
    }

    function actorCount() external view returns (uint256) {
        return actors.length;
    }

    // ---------------------------------------------------------------- internal

    function _actor(uint256 seed) internal view returns (address) {
        return actors[seed % actors.length];
    }

    /// @dev An actor or the treasury: everyone the escrow can owe.
    function _account(uint256 seed) internal view returns (address) {
        return seed % (actors.length + 1) == actors.length ? treasury : actors[seed % (actors.length + 1)];
    }

    function _token(uint256 seed) internal view returns (address) {
        return tokens[seed % tokens.length];
    }

    function _graduated(uint256 seed) internal view returns (address token, MockIcarusPool pool) {
        for (uint256 i = 0; i < tokens.length; i++) {
            address candidate = tokens[(seed % tokens.length + i) % tokens.length];
            address p = launchpad.poolOf(candidate);
            if (p != address(0)) return (candidate, MockIcarusPool(p));
        }
    }

    /// @dev The first actor from `seed` on holding `token`, or the seed's actor if none does.
    function _holder(uint256 seed, address token) internal view returns (address) {
        for (uint256 i = 0; i < actors.length; i++) {
            address actor = _actor(seed % actors.length + i);
            if (IERC20(token).balanceOf(actor) != 0) return actor;
        }
        return _actor(seed);
    }

    /// @dev The first actor from `seed` on who can sell `token` to its curve, and how much.
    function _seller(uint256 seed, address token) internal view returns (address actor, uint256 amount) {
        for (uint256 i = 0; i < actors.length; i++) {
            actor = _actor(seed % actors.length + i);
            uint256 balance = IERC20(token).balanceOf(actor);
            uint256 held = launchpad.held(token, actor);
            amount = held < balance ? held : balance;
            if (amount != 0) return (actor, amount);
        }
    }

    function _soldOut(address token) internal view returns (bool) {
        return launchpad.market(token).virtualToken == S - C;
    }

    function _quotable(address token, uint256 amount) internal view returns (bool) {
        try launchpad.previewSell(token, amount) {
            return true;
        } catch {
            return false;
        }
    }

    function _sellOut(address actor, address token) internal {
        _fund(actor, 100 ether);
        vm.prank(actor);
        launchpad.buy(token, 100 ether, 0, block.timestamp);
    }

    function _fund(address account, uint256 amount) internal {
        weth.mint(account, amount);
        vm.prank(account);
        weth.approve(address(launchpad), type(uint256).max);
    }

    function _violate(string memory why) internal {
        violations++;
        lastViolation = why;
    }

    /// @dev Invariants 7 and 9: locker LP never decreases; token supply never increases after launch.
    function _checkMonotonic() internal {
        for (uint256 i = 0; i < tokens.length; i++) {
            address token = tokens[i];
            uint256 supply = IERC20(token).totalSupply();
            if (supply > lastSupply[token]) _violate("token supply increased");
            lastSupply[token] = supply;
            address pool = launchpad.poolOf(token);
            if (pool == address(0)) continue;
            uint256 lp = MockIcarusPool(pool).balanceOf(address(locker));
            if (lp < lastLockerLp[pool]) _violate("locker LP decreased");
            lastLockerLp[pool] = lp;
        }
    }
}
