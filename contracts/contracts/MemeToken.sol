// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
contract MemeToken is ERC20, ERC20Permit {
    address public immutable launchpad; string public metadataURI; bool public tradingEnabled;
    constructor(string memory n,string memory s,string memory uri,uint256 supply,address lp) ERC20(n,s) ERC20Permit(n) { launchpad=lp; metadataURI=uri; _mint(lp,supply); }
    function enableTrading() external { require(msg.sender==launchpad,"launchpad only"); tradingEnabled=true; }
    function _update(address from,address to,uint256 value) internal override { if(!tradingEnabled) require(from==address(0)||to==address(0)||from==launchpad||to==launchpad,"locked until graduation"); super._update(from,to,value); }
}
