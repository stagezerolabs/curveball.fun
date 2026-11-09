// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CurveDeploy} from "../../scripts/CurveDeploy.sol";
import {Smoke} from "../../scripts/Smoke.s.sol";
import {CurveFeeEscrow} from "../../contracts/CurveFeeEscrow.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";
import {CurveLpLocker} from "../../contracts/CurveLpLocker.sol";
import {IIcarusPool} from "../../contracts/interfaces/IIcarus.sol";

interface IForkWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

interface ILegacyFeeEscrow {
    function buybackBalance(address token) external view returns (uint256);
}

/// @dev The buyer contracts exist only in fork state. Their WETH comes from an actor funded by vm.deal.
contract ForkSmokeBuyer {
    using SafeERC20 for IERC20;

    address immutable controller;

    constructor() {
        controller = msg.sender;
    }

    function buy(CurveLaunchpad launchpad, address token, address quote, uint256 budget)
        external
        returns (uint256 out)
    {
        require(msg.sender == controller, "not controller");
        IERC20(quote).forceApprove(address(launchpad), budget);
        out = launchpad.buy(token, budget, 1, block.timestamp + 1 hours);
        IERC20(quote).safeTransfer(controller, IERC20(quote).balanceOf(address(this)));
    }

    function sweep(address token) external {
        require(msg.sender == controller, "not controller");
        IERC20(token).safeTransfer(controller, IERC20(token).balanceOf(address(this)));
    }
}

/// @dev Uses the live smoke's launch-and-first-buy function, then simulates full graduation locally.
contract ForkSmokeActor is Smoke {
    using SafeERC20 for IERC20;

    uint256 constant POOL_SWAP = 0.001 ether;
    CurveLaunchpad private lp;
    CurveFeeEscrow private feeEscrow;
    CurveLpLocker private lpLocker;
    address private quote;
    bool private legacy;

    receive() external payable {}

    function simulate(address launchpad_, address escrow_, address locker_, bool legacy_)
        external
        returns (address token)
    {
        lp = CurveLaunchpad(launchpad_);
        feeEscrow = CurveFeeEscrow(escrow_);
        lpLocker = CurveLpLocker(locker_);
        legacy = legacy_;
        require(_isLegacy(lp) == legacy, "wrong release");
        quote = lp.quoteToken();

        uint256 wrap = lp.graduationTarget() * 210 / 100 + lp.launchFee() + POOL_SWAP + 0.01 ether;
        IForkWETH(quote).deposit{value: wrap}();
        IERC20(quote).forceApprove(launchpad_, type(uint256).max);
        uint256 firstTokens;
        (token, firstTokens) = _launchAndBuy(lp, address(this), legacy);

        IERC20(token).forceApprove(launchpad_, firstTokens / 2);
        require(lp.sell(token, firstTokens / 2, 1, block.timestamp + 1 hours) != 0, "sell");

        ForkSmokeBuyer[] memory buyers;
        uint256 buyerCount;
        if (legacy) {
            lp.buy(token, IERC20(quote).balanceOf(address(this)) - POOL_SWAP, 1, block.timestamp + 1 hours);
            require(lp.held(token, address(this)) == lp.CURVE_SUPPLY(), "legacy sellout");
        } else {
            (buyers, buyerCount) = _fillCappedCurve(token);
        }

        IIcarusPool pool = IIcarusPool(lp.graduate(token));
        require(lp.poolOf(token) == address(pool), "not graduated");
        require(pool.balanceOf(locker_) != 0, "LP not locked");
        for (uint256 i; i < buyerCount; ++i) {
            buyers[i].sweep(token);
        }

        _swapAndClaim(pool, token);
        IForkWETH(quote).withdraw(IERC20(quote).balanceOf(address(this)));
    }

    function _fillCappedCurve(address token) private returns (ForkSmokeBuyer[] memory buyers, uint256 count) {
        uint256 cap = lp.MAX_WALLET_CURVE_TOKENS();
        require(cap == lp.CURVE_SUPPLY() / 20, "unexpected cap");
        buyers = new ForkSmokeBuyer[](32);
        uint256 remaining = lp.CURVE_SUPPLY() - lp.held(token, address(this));
        while (remaining != 0) {
            require(count < buyers.length, "too many buyers");
            ForkSmokeBuyer buyer = new ForkSmokeBuyer();
            buyers[count++] = buyer;
            uint256 budget = IERC20(quote).balanceOf(address(this)) - POOL_SWAP;
            IERC20(quote).safeTransfer(address(buyer), budget);
            uint256 bought = buyer.buy(lp, token, quote, budget);
            require(bought != 0 && bought <= cap && bought <= remaining, "capped buy failed");
            remaining -= bought;
        }
        require(count >= 20, "cap not exercised");
    }

    function _swapAndClaim(IIcarusPool pool, address token) private {
        uint256 out = pool.getAmountOut(POOL_SWAP, quote);
        require(out != 0, "pool quote");
        IERC20(quote).safeTransfer(address(pool), POOL_SWAP);
        bool tokenIsToken0 = pool.token0() == token;
        pool.swap(tokenIsToken0 ? out : 0, tokenIsToken0 ? 0 : out, address(this), "");

        (, uint256 quoteFees) = lpLocker.claim(address(pool));
        require(quoteFees != 0, "LP fees");
        require(feeEscrow.claim(quote) != 0, "creator claim");
        if (legacy) {
            require(ILegacyFeeEscrow(address(feeEscrow)).buybackBalance(token) != 0, "legacy buyback");
        } else {
            require(feeEscrow.buybackTreasury().quoteBudget() != 0, "buyback budget");
        }
    }
}

contract SmokeTestnetForkTest is Test, CurveDeploy {
    address constant TESTNET_WETH = 0x4200000000000000000000000000000000000006;
    address constant TESTNET_ICARUS = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;
    address constant LEGACY_LAUNCHPAD = 0xb919a4e77bF084e6b5bAF358Ed485F19451c9582;
    address constant LEGACY_ESCROW = 0x5D86a629681344902b8E32554C8a78b88B62e3e8;
    address constant LEGACY_LOCKER = 0xA2D87f7E9E604C946e5c4b1690159089c4447aec;

    function test_fork_legacyLaunchAndGraduation() public {
        _forkTestnet();
        ForkSmokeActor actor = new ForkSmokeActor();
        vm.deal(address(actor), 9 ether);
        address token = actor.simulate(LEGACY_LAUNCHPAD, LEGACY_ESCROW, LEGACY_LOCKER, true);
        assertTrue(CurveLaunchpad(LEGACY_LAUNCHPAD).poolOf(token) != address(0));
    }

    function test_fork_cappedLaunchAndGraduation() public {
        _forkTestnet();
        Deployment memory d = _deployCurve(
            address(this),
            Params({
                owner: address(this),
                guardian: address(this),
                treasury: address(this),
                quoteToken: TESTNET_WETH,
                icarusFactory: TESTNET_ICARUS,
                launchFee: 0.00045 ether,
                walletCapBps: 500,
                graduationTarget: 4 ether,
                fees: CurveLaunchpad.FeeDefaults(75, 5_000, 2_500, 50)
            })
        );
        ForkSmokeActor actor = new ForkSmokeActor();
        vm.deal(address(actor), 9 ether);
        address token = actor.simulate(address(d.launchpad), address(d.escrow), address(d.locker), false);
        assertEq(uint8(d.launchpad.market(token).state), uint8(CurveLaunchpad.State.Graduated));
        assertGt(IERC20(token).balanceOf(address(actor)), d.launchpad.CURVE_SUPPLY());
    }

    function _forkTestnet() private {
        string memory rpc = vm.envOr("RISE_TESTNET_RPC_URL", string(""));
        if (bytes(rpc).length == 0) {
            require(vm.envOr("CI_FORK", uint256(0)) != 1, "RISE_TESTNET_RPC_URL required");
            vm.skip(true);
        }
        vm.createSelectFork(rpc);
        assertEq(block.chainid, 11_155_931);
    }
}
