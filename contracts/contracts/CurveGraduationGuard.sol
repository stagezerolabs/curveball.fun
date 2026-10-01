// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIcarusFactory, IIcarusPool} from "./interfaces/IIcarus.sol";

/// @notice Read-only preflight for each graduation phase.
contract CurveGraduationGuard {
    IIcarusFactory public immutable icarusFactory;

    constructor(address icarusFactory_) {
        require(icarusFactory_ != address(0), "bad factory");
        icarusFactory = IIcarusFactory(icarusFactory_);
    }

    function check(address token, address quote, uint256 tokenLiquidity, uint256 quoteLiquidity)
        external view returns (address pool)
    {
        require(token != address(0) && quote != address(0) && token != quote, "bad pair");
        require(tokenLiquidity > 0 && quoteLiquidity > 1_000_000 / tokenLiquidity, "insufficient liquidity");
        (bool ok, bytes memory data) = address(icarusFactory).staticcall(abi.encodeWithSignature("isPaused()"));
        require(ok && data.length >= 32 && !abi.decode(data, (bool)), "Icarus unavailable");
        pool = icarusFactory.getPool(token, quote, false);
        if (pool != address(0)) {
            require(icarusFactory.isPool(pool) && IIcarusPool(pool).totalSupply() == 0, "pool already used");
            address a = IIcarusPool(pool).token0();
            address b = IIcarusPool(pool).token1();
            require((a == token && b == quote) || (a == quote && b == token), "wrong pool tokens");
        }
    }
}
