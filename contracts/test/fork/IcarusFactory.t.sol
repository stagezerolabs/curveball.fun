// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ThrowawayERC20} from "../../contracts/test/ThrowawayERC20.sol";
import {TestBase} from "../TestBase.sol";

interface IIcarusFactoryFork {
    function createPool(address tokenA, address tokenB, bool stable) external returns (address);
    function getPool(address tokenA, address tokenB, bool stable) external view returns (address);
    function isPool(address pool) external view returns (bool);
}

contract IcarusFactoryForkTest is TestBase {
    address private constant FACTORY = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;

    function testCreateVolatilePoolWithThrowawayTokens() external {
        string memory rpcUrl = vm.envOr("RISE_RPC_URL", "");
        if (bytes(rpcUrl).length == 0) return;
        vm.createSelectFork(rpcUrl);
        ThrowawayERC20 tokenA = new ThrowawayERC20("Throwaway A", "TA");
        ThrowawayERC20 tokenB = new ThrowawayERC20("Throwaway B", "TB");
        IIcarusFactoryFork factory = IIcarusFactoryFork(FACTORY);
        factory.createPool(address(tokenA), address(tokenB), false);
        address pool = factory.getPool(address(tokenA), address(tokenB), false);
        assertTrue(factory.isPool(pool), "factory did not register pool");
    }
}
