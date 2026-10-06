// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";

contract V2PropertiesTest is TestBase {
    address private constant TRADER = address(0xBEEF);
    uint256 private constant SUPPLY = 1_000_000 ether;
    uint256 private constant K = SUPPLY * 10 ether;

    function testFuzzTradeSequencePreservesFundsAndMarketAuthority(uint64[8] memory decisions) external {
        MockWETH quote = new MockWETH();
        CurveLaunchFactory factory = CurveV2Deployment.deploy(address(quote), address(new MockIcarusFactory()), address(this), SUPPLY, 800_000 ether, 10 ether);
        (address tokenAddress, address curveAddress) = factory.createToken("Property", "PROP", "", 25);
        CurveLauncherToken token = CurveLauncherToken(tokenAddress);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        uint256 funded = 100 ether;
        quote.mint(TRADER, funded);
        vm.prank(TRADER);
        quote.approve(curveAddress, type(uint256).max);
        vm.prank(TRADER);
        token.approve(curveAddress, type(uint256).max);

        for (uint256 i = 0; i < decisions.length; i++) {
            uint256 held = token.balanceOf(TRADER);
            if ((decisions[i] & 1) == 1 && held > 0) {
                uint256 amount = held * ((uint256(decisions[i]) % 80) + 1) / 100;
                if (amount == 0) amount = 1;
                vm.prank(TRADER);
                curve.sellTokens(amount, 0, DEADLINE);
            } else {
                uint256 amount = (uint256(decisions[i]) % 3_000 + 1) * 1e14;
                if (quote.balanceOf(TRADER) < amount) {
                    quote.mint(TRADER, amount);
                    funded += amount;
                }
                vm.prank(TRADER);
                curve.buyTokens(amount, 0, DEADLINE);
            }
            assertEq(token.totalSupply(), SUPPLY, "S1 fixed supply");
            assertTrue(curve.sold() <= 800_000 ether, "sold exceeds curve allocation");
            assertEq(curve.virtualQuote(), curve.initialVQ() + curve.realQuote(), "S2 phantom reserve accounting");
            assertTrue(uint256(curve.virtualToken()) * curve.virtualQuote() >= K, "S2 product fell below initial invariant");
            assertEq(quote.balanceOf(curveAddress), curve.realQuote(), "curve quote unbacked");
            assertEq(quote.balanceOf(address(factory.escrow())), factory.escrow().totalLiability(address(quote)), "S6 escrow unbacked");
            assertEq(quote.balanceOf(address(factory.vault())), factory.vault().totalQuoteLiability(), "S6 buyback quote unbacked");
            assertEq(
                quote.balanceOf(TRADER) + quote.balanceOf(curveAddress) + quote.balanceOf(address(factory.escrow())) + quote.balanceOf(address(factory.vault())),
                funded, "S6 quote conservation"
            );
            assertEq(curve.quote(), factory.quote(), "S3 quote identity");
            assertEq(token.curve(), curveAddress, "S8 creator cannot select reserve custodian");
        }
    }
}
