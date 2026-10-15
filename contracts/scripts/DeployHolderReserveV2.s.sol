// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {DeployPermissionlessV2} from "./DeployPermissionlessV2.s.sol";

/// @notice Separate broadcast record for the reserve-enabled factory release.
contract DeployHolderReserveV2 is DeployPermissionlessV2 {}
