// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {TestBase} from "./TestBase.sol";
import {MockWETH} from "../contracts/mocks/MockWETH.sol";
import {MockIcarusFactory} from "../contracts/mocks/MockIcarus.sol";
import {CurveLaunchFactory} from "../contracts/CurveLaunchFactory.sol";
import {CurveV2Deployment} from "../contracts/CurveV2Deployment.sol";
import {CurveLaunchDeployer} from "../contracts/CurveLaunchDeployer.sol";
import {CurveBondingCurve} from "../contracts/CurveBondingCurve.sol";
import {CurveLauncherToken} from "../contracts/CurveLauncherToken.sol";

contract V2LaunchTest is TestBase {
    address private constant CREATOR = address(0xCAFE);
    uint256 private constant SUPPLY = 1_000_000 ether;
    uint256 private constant CURVE_SUPPLY = 800_000 ether;

    function testLaunchMintsFixedSupplyToBoundCurveAndSnapshotsPolicy() external {
        (CurveLaunchFactory factory, CurveLaunchDeployer deployer) = _setup();
        vm.prank(CREATOR);
        (address token, address curve) = factory.createToken("V2 Token", "V2", "ipfs://v2", 25);

        assertEq(CurveLauncherToken(token).totalSupply(), SUPPLY, "wrong fixed supply");
        assertEq(CurveLauncherToken(token).balanceOf(curve), SUPPLY, "supply did not go directly to curve");
        assertEq(CurveLauncherToken(token).balanceOf(CREATOR), 0, "creator received mint authority");
        assertEq(CurveBondingCurve(curve).token(), token, "token not bound to curve");
        assertEq(CurveBondingCurve(curve).deployer(), address(deployer), "wrong deployer");
        (address recordedCurve, address recordedCreator, uint16 feeBps, uint16 creatorShareBps, uint16 buybackShareBps, uint16 creatorTaxBps, address treasury) = factory.market(token);
        assertEq(recordedCurve, curve, "wrong registered curve");
        assertEq(recordedCreator, CREATOR, "wrong creator");
        assertEq(feeBps, 50, "wrong fee snapshot");
        assertEq(creatorShareBps, 5_000, "wrong creator share");
        assertEq(buybackShareBps, 2_500, "wrong buyback share");
        assertEq(creatorTaxBps, 25, "wrong creator tax");
        assertEq(treasury, address(this), "wrong treasury snapshot");
    }

    function testAnyoneCanLaunchFromGenesisAndCreatorTaxCapStillApplies() external {
        (CurveLaunchFactory factory,) = _setup();
        assertTrue(factory.publicLaunchOpen(), "factory is not public at genesis");
        assertTrue(!factory.invited(CREATOR), "legacy invite read should be false");
        vm.prank(CREATOR);
        (address token, address curve) = factory.createToken("No invite", "NO", "", 0);
        assertEq(CurveBondingCurve(curve).creator(), CREATOR, "caller is not creator");
        assertEq(CurveLauncherToken(token).balanceOf(curve), SUPPLY, "missing curve supply");
        assertTrue(factory.canBuy(CREATOR), "creator cannot buy");
        assertTrue(factory.canBuy(address(0xBEEF)), "public buyer blocked");
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createToken("High tax", "HIGH", "", 51);
    }

    function testPermissionlessLaunchBoundsUntrustedMetadata() external {
        (CurveLaunchFactory factory,) = _setup();
        string memory longName = string.concat(
            "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "A"
        );
        assertEq(bytes(longName).length, 65, "bad test name");
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createToken(longName, "LONG", "", 0);
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createToken("Valid", string(new bytes(13)), "", 0);
        vm.prank(CREATOR);
        vm.expectRevert();
        factory.createToken("Valid", "VALID", string(new bytes(2049)), 0);
    }

    function testFactoryCannotLaunchUninitializedOrReplaceBoundServices() external {
        MockWETH quote = new MockWETH();
        CurveLaunchFactory raw = new CurveLaunchFactory(address(quote), address(new MockIcarusFactory()), address(this), SUPPLY, CURVE_SUPPLY, 10 ether);
        assertTrue(!raw.publicLaunchOpen(), "uninitialized factory reports public access");
        vm.expectRevert();
        raw.createToken("Uninitialized", "NO", "", 0);

        (CurveLaunchFactory factory,) = _setup();
        CurveLaunchFactory.Services memory services = CurveLaunchFactory.Services({
            deployer: address(factory.deployer()), escrow: address(factory.escrow()), vault: address(factory.vault()),
            guard: address(factory.guard()), executor: address(factory.executor()), locker: address(factory.locker()),
            hook: address(factory.hook()), launchAndBuy: address(factory.launchAndBuy())
        });
        vm.expectRevert();
        factory.initialize(services);
        vm.prank(CREATOR);
        vm.expectRevert();
        raw.initialize(services);
    }

    function testPolicyChangesOnlyAffectFutureLaunches() external {
        (CurveLaunchFactory factory,) = _setup();
        vm.prank(CREATOR);
        (address first,) = factory.createToken("First", "ONE", "", 0);
        factory.setFeeDefaults(75, 4_000, 3_000, 50, address(0xBEEF));
        vm.prank(CREATOR);
        (address second,) = factory.createToken("Second", "TWO", "", 40);
        (,, uint16 oldFee,,, uint16 oldTax, address oldTreasury) = factory.market(first);
        (,, uint16 newFee,,, uint16 newTax, address newTreasury) = factory.market(second);
        assertEq(oldFee, 50, "old fee changed");
        assertEq(oldTax, 0, "old tax changed");
        assertEq(oldTreasury, address(this), "old treasury changed");
        assertEq(newFee, 75, "new fee missing");
        assertEq(newTax, 40, "new tax missing");
        assertEq(newTreasury, address(0xBEEF), "new treasury missing");
    }

    function _setup() private returns (CurveLaunchFactory factory, CurveLaunchDeployer deployer) {
        MockWETH quote = new MockWETH();
        MockIcarusFactory icarus = new MockIcarusFactory();
        factory = CurveV2Deployment.deploy(address(quote), address(icarus), address(this), SUPPLY, CURVE_SUPPLY, 10 ether);
        deployer = factory.deployer();
    }
}
