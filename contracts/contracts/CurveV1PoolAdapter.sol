// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CurveBondingCurve} from "./CurveBondingCurve.sol";
import {IIcarusFactory, IIcarusPool} from "./interfaces/IIcarus.sol";
import {ICurveV1Venue} from "./interfaces/ICurveV1Venue.sol";

/// @notice Works with the mock venue now and an Icarus-compatible factory later.
contract CurveV1PoolAdapter is ICurveV1Venue {
    address public immutable factory;
    address public immutable quote;
    address public immutable locker;
    bool public immutable isMock;
    IIcarusFactory public immutable poolFactory;

    constructor(address factory_, address quote_, address locker_, address poolFactory_, bool isMock_) {
        require(
            factory_ != address(0) && quote_ != address(0) && locker_ != address(0) && poolFactory_.code.length > 0,
            "bad dependency"
        );
        factory = factory_;
        quote = quote_;
        locker = locker_;
        isMock = isMock_;
        poolFactory = IIcarusFactory(poolFactory_);
    }

    function check(address token, uint256 tokenLiquidity, uint256 quoteLiquidity) external view {
        require(
            token != address(0) && token != quote && tokenLiquidity > 0 && quoteLiquidity > 0, "insufficient liquidity"
        );
        // Standard constant-product pools permanently lock a small minimum LP amount.
        require(tokenLiquidity > 1_000_000 / quoteLiquidity, "insufficient pool liquidity");
        (bool ok, bytes memory data) = address(poolFactory).staticcall(abi.encodeWithSignature("isPaused()"));
        require(ok && data.length >= 32 && !abi.decode(data, (bool)), "venue unavailable");
        address pool = poolFactory.getPool(token, quote, false);
        if (pool != address(0)) {
            require(poolFactory.isPool(pool) && IIcarusPool(pool).totalSupply() == 0, "pool already used");
            address a = IIcarusPool(pool).token0();
            address b = IIcarusPool(pool).token1();
            require((a == token && b == quote) || (a == quote && b == token), "wrong pool tokens");
        }
    }

    function graduate(address token, address curve)
        external
        returns (address pool, uint256 liquidity, uint256 quoteLiquidity)
    {
        require(msg.sender == factory && CurveBondingCurve(curve).executor() == address(this), "factory only");
        pool = poolFactory.getPool(token, quote, false);
        if (pool == address(0)) pool = poolFactory.createPool(token, quote, false);
        require(poolFactory.isPool(pool) && IIcarusPool(pool).totalSupply() == 0, "bad pool");
        address a = IIcarusPool(pool).token0();
        address b = IIcarusPool(pool).token1();
        require((a == token && b == quote) || (a == quote && b == token), "wrong pool tokens");
        IIcarusPool(pool).skim(locker);
        (, quoteLiquidity) = CurveBondingCurve(curve).releaseForGraduation(pool);
        liquidity = IIcarusPool(pool).mint(locker);
        require(liquidity > 0 && IERC20(pool).balanceOf(locker) >= liquidity, "no locked LP");
    }
}
