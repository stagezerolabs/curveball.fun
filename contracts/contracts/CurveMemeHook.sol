// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CurveFeeEscrow} from "./CurveFeeEscrow.sol";
import {CurveBuybackVault} from "./CurveBuybackVault.sol";

interface IHookFactory {
    function market(address token) external view returns (
        address curve, address creator, uint16 feeBps, uint16 creatorShareBps,
        uint16 buybackShareBps, uint16 creatorTaxBps, address treasury
    );
}

interface IHookLocker {
    function tokenOfPool(address pool) external view returns (address);
}

/// @notice Routes fees claimed by the LP-holding locker under the launch snapshot.
contract CurveMemeHook {
    using SafeERC20 for IERC20;
    address public immutable factory;
    address public immutable locker;
    address public immutable quote;
    CurveFeeEscrow public immutable escrow;
    CurveBuybackVault public immutable vault;

    event PoolFeesRouted(address indexed token, address indexed pool, address indexed asset, uint256 amount);

    constructor(address factory_, address locker_, address quote_, address escrow_, address vault_) {
        require(factory_ != address(0) && locker_ != address(0) && quote_ != address(0) && escrow_ != address(0) && vault_ != address(0), "bad dependency");
        factory = factory_;
        locker = locker_;
        quote = quote_;
        escrow = CurveFeeEscrow(escrow_);
        vault = CurveBuybackVault(vault_);
    }

    function route(address pool, address token, address asset0, uint256 amount0, address asset1, uint256 amount1) external {
        require(msg.sender == locker && IHookLocker(locker).tokenOfPool(pool) == token, "unregistered pool");
        require((asset0 == token && asset1 == quote) || (asset0 == quote && asset1 == token), "wrong assets");
        _routeAsset(pool, token, asset0, amount0);
        _routeAsset(pool, token, asset1, amount1);
    }

    function _routeAsset(address pool, address token, address asset, uint256 amount) private {
        if (amount == 0) return;
        (address curve, address creator,, uint16 creatorShare, uint16 buybackShare,, address treasury) = IHookFactory(factory).market(token);
        require(curve != address(0) && creator != address(0) && treasury != address(0), "unknown market");
        require(IERC20(asset).balanceOf(address(this)) >= amount, "unbacked claim");
        uint256 creatorAmount = amount * creatorShare / 10_000;
        uint256 buybackAmount = amount * buybackShare / 10_000;
        uint256 protocolAmount = amount - creatorAmount - buybackAmount;
        uint256 escrowAmount = creatorAmount + protocolAmount;
        if (escrowAmount > 0) IERC20(asset).safeTransfer(address(escrow), escrowAmount);
        if (creatorAmount > 0) escrow.credit(token, asset, creator, creatorAmount);
        if (protocolAmount > 0) escrow.credit(token, asset, treasury, protocolAmount);
        if (buybackAmount > 0) {
            IERC20(asset).safeTransfer(address(vault), buybackAmount);
            if (asset == quote) vault.creditQuote(token, buybackAmount);
            else vault.creditMeme(token, buybackAmount);
        }
        emit PoolFeesRouted(token, pool, asset, amount);
    }
}
