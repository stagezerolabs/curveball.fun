// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {CurveLaunchpad} from "../contracts/CurveLaunchpad.sol";

interface IWETH {
    function deposit() external payable;
    function withdraw(uint256 amount) external;
}

/// @notice Optional testnet-only oracle launch exercise. Never used by mainnet deployment targets.
contract Smoke is Script {
    using SafeERC20 for IERC20;

    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    uint256 internal constant FIRST_BUY = 0.003 ether;

    function run() external {
        require(block.chainid == 11_155_931, "RISE testnet only");
        string memory record = vm.readFile(string.concat(
            vm.projectRoot(), "/../deployments/11155931/curveball-oracle-v3.json"
        ));
        CurveLaunchpad launchpad = CurveLaunchpad(vm.parseJsonAddress(record, ".launchpad"));
        require(launchpad.quoteToken() == WETH, "unexpected quote token");

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();
        uint256 fee = _quotedFee(launchpad);
        uint256 feeCap = (fee * 10_100 + 9_999) / 10_000;
        uint256 maxPayment = feeCap + FIRST_BUY;
        uint256 startingWeth = IERC20(WETH).balanceOf(broadcaster);
        IWETH(WETH).deposit{value: maxPayment}();
        IERC20(WETH).forceApprove(address(launchpad), maxPayment);
        (address token, uint256 tokensOut) = _launchAndBuy(launchpad, broadcaster, feeCap);
        uint256 unspent = IERC20(WETH).balanceOf(broadcaster) - startingWeth;
        if (unspent != 0) IWETH(WETH).withdraw(unspent);
        vm.stopBroadcast();
        console2.log("smoke token", token);
        console2.log("tokens bought", tokensOut);
    }

    function _launchAndBuy(CurveLaunchpad launchpad, address broadcaster, uint256 feeCap)
        internal
        returns (address token, uint256 tokensOut)
    {
        CurveLaunchpad.Metadata memory meta = CurveLaunchpad.Metadata(
            "Curved Road", "ROAD", "ipfs://bafkreie7vw53rfslxv4kuiqsjxqydbetn3koxiohf72bmjvplp6oofgbzm"
        );
        (token, tokensOut) = launchpad.launch(meta, 0, FIRST_BUY, 1, feeCap);
        require(tokensOut != 0 && launchpad.held(token, broadcaster) == tokensOut, "first buy");
        require(launchpad.poolOf(token) == address(0), "unexpected graduation");
    }

    function _quotedFee(CurveLaunchpad launchpad) internal view returns (uint256 fee) {
        (fee,,) = launchpad.quoteLaunchFee();
    }
}
