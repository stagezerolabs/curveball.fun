// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @notice The checked price read exposed by Stork's EVM proxy.
interface IStork {
    struct TemporalNumericValue {
        uint64 timestampNs;
        int192 quantizedValue;
    }

    function getTemporalNumericValueV1(bytes32 id) external view returns (TemporalNumericValue memory value);
}
