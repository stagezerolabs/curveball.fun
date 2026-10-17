// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveV1Factory} from "../contracts/CurveV1Factory.sol";
import {CurveV1Deployment} from "../contracts/CurveV1Deployment.sol";
import {CurveV1PoolAdapter} from "../contracts/CurveV1PoolAdapter.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveHolderReserve} from "../contracts/CurveHolderReserve.sol";
import {IIcarusPool} from "../contracts/interfaces/IIcarus.sol";

contract V1MockGraduationTest is TestBase {
    address private constant TRADER = address(0xBEEF);

    function testMockGraduationAndFuturePolicySnapshot() external {
        MockWETH weth = new MockWETH();
        MockIcarusFactory mock = new MockIcarusFactory();
        CurveV1Factory factory = _deploy(weth, mock);
        (address token, address curveAddress) = factory.createToken("V1", "V1", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        assertEq(curve.initialVQ(), 0.00125 ether, "wrong initial reserve");
        address firstAdapter = factory.venueOf(token);

        factory.setGraduationTarget(0.01 ether);
        CurveV1PoolAdapter next =
            new CurveV1PoolAdapter(address(factory), address(weth), address(factory.locker()), address(mock), true);
        factory.setVenue(address(next));
        (address nextToken, address nextCurveAddress) = factory.createToken("V1 Two", "V1T", "", 0);
        assertEq(factory.venueOf(token), firstAdapter, "old venue changed");
        assertEq(factory.venueOf(nextToken), address(next), "new venue not selected");
        assertEq(CurveBondingCurve(nextCurveAddress).initialVQ(), 0.0025 ether, "new target not applied");

        weth.mint(TRADER, 0.006 ether);
        vm.prank(TRADER);
        weth.approve(curveAddress, 0.006 ether);
        vm.prank(TRADER);
        curve.buyTokens(0.006 ether, 800_000 ether, DEADLINE);
        assertEq(curve.realQuote(), 0.005 ether, "wrong graduation proceeds");
        factory.graduate(token);
        address pool = factory.createGraduatedPool(token);
        assertTrue(curve.graduated(), "curve did not graduate");
        assertEq(weth.balanceOf(pool), 0.005 ether, "WETH not deposited");
        assertTrue(IERC20(pool).balanceOf(address(factory.locker())) > 0, "LP not locked");
        assertEq(factory.locker().tokenOfPool(pool), token, "pool not registered");
    }

    function testBuySellRoutesFeesAndKeepsQuoteBacked() external {
        MockWETH weth = new MockWETH();
        MockIcarusFactory mock = new MockIcarusFactory();
        CurveV1Factory factory = _deploy(weth, mock);
        (address token, address curveAddress) = factory.createToken("V1 Trade", "V1T", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        weth.mint(TRADER, 0.001 ether);
        vm.prank(TRADER);
        weth.approve(curveAddress, 0.001 ether);
        vm.prank(TRADER);
        uint256 bought = curve.buyTokens(0.001 ether, 1, DEADLINE);
        assertEq(IERC20(token).balanceOf(TRADER), bought, "buyer did not receive tokens");
        assertTrue(factory.escrow().claimable(token, address(weth), TRADER) == 0, "buyer earned creator fees");
        assertTrue(factory.escrow().claimable(token, address(weth), address(this)) > 0, "creator fees missing");

        vm.prank(TRADER);
        IERC20(token).approve(curveAddress, bought);
        vm.prank(TRADER);
        curve.sellTokens(bought, 1, DEADLINE);
        assertEq(curve.sold(), 0, "sale did not unwind");
        assertEq(IERC20(token).balanceOf(TRADER), 0, "seller retained tokens");
        assertEq(weth.balanceOf(curveAddress), curve.realQuote(), "curve quote is not backed");
    }

    function testLaunchRegistersChosenHolderReserve() external {
        MockWETH weth = new MockWETH();
        MockIcarusFactory mock = new MockIcarusFactory();
        CurveV1Factory factory = _deploy(weth, mock);
        (address token, address curveAddress) = factory.createToken("V1 Reserve", "V1R", "", 0, 250);
        uint256 reserved = factory.supply() * 250 / 10_000;
        assertEq(factory.reserveBps(token), 250, "reserve selection not recorded");
        assertEq(IERC20(token).balanceOf(address(factory.holderReserve())), reserved, "reserve tokens missing");
        assertEq(IERC20(token).balanceOf(curveAddress), factory.supply() - reserved, "curve allocation changed");
    }

    function testReadyCurveRejectsSalesUntilGraduationCompletes() external {
        MockWETH weth = new MockWETH();
        MockIcarusFactory mock = new MockIcarusFactory();
        CurveV1Factory factory = _deploy(weth, mock);
        (address token, address curveAddress) = factory.createToken("V1 Ready", "V1R", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        uint256 curveSupply = factory.curveSupply();

        weth.mint(TRADER, 0.006 ether);
        vm.prank(TRADER);
        weth.approve(curveAddress, 0.006 ether);
        vm.prank(TRADER);
        curve.buyTokens(0.006 ether, curveSupply, DEADLINE);
        factory.graduate(token);
        assertTrue(curve.ready(), "curve not ready");

        vm.prank(TRADER);
        IERC20(token).approve(curveAddress, 1 ether);
        vm.prank(TRADER);
        vm.expectRevert();
        curve.sellTokens(1 ether, 1, DEADLINE);
        assertTrue(curve.ready(), "ready flag changed");
        assertEq(curve.sold(), curveSupply, "sold amount changed");
    }

    function testHolderReserveExcludesFeeServiceContracts() external {
        MockWETH weth = new MockWETH();
        MockIcarusFactory mock = new MockIcarusFactory();
        CurveV1Factory factory = _deploy(weth, mock);
        (address token, address curveAddress) = factory.createToken("V1 Holders", "V1H", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        uint256 curveSupply = factory.curveSupply();

        weth.mint(TRADER, 0.006 ether);
        vm.prank(TRADER);
        weth.approve(curveAddress, 0.006 ether);
        vm.prank(TRADER);
        curve.buyTokens(0.006 ether, curveSupply, DEADLINE);
        factory.graduate(token);
        address pool = factory.createGraduatedPool(token);
        address escrow = address(factory.escrow());
        address poolFees = IIcarusPool(pool).poolFees();
        address gaugeFees = IIcarusPool(pool).gaugeFees();

        vm.prank(TRADER);
        IERC20(token).transfer(escrow, 100_000 ether);
        vm.prank(TRADER);
        IERC20(token).transfer(poolFees, 100_000 ether);
        vm.prank(TRADER);
        IERC20(token).transfer(gaugeFees, 100_000 ether);
        uint256 snapshot = block.number;
        vm.roll(block.number + 1);

        CurveHolderReserve reserve = factory.holderReserve();
        uint256 roundId = reserve.createRound(token, snapshot, 50_000 ether);
        assertEq(reserve.claimable(token, roundId, TRADER), 50_000 ether, "holder allocation diluted");
        assertEq(reserve.claimable(token, roundId, escrow), 0, "escrow can claim");
        assertEq(reserve.claimable(token, roundId, poolFees), 0, "pool fees can claim");
        assertEq(reserve.claimable(token, roundId, gaugeFees), 0, "gauge fees can claim");
    }

    function _deploy(MockWETH weth, MockIcarusFactory mock) private returns (CurveV1Factory) {
        return CurveV1Deployment.deploy(
            CurveV1Deployment.Config({
                quote: address(weth),
                poolFactory: address(mock),
                owner: address(this),
                treasury: address(this),
                launchFeeTreasury: address(0),
                launchFee: 0,
                graduationTarget: 0.005 ether,
                isMock: true
            })
        );
    }
}
