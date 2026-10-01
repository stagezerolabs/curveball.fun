// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";
import {CurveFeeEscrow} from "../contracts/CurveFeeEscrow.sol";
import {CurveBuybackVault} from "../contracts/CurveBuybackVault.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ReenteringQuote is MockWETH {
    CurveBondingCurve public target;
    bool public attempted;
    bool public blockedByGuard;

    function arm(CurveBondingCurve curve) external { target = curve; }

    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        if (!attempted && address(target) != address(0) && msg.sender == address(target)) {
            attempted = true;
            (bool succeeded, bytes memory result) = address(target).call(
                abi.encodeCall(target.buyTokens, (1, 0, type(uint256).max))
            );
            bytes4 selector;
            if (result.length >= 4) assembly { selector := mload(add(result, 32)) }
            blockedByGuard = !succeeded && selector == ReentrancyGuard.ReentrancyGuardReentrantCall.selector;
        }
        return super.transferFrom(from, to, amount);
    }
}

contract V2TradeTest is TestBase {
    address private constant CREATOR = address(0xCAFE);
    address private constant TRADER = address(0xBEEF);

    function testBuyAndSellKeepCurveSolventAndRouteQuoteFees() external {
        (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) = _market(25);
        quote.mint(TRADER, 20 ether);
        vm.prank(TRADER);
        quote.approve(address(curve), 20 ether);

        uint256 bought;
        {
            (uint256 expectedTokens, uint256 spent, uint256 curveQuote, uint256 fee, uint256 tax) = curve.quoteBuy(10 ether);
            assertTrue(expectedTokens > 0 && spent <= 10 ether && fee > 0 && tax > 0, "bad buy quote");
            vm.prank(TRADER);
            bought = curve.buyTokens(10 ether, expectedTokens, DEADLINE);
            assertEq(bought, expectedTokens, "buy execution differs from quote");
            assertEq(token.balanceOf(TRADER), bought, "buyer did not receive tokens");
            assertEq(quote.balanceOf(address(curve)), curveQuote, "curve reserve not backed");
            assertEq(curve.virtualQuote(), curve.initialVQ() + curve.realQuote(), "virtual quote mismatch");
            assertEq(factory.escrow().claimable(address(token), address(quote), CREATOR), fee / 2 + tax, "creator fee missing");
            assertEq(factory.vault().quoteBalance(address(token)), fee / 4, "buyback fee missing");
        }

        vm.prank(TRADER);
        token.approve(address(curve), bought);
        (uint256 net,, uint256 sellFee, uint256 sellTax) = curve.quoteSell(bought);
        uint256 before = quote.balanceOf(TRADER);
        vm.prank(TRADER);
        uint256 received = curve.sellTokens(bought, net, DEADLINE);
        assertEq(received, net, "sell execution differs from quote");
        assertEq(quote.balanceOf(TRADER) - before, net, "seller net missing");
        assertEq(token.balanceOf(TRADER), 0, "seller tokens remain");
        assertEq(quote.balanceOf(address(curve)), curve.realQuote(), "reserve not backed after sell");
        assertEq(curve.virtualQuote(), curve.initialVQ() + curve.realQuote(), "virtual quote mismatch after sell");
        assertTrue(sellFee > 0 && sellTax > 0, "sell fees missing");
    }

    function testFeePolicyAndDeadlineFailuresAreAtomic() external {
        (MockWETH quote,, CurveLauncherToken token, CurveBondingCurve curve) = _market(0);
        quote.mint(TRADER, 2 ether);
        vm.prank(TRADER);
        quote.approve(address(curve), 2 ether);
        vm.prank(TRADER);
        vm.expectRevert();
        curve.buyTokens(1 ether, type(uint256).max, DEADLINE);
        assertEq(quote.balanceOf(address(curve)), 0, "failed buy took funds");
        vm.prank(TRADER);
        vm.expectRevert();
        curve.buyTokens(1 ether, 1, 0);
        assertEq(token.balanceOf(TRADER), 0, "failed buy sent tokens");
    }

    function testAnyoneCanTriggerEscrowPaymentOnlyToFixedRecipient() external {
        (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) = _market(0);
        quote.mint(TRADER, 2 ether);
        vm.prank(TRADER);
        quote.approve(address(curve), 2 ether);
        vm.prank(TRADER);
        curve.buyTokens(2 ether, 1, DEADLINE);
        uint256 owed = factory.escrow().claimable(address(token), address(quote), CREATOR);
        uint256 callerBefore = quote.balanceOf(TRADER);
        vm.prank(TRADER);
        factory.escrow().claim(address(token), address(quote), CREATOR);
        assertEq(quote.balanceOf(CREATOR), owed, "fixed recipient not paid");
        assertEq(quote.balanceOf(TRADER), callerBefore, "keeper received fees");
    }

    function testOwnerRescuesOnlyDonationsAndNeverCurveOrFeeLiabilities() external {
        (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve) = _market(0);
        quote.mint(TRADER, 3 ether);
        vm.prank(TRADER);
        quote.approve(address(curve), 3 ether);
        vm.prank(TRADER);
        curve.buyTokens(2 ether, 1, DEADLINE);
        quote.mint(address(curve), 1 ether);
        vm.prank(TRADER);
        token.transfer(address(curve), 1 ether);

        vm.expectRevert();
        curve.rescueTokens(address(quote), 1 ether + 1, address(this));
        vm.expectRevert();
        curve.rescueTokens(address(token), 1 ether + 1, address(this));
        vm.prank(TRADER);
        vm.expectRevert();
        curve.rescueTokens(address(quote), 1 ether, TRADER);
        curve.rescueTokens(address(quote), 1 ether, address(this));
        curve.rescueTokens(address(token), 1 ether, address(this));
        assertEq(quote.balanceOf(address(curve)), curve.realQuote(), "reserve drained by rescue");
        assertEq(token.balanceOf(address(curve)), curve.supply() - curve.sold(), "unsold token drained by rescue");
        assertEq(factory.escrow().totalLiability(address(quote)), quote.balanceOf(address(factory.escrow())), "escrow liability changed");
    }

    function testServiceRescuesKeepFeeAndVestingLiabilitiesBacked() external {
        (MockWETH quote, CurveLaunchFactory factory,, CurveBondingCurve curve) = _market(0);
        quote.mint(TRADER, 2 ether);
        vm.prank(TRADER);
        quote.approve(address(curve), 2 ether);
        vm.prank(TRADER);
        curve.buyTokens(2 ether, 1, DEADLINE);
        CurveFeeEscrow escrow = factory.escrow();
        CurveBuybackVault vault = factory.vault();
        uint256 escrowOwed = escrow.totalLiability(address(quote));
        uint256 vaultOwed = vault.totalQuoteLiability();
        vm.expectRevert();
        escrow.rescueTokens(address(quote), 1, address(this));
        vm.expectRevert();
        vault.rescueTokens(address(quote), 1, address(this));
        quote.mint(address(escrow), 7);
        quote.mint(address(vault), 11);
        escrow.rescueTokens(address(quote), 7, address(this));
        vault.rescueTokens(address(quote), 11, address(this));
        assertEq(quote.balanceOf(address(escrow)), escrowOwed, "escrow obligation spent");
        assertEq(quote.balanceOf(address(vault)), vaultOwed, "vault obligation spent");
        vm.prank(CREATOR);
        vm.expectRevert();
        escrow.rescueTokens(address(quote), 1, CREATOR);
        MockWETH unrelated = new MockWETH();
        unrelated.mint(address(vault), 23);
        vault.rescueTokens(address(unrelated), 23, address(this));
        quote.mint(address(factory.launchAndBuy()), 13);
        factory.launchAndBuy().rescueTokens(address(quote), 13, address(this));
        quote.mint(address(factory.locker()), 17);
        factory.locker().rescueTokens(address(quote), 17, address(this));
        quote.mint(address(factory), 19);
        factory.rescueTokens(address(quote), 19, address(this));
    }

    function testQuoteTransferCallbackCannotReenterBuy() external {
        ReenteringQuote quote = new ReenteringQuote();
        CurveLaunchFactory factory = CurveV2Deployment.deploy(address(quote), address(new MockIcarusFactory()), address(this), 1_000_000 ether, 800_000 ether, 10 ether);
        factory.setInvited(CREATOR, true);
        factory.setInvited(TRADER, true);
        vm.prank(CREATOR);
        (, address curveAddress) = factory.createToken("V2", "V2", "", 0);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        quote.arm(curve);
        quote.mint(TRADER, 2 ether);
        vm.prank(TRADER);
        quote.approve(curveAddress, 2 ether);
        vm.prank(TRADER);
        curve.buyTokens(2 ether, 1, DEADLINE);
        assertTrue(quote.attempted() && quote.blockedByGuard(), "callback reentered curve");
        assertEq(quote.balanceOf(curveAddress), curve.realQuote(), "callback corrupted reserve");
    }

    function _market(uint16 tax)
        private returns (MockWETH quote, CurveLaunchFactory factory, CurveLauncherToken token, CurveBondingCurve curve)
    {
        quote = new MockWETH();
        factory = CurveV2Deployment.deploy(address(quote), address(new MockIcarusFactory()), address(this), 1_000_000 ether, 800_000 ether, 10 ether);
        factory.setInvited(CREATOR, true);
        factory.setInvited(TRADER, true);
        vm.prank(CREATOR);
        (address tokenAddress, address curveAddress) = factory.createToken("V2", "V2", "", tax);
        token = CurveLauncherToken(tokenAddress);
        curve = CurveBondingCurve(curveAddress);
    }
}
