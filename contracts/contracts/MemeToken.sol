// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Permit} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Permit.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface ILaunchpadOwner {
    function owner() external view returns (address);
}

contract MemeToken is ERC20, ERC20Permit {
    using SafeERC20 for IERC20;
    address public immutable launchpad;
    string public metadataURI;
    bool public tradingEnabled;
    event TokensRescued(address indexed token, uint256 amount, address indexed recipient);
    event NativeRescued(uint256 amount, address indexed recipient);

    constructor(string memory n, string memory s, string memory uri, uint256 supply, address lp)
        ERC20(n, s)
        ERC20Permit(n)
    {
        require(lp != address(0), "bad launchpad");
        launchpad = lp;
        metadataURI = uri;
        _mint(lp, supply);
    }

    function enableTrading() external {
        require(msg.sender == launchpad, "launchpad only");
        tradingEnabled = true;
    }

    function rescueTokens(address token, uint256 amount) external {
        address recipient = ILaunchpadOwner(launchpad).owner();
        require(msg.sender == recipient, "owner only");
        IERC20(token).safeTransfer(recipient, amount);
        emit TokensRescued(token, amount, recipient);
    }

    function rescueNative(uint256 amount) external {
        address recipient = ILaunchpadOwner(launchpad).owner();
        require(msg.sender == recipient, "owner only");
        (bool success,) = payable(recipient).call{value: amount}("");
        require(success, "native rescue failed");
        emit NativeRescued(amount, recipient);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (!tradingEnabled) {
            require(
                from == address(0) || to == address(0) || from == launchpad || to == launchpad,
                "locked until graduation"
            );
        }
        super._update(from, to, value);
    }
}
