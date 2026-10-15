// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {Checkpoints} from "@openzeppelin/contracts/utils/structs/Checkpoints.sol";

/// @notice Fixed-supply launch token. No address retains mint authority.
contract CurveLauncherToken is ERC20, ERC20Permit {
    using Checkpoints for Checkpoints.Trace208;

    address public immutable curve;
    address public immutable factory;
    mapping(address => Checkpoints.Trace208) private _balanceHistory;
    string public metadataURI;
    bool public tradingEnabled;

    constructor(string memory name_, string memory symbol_, string memory uri_, uint256 supply_, address curve_, address factory_, address reserve_, uint256 reserveAmount_)
        ERC20(name_, symbol_)
        ERC20Permit(name_)
    {
        require(curve_ != address(0) && factory_ != address(0) && reserve_ != address(0) && supply_ > reserveAmount_, "bad launch");
        curve = curve_;
        factory = factory_;
        metadataURI = uri_;
        _mint(curve_, supply_ - reserveAmount_);
        if (reserveAmount_ > 0) _mint(reserve_, reserveAmount_);
    }

    function getPastBalance(address account, uint256 blockNumber) external view returns (uint256) {
        require(blockNumber < block.number, "future block");
        return _balanceHistory[account].upperLookupRecent(uint48(blockNumber));
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
        if (from != address(0)) _balanceHistory[from].push(uint48(block.number), uint208(balanceOf(from)));
        if (to != address(0) && to != from) _balanceHistory[to].push(uint48(block.number), uint208(balanceOf(to)));
    }
}
