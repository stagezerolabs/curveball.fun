// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {CommonBase} from "forge-std/Base.sol";
import {CurveFeeEscrow} from "../contracts/CurveFeeEscrow.sol";
import {CurveLaunchpad} from "../contracts/CurveLaunchpad.sol";
import {CurveBuybackTreasury} from "../contracts/CurveBuybackTreasury.sol";
import {CurveLpLocker} from "../contracts/CurveLpLocker.sol";

/// @notice Deploys and wires the four singletons; shared by the test fixture and `Deploy.s.sol`.
/// @dev The escrow and locker take the launchpad's address before it exists, so it is
///      predicted from the deployer's nonce. Any shift (for example a retried transaction) aborts
///      the deployment instead of leaving singletons pointing at the wrong address.
abstract contract CurveDeploy is CommonBase {
    struct Params {
        address owner;
        address guardian;
        address treasury;
        address quoteToken;
        address icarusFactory;
        uint256 launchFee;
        uint16 walletCapBps;
        uint256 graduationTarget;
        CurveLaunchpad.FeeDefaults fees;
    }

    struct Deployment {
        CurveLaunchpad launchpad;
        CurveFeeEscrow escrow;
        CurveLpLocker locker;
        CurveBuybackTreasury buybackTreasury;
    }

    error AddressPredictionMismatch(address predicted, address actual);
    error WiringMismatch(string pointer);

    /// @param deployer The account whose nonce the four `new` calls consume.
    function _deployCurve(address deployer, Params memory p) internal returns (Deployment memory d) {
        address predicted = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 3);
        address predictedBuyback = vm.computeCreateAddress(deployer, vm.getNonce(deployer) + 1);
        d.escrow = new CurveFeeEscrow(predicted, p.quoteToken, p.icarusFactory, p.owner, predictedBuyback);
        d.buybackTreasury =
            new CurveBuybackTreasury(predicted, address(d.escrow), p.quoteToken, p.icarusFactory, p.owner);
        if (address(d.buybackTreasury) != predictedBuyback) {
            revert AddressPredictionMismatch(predictedBuyback, address(d.buybackTreasury));
        }
        d.locker = new CurveLpLocker(predicted, address(d.escrow));
        d.launchpad = new CurveLaunchpad(
            CurveLaunchpad.Config({
                owner: p.owner,
                guardian: p.guardian,
                treasury: p.treasury,
                quoteToken: p.quoteToken,
                icarusFactory: p.icarusFactory,
                escrow: address(d.escrow),
                locker: address(d.locker),
                launchFee: p.launchFee,
                walletCapBps: p.walletCapBps,
                graduationTarget: p.graduationTarget,
                fees: p.fees
            })
        );
        if (address(d.launchpad) != predicted) revert AddressPredictionMismatch(predicted, address(d.launchpad));
        _checkWiring(d, p);
    }

    function _checkWiring(Deployment memory d, Params memory p) internal view {
        address launchpad = address(d.launchpad);
        _check(d.escrow.launchpad() == launchpad, "escrow.launchpad");
        _check(d.escrow.quoteToken() == p.quoteToken, "escrow.quoteToken");
        _check(address(d.escrow.icarusFactory()) == p.icarusFactory, "escrow.icarusFactory");
        _check(d.escrow.owner() == p.owner, "escrow.owner");
        _check(address(d.escrow.buybackTreasury()) == address(d.buybackTreasury), "escrow.buybackTreasury");
        _check(d.buybackTreasury.escrow() == address(d.escrow), "buybackTreasury.escrow");
        _check(d.buybackTreasury.launchpad() == launchpad, "buybackTreasury.launchpad");
        _check(d.locker.launchpad() == launchpad, "locker.launchpad");
        _check(address(d.locker.escrow()) == address(d.escrow), "locker.escrow");
        _check(d.launchpad.escrow() == address(d.escrow), "launchpad.escrow");
        _check(d.launchpad.locker() == address(d.locker), "launchpad.locker");
        _check(d.launchpad.quoteToken() == p.quoteToken, "launchpad.quoteToken");
        _check(d.launchpad.icarusFactory() == p.icarusFactory, "launchpad.icarusFactory");
        _check(d.launchpad.treasury() == p.treasury, "launchpad.treasury");
        _check(d.launchpad.walletCapBps() == p.walletCapBps, "launchpad.walletCapBps");
        _check(d.launchpad.owner() == p.owner, "launchpad.owner");
        _check(d.launchpad.guardian() == p.guardian, "launchpad.guardian");
    }

    function _check(bool ok, string memory pointer) private pure {
        if (!ok) revert WiringMismatch(pointer);
    }
}
