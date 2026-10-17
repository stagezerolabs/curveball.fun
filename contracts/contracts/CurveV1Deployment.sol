// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveV1Factory} from "./CurveV1Factory.sol";
import {CurveLaunchDeployer} from "./CurveLaunchDeployer.sol";
import {CurveFeeEscrow} from "./CurveFeeEscrow.sol";
import {CurveBuybackVault} from "./CurveBuybackVault.sol";
import {CurveV1Locker} from "./CurveV1Locker.sol";
import {CurveV1PoolAdapter} from "./CurveV1PoolAdapter.sol";
import {CurveMemeHook} from "./CurveMemeHook.sol";
import {CurveLaunchAndBuy} from "./CurveLaunchAndBuy.sol";
import {CurveHolderReserve} from "./CurveHolderReserve.sol";

library CurveV1Deployment {
    function deploy(address quote, address poolFactory, address owner, address feeTreasury, uint256 launchFee)
        internal
        returns (CurveV1Factory factory)
    {
        factory = new CurveV1Factory(quote, owner, feeTreasury, launchFee, 1_000_000 ether, 800_000 ether, 0.005 ether);
        address f = address(factory);
        CurveV1Factory.Services memory s;
        s.deployer = address(new CurveLaunchDeployer(f));
        s.escrow = address(new CurveFeeEscrow(f));
        s.vault = address(new CurveBuybackVault(f, quote));
        s.locker = address(new CurveV1Locker(f));
        s.hook = address(new CurveMemeHook(f, s.locker, quote, s.escrow, s.vault));
        s.launchAndBuy = address(new CurveLaunchAndBuy(f, quote));
        s.holderReserve = address(new CurveHolderReserve(f));
        factory.initialize(s);
        CurveV1PoolAdapter adapter = new CurveV1PoolAdapter(f, quote, s.locker, poolFactory, true);
        factory.setVenue(address(adapter));
        if (factory.owner() != owner) factory.transferOwnership(owner);
    }
}
