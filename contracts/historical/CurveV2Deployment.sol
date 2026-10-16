// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveLaunchFactory} from "./CurveLaunchFactory.sol";
import {CurveLaunchDeployer} from "../contracts/CurveLaunchDeployer.sol";
import {CurveFeeEscrow} from "./CurveFeeEscrow.sol";
import {CurveBuybackVault} from "../contracts/CurveBuybackVault.sol";
import {CurveGraduationGuard} from "../contracts/CurveGraduationGuard.sol";
import {CurveGraduationExecutor} from "../contracts/CurveGraduationExecutor.sol";
import {CurveLpLocker} from "../contracts/LpLocker.sol";
import {CurveMemeHook} from "./CurveMemeHook.sol";
import {CurveLaunchAndBuy} from "./CurveLaunchAndBuy.sol";
import {CurveHolderReserve} from "../contracts/CurveHolderReserve.sol";

/// @notice Deployment helper executed by scripts/tests. Each `new` is a separate broadcast transaction.
library CurveV2Deployment {
    function deploy(
        address quote,
        address icarusFactory,
        address treasury,
        uint256 supply,
        uint256 curveSupply,
        uint256 initialVQ
    ) internal returns (CurveLaunchFactory factory) {
        return deployWithFee(quote, icarusFactory, treasury, address(0), 0, supply, curveSupply, initialVQ);
    }

    function deployWithFee(
        address quote,
        address icarusFactory,
        address treasury,
        address feeTreasury,
        uint256 launchFee,
        uint256 supply,
        uint256 curveSupply,
        uint256 initialVQ
    ) internal returns (CurveLaunchFactory factory) {
        factory = new CurveLaunchFactory(
            quote, icarusFactory, treasury, feeTreasury, launchFee, supply, curveSupply, initialVQ
        );
        address f = address(factory);
        CurveLaunchFactory.Services memory s;
        s.deployer = address(new CurveLaunchDeployer(f));
        s.escrow = address(new CurveFeeEscrow(f));
        s.vault = address(new CurveBuybackVault(f, quote));
        s.guard = address(new CurveGraduationGuard(icarusFactory));
        s.locker = address(new CurveLpLocker(f));
        s.executor = address(new CurveGraduationExecutor(f, icarusFactory, quote, s.locker));
        s.hook = address(new CurveMemeHook(f, s.locker, quote, s.escrow, s.vault));
        s.launchAndBuy = address(new CurveLaunchAndBuy(f, quote));
        s.holderReserve = address(new CurveHolderReserve(f));
        factory.initialize(s);
    }
}
