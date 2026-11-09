// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice Splits fees already transferred to the escrow and records the resulting claims.
interface ICurveFeeEscrow {
    /// @param fee Trading or pool fee in `asset`, split by the market's fee policy.
    /// @param tax Creator tax in `asset`, owed to the creator in full.
    function distribute(address token, address asset, uint256 fee, uint256 tax) external;

    /// @notice Records a market's pool observation count at graduation, so buybacks only trust
    ///         observations pushed over seeded reserves.
    function markGraduated(address token, address pool) external;
}

/// @notice Holds graduated LP permanently and forwards its trading fees to the escrow.
interface ICurveLpLocker {
    function register(address token, address pool) external;
}
