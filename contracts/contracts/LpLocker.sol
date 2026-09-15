// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IIcarusPool} from "./interfaces/IIcarus.sol";
contract LpLocker { using SafeERC20 for IERC20; address public launchpad; address public immutable owner; address public immutable treasury; uint16 public immutable creatorShareBps; mapping(address=>address) public creatorOf;
 event FeesClaimed(address indexed pool,uint256 creator0,uint256 creator1,uint256 treasury0,uint256 treasury1);
 constructor(address t,uint16 share){require(share<=10_000);owner=msg.sender;treasury=t;creatorShareBps=share;}
 function setLaunchpad(address l) external {require(msg.sender==owner,"owner only");require(launchpad==address(0)&&l!=address(0),"already set");launchpad=l;}
 function register(address pool,address creator) external {require(msg.sender==launchpad&&creatorOf[pool]==address(0),"not launchpad");creatorOf[pool]=creator;}
 function claim(address pool,address token0,address token1) external { (uint256 a,uint256 b)=IIcarusPool(pool).claimFees(); uint256 ca=a*creatorShareBps/10_000;uint256 cb=b*creatorShareBps/10_000; if(ca>0)IERC20(token0).safeTransfer(creatorOf[pool],ca);if(a>ca)IERC20(token0).safeTransfer(treasury,a-ca);if(cb>0)IERC20(token1).safeTransfer(creatorOf[pool],cb);if(b>cb)IERC20(token1).safeTransfer(treasury,b-cb);emit FeesClaimed(pool,ca,cb,a-ca,b-cb); }
}
