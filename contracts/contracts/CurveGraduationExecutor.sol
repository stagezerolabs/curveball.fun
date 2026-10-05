// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IIcarusFactory, IIcarusPool} from "./interfaces/IIcarus.sol";
import {CurveBondingCurve} from "./CurveBondingCurve.sol";
import {CurveLpLocker} from "./LpLocker.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Sole boundary that creates an Icarus pool and mints its LP.
contract CurveGraduationExecutor {
    address public immutable factory;
    IIcarusFactory public immutable icarusFactory;
    CurveLpLocker public immutable locker;
    address public immutable quote;

    constructor(address factory_, address icarusFactory_, address quote_, address locker_) {
        require(factory_ != address(0) && icarusFactory_ != address(0) && quote_ != address(0) && locker_ != address(0), "bad dependency");
        factory = factory_;
        icarusFactory = IIcarusFactory(icarusFactory_);
        quote = quote_;
        locker = CurveLpLocker(locker_);
    }

    function execute(address token, address curve, address creator) external returns (address pool, uint256 liquidity, uint256 quoteLiquidity) {
        require(msg.sender == factory, "factory only");
        pool = icarusFactory.getPool(token, quote, false);
        if (pool == address(0)) pool = icarusFactory.createPool(token, quote, false);
        require(icarusFactory.isPool(pool) && IIcarusPool(pool).totalSupply() == 0, "bad pool");
        address asset0 = IIcarusPool(pool).token0();
        address asset1 = IIcarusPool(pool).token1();
        require((asset0 == token && asset1 == quote) || (asset0 == quote && asset1 == token), "wrong pool tokens");
        IIcarusPool(pool).skim(address(locker));
        (, quoteLiquidity) = CurveBondingCurve(curve).releaseForGraduation(pool);
        liquidity = IIcarusPool(pool).mint(address(locker));
        require(liquidity > 0 && IERC20(pool).balanceOf(address(locker)) >= liquidity, "no locked LP");
        locker.register(pool, token, creator);
    }
}
