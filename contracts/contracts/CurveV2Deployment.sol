// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveLaunchFactory} from "./CurveLaunchFactory.sol";
import {CurveLaunchDeployer} from "./CurveLaunchDeployer.sol";
import {CurveFeeEscrow} from "./CurveFeeEscrow.sol";
import {CurveBuybackVault} from "./CurveBuybackVault.sol";
import {CurveGraduationGuard} from "./CurveGraduationGuard.sol";
import {CurveGraduationExecutor} from "./CurveGraduationExecutor.sol";
import {CurveLpLocker} from "./LpLocker.sol";
import {CurveMemeHook} from "./CurveMemeHook.sol";
import {CurveLaunchAndBuy} from "./CurveLaunchAndBuy.sol";

/// @notice Deployment helper executed by scripts/tests. Each `new` is a separate broadcast transaction.
library CurveV2Deployment {
    function deploy(address quote, address icarusFactory, address treasury, uint256 supply, uint256 curveSupply, uint256 initialVQ)
        internal returns (CurveLaunchFactory factory)
    {
        factory = new CurveLaunchFactory(quote, icarusFactory, treasury, supply, curveSupply, initialVQ);
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
        factory.initialize(s);
    }
}
