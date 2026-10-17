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
    struct Config {
        address quote;
        address poolFactory;
        address owner;
        address treasury;
        address launchFeeTreasury;
        uint256 launchFee;
        uint256 graduationTarget;
        bool isMock;
    }

    function deploy(Config memory config) internal returns (CurveV1Factory factory) {
        require(
            config.owner != address(0) && config.treasury != address(0) && config.graduationTarget > 0,
            "bad deployment config"
        );
        factory = new CurveV1Factory(
            config.quote,
            config.treasury,
            config.launchFeeTreasury,
            config.launchFee,
            1_000_000 ether,
            800_000 ether,
            config.graduationTarget
        );
        address f = address(factory);
        CurveV1Factory.Services memory s;
        s.deployer = address(new CurveLaunchDeployer(f));
        s.escrow = address(new CurveFeeEscrow(f));
        s.vault = address(new CurveBuybackVault(f, config.quote));
        s.locker = address(new CurveV1Locker(f));
        s.hook = address(new CurveMemeHook(f, s.locker, config.quote, s.escrow, s.vault));
        s.launchAndBuy = address(new CurveLaunchAndBuy(f, config.quote));
        s.holderReserve = address(new CurveHolderReserve(f, s.escrow));
        factory.initialize(s);
        CurveV1PoolAdapter adapter =
            new CurveV1PoolAdapter(f, config.quote, s.locker, config.poolFactory, config.isMock);
        factory.setVenue(address(adapter));
        if (factory.owner() != config.owner) factory.transferOwnership(config.owner);
    }
}
