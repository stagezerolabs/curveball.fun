// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IIcarusFactory {
    function getPool(address, address, bool) external view returns (address);
    function createPool(address, address, bool) external returns (address);
    function isPool(address) external view returns (bool);
}

interface IIcarusPool {
    function token0() external view returns (address);
    function token1() external view returns (address);
    function totalSupply() external view returns (uint256);
    function getReserves() external view returns (uint256, uint256, uint256);
    function mint(address) external returns (uint256);
    function skim(address) external;
    function claimFees() external returns (uint256, uint256);
}
