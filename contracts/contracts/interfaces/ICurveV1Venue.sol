// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Graduation seam. A venue checks readiness and deposits curve assets into a locked pool.
interface ICurveV1Venue {
    function factory() external view returns (address);
    function quote() external view returns (address);
    function locker() external view returns (address);
    function isMock() external view returns (bool);
    function check(address token, uint256 tokenLiquidity, uint256 quoteLiquidity) external view;
    function graduate(address token, address curve)
        external
        returns (address pool, uint256 liquidity, uint256 quoteLiquidity);
}
