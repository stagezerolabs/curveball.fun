// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";

/// @notice Fixed-supply launch token. No address retains mint authority.
contract CurveLauncherToken is ERC20, ERC20Permit {
    address public immutable curve;
    address public immutable factory;
    string public metadataURI;
    bool public tradingEnabled;

    constructor(string memory name_, string memory symbol_, string memory uri_, uint256 supply_, address curve_, address factory_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        require(curve_ != address(0) && factory_ != address(0) && supply_ > 0, "bad launch");
        curve = curve_;
        factory = factory_;
        metadataURI = uri_;
        _mint(curve_, supply_);
    }

    function enableTrading() external {
        require(msg.sender == factory && !tradingEnabled, "factory only");
        tradingEnabled = true;
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!tradingEnabled) {
            require(from == address(0) || to == address(0) || from == curve || to == curve, "locked until graduation");
        }
        super._update(from, to, value);
    }
}
