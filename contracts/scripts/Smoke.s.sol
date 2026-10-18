// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveFeeEscrow} from "../contracts/CurveFeeEscrow.sol";
import {CurveHolderReserve} from "../contracts/CurveHolderReserve.sol";
import {CurveLaunchpad} from "../contracts/CurveLaunchpad.sol";
import {CurveLpLocker} from "../contracts/CurveLpLocker.sol";
import {IIcarusPool} from "../contracts/interfaces/IIcarus.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice One market through the live testnet deployment: launch, sell, sell out, graduate, a pool
///      swap, the LP fee claim, the creator's fee and reserve claims, and a buyback that must skip
///      (the fresh pool has no TWAP yet). Every step is asserted, so a failure stops the simulation
///      before anything is broadcast. The broadcasting account is the creator and only trader.
contract Smoke is Script {
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    uint256 internal constant WRAP = 0.02 ether;
    uint256 internal constant FIRST_BUY = 0.003 ether;
    uint256 internal constant POOL_SWAP = 0.001 ether;

    CurveLaunchpad launchpad;
    CurveFeeEscrow escrow;
    CurveLpLocker locker;
    CurveHolderReserve reserve;

    function run() external {
        require(block.chainid == 11_155_931, "RISE testnet only");
        string memory record = vm.readFile(string.concat(vm.projectRoot(), "/../deployments/11155931/curveball.json"));
        launchpad = CurveLaunchpad(vm.parseJsonAddress(record, ".launchpad"));
        escrow = CurveFeeEscrow(vm.parseJsonAddress(record, ".singletons.escrow"));
        locker = CurveLpLocker(vm.parseJsonAddress(record, ".singletons.locker"));
        reserve = CurveHolderReserve(vm.parseJsonAddress(record, ".singletons.reserve"));

        vm.startBroadcast();
        (, address me,) = vm.readCallers();
        IWETH(WETH).deposit{value: WRAP}();
        IERC20(WETH).approve(address(launchpad), type(uint256).max);

        (address token, uint256 firstTokens) = launchpad.launch(
            CurveLaunchpad.Metadata("Curveball Smoke", "SMOKE", "ipfs://curveball-smoke"), 0, 100, FIRST_BUY, 0
        );
        console2.log("token", token);
        require(launchpad.held(token, me) == firstTokens && firstTokens != 0, "first buy");

        IERC20(token).approve(address(launchpad), firstTokens / 2);
        require(launchpad.sell(token, firstTokens / 2, 1, block.timestamp + 1 hours) != 0, "sell");

        launchpad.buy(token, IERC20(WETH).balanceOf(me) - POOL_SWAP, 1, block.timestamp + 1 hours);
        require(launchpad.market(token).state == CurveLaunchpad.State.Ready, "sellout");
        require(launchpad.held(token, me) == launchpad.CURVE_SUPPLY(), "held is the whole curve");

        IIcarusPool pool = IIcarusPool(launchpad.graduate(token));
        console2.log("pool", address(pool));
        require(launchpad.market(token).state == CurveLaunchpad.State.Graduated, "graduated");
        require(pool.balanceOf(address(locker)) != 0, "locker holds the LP");

        uint256 out = pool.getAmountOut(POOL_SWAP, WETH);
        IERC20(WETH).transfer(address(pool), POOL_SWAP);
        bool tokenIsToken0 = pool.token0() == token;
        pool.swap(tokenIsToken0 ? out : 0, tokenIsToken0 ? 0 : out, me, "");

        (, uint256 quoteFees) = locker.claim(address(pool));
        require(quoteFees != 0, "LP fees reached the escrow");
        require(escrow.claim(WETH) != 0, "creator fees paid");
        uint256 reserved = reserve.claim(token);
        require(reserved == reserve.reserveOf(token), "a sole holder claims the whole reserve");
        require(escrow.buyback(token) == 0 && escrow.lastBuyback(token) == 0, "buyback skips without a TWAP");

        IWETH(WETH).withdraw(IERC20(WETH).balanceOf(me));
        vm.stopBroadcast();

        console2.log("tokens held", IERC20(token).balanceOf(me));
        console2.log("reserve claimed", reserved);
        console2.log("LP quote fees", quoteFees);
    }
}
