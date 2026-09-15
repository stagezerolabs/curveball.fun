// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24; import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol"; contract MockWETH is ERC20("Wrapped Ether","WETH"){function mint(address a,uint256 n)external{_mint(a,n);}}
