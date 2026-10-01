// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {CurveBondingCurve} from "./CurveBondingCurve.sol";
import {CurveLauncherToken} from "./CurveLauncherToken.sol";

/// @notice Deploys a curve first, then mints its fixed token supply directly to it.
contract CurveLaunchDeployer {
    address public immutable factory;

    struct LaunchParams {
        string name;
        string symbol;
        string uri;
        address quote;
        uint256 supply;
        uint256 curveSupply;
        uint256 initialVQ;
        address escrow;
        address vault;
        address executor;
        CurveBondingCurve.Policy policy;
    }

    constructor(address factory_) {
        require(factory_ != address(0), "bad factory");
        factory = factory_;
    }

    function deployLaunch(bytes32 salt, LaunchParams calldata p) external returns (address token, address curve) {
        require(msg.sender == factory, "factory only");
        curve = address(new CurveBondingCurve{salt: salt}(
            factory, p.quote, p.escrow, p.vault, p.executor, p.supply, p.curveSupply, p.initialVQ, p.policy
        ));
        token = address(
            new CurveLauncherToken{salt: keccak256(abi.encode(salt, "token"))}(
                p.name, p.symbol, p.uri, p.supply, curve, factory
            )
        );
        CurveBondingCurve(curve).bindToken(token);
    }
}
