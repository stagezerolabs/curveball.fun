// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {PoCFactory, PoCFeePool} from "../contracts/test/PoCIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";
import {CurveLpLocker} from "../contracts/LpLocker.sol";

contract V2PoolFeesTest is TestBase {
    address private constant CREATOR = address(0xCAFE);
    address private constant TRADER = address(0xBEEF);

    function testLockerClaimsOnlyDeliveredFeesAndHookSplitsBothAssets() external {
        MockWETH quote = new MockWETH();
        CurveLaunchFactory factory = CurveV2Deployment.deploy(
            address(quote), address(new PoCFactory()), address(this), 1_000_000 ether, 800_000 ether, 10 ether
        );
        factory.setInvited(CREATOR, true);
        factory.setInvited(TRADER, true);
        vm.prank(CREATOR);
        (address tokenAddress, address curveAddress) = factory.createToken("V2", "V2", "", 0);
        CurveLauncherToken token = CurveLauncherToken(tokenAddress);
        CurveBondingCurve curve = CurveBondingCurve(curveAddress);
        quote.mint(TRADER, 50 ether);
        vm.prank(TRADER);
        quote.approve(curveAddress, 50 ether);
        vm.prank(TRADER);
        curve.buyTokens(50 ether, 800_000 ether, DEADLINE);
        factory.graduate(tokenAddress);
        address pool = factory.createGraduatedPool(tokenAddress);

        quote.mint(pool, 1 ether);
        vm.prank(TRADER);
        token.transfer(pool, 100 ether);
        PoCFeePool(pool).setFees(10 ether, 10 ether, 100 ether, 0.2 ether);
        CurveLpLocker locker = factory.locker();
        locker.claim(pool);
        assertEq(factory.escrow().claimable(tokenAddress, address(quote), CREATOR), 0.2 ether, "creator quote fee");
        assertEq(factory.escrow().claimable(tokenAddress, tokenAddress, CREATOR), 50 ether, "creator meme fee");
        assertEq(factory.vault().quoteBalance(tokenAddress), 0.05 ether + 0.05 ether, "vault quote fee");
        assertEq(factory.vault().memeBalance(tokenAddress), 25 ether, "vault meme fee");
        assertEq(quote.balanceOf(address(locker)), 0, "locker retained quote fees");
        assertEq(token.balanceOf(address(locker)), 0, "locker retained meme fees");
    }
}
