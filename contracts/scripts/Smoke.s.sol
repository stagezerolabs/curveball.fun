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

/// @dev The recorded testnet launchpad still takes reserveBps in its launch call.
interface ILegacyLaunchpad {
    function launch(
        CurveLaunchpad.Metadata calldata meta,
        uint16 taxBps,
        uint16 reserveBps,
        uint256 maxSpend,
        uint256 minOut
    ) external returns (address token, uint256 tokensOut);
}

/// @notice Broadcasts only a smoke-token launch and one small first buy on RISE testnet.
/// @dev Full sellout and graduation are simulated in test/fork/Smoke.fork.t.sol.
contract Smoke is Script {
    using SafeERC20 for IERC20;

    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    uint256 internal constant FIRST_BUY = 0.003 ether;

    function run() external {
        require(block.chainid == 11_155_931, "RISE testnet only");
        string memory record = vm.readFile(string.concat(vm.projectRoot(), "/../deployments/11155931/curveball.json"));
        CurveLaunchpad launchpad = CurveLaunchpad(vm.parseJsonAddress(record, ".launchpad"));
        require(launchpad.quoteToken() == WETH, "unexpected quote token");
        bool legacy = _isLegacy(launchpad);

        vm.startBroadcast();
        (, address broadcaster,) = vm.readCallers();
        uint256 maxPayment = launchpad.launchFee() + FIRST_BUY;
        IWETH(WETH).deposit{value: maxPayment}();
        IERC20(WETH).forceApprove(address(launchpad), maxPayment);

        (address token, uint256 tokensOut) = _launchAndBuy(launchpad, broadcaster, legacy);

        uint256 unspent = IERC20(WETH).balanceOf(broadcaster);
        if (unspent != 0) IWETH(WETH).withdraw(unspent);
        vm.stopBroadcast();

        console2.log("smoke token", token);
        console2.log("tokens bought", tokensOut);
    }

    function _launchAndBuy(CurveLaunchpad launchpad, address broadcaster, bool legacy)
        internal
        returns (address token, uint256 tokensOut)
    {
        // my SMOKE token config
        CurveLaunchpad.Metadata memory meta = CurveLaunchpad.Metadata(
            "Curved Road", "ROAD", "ipfs://bafkreie7vw53rfslxv4kuiqsjxqydbetn3koxiohf72bmjvplp6oofgbzm"
        );
        (token, tokensOut) = legacy
            ? ILegacyLaunchpad(address(launchpad)).launch(meta, 0, 0, FIRST_BUY, 1)
            : launchpad.launch(meta, 0, FIRST_BUY, 1);
        require(tokensOut != 0 && launchpad.held(token, broadcaster) == tokensOut, "first buy");
        require(launchpad.poolOf(token) == address(0), "unexpected graduation");
    }

    function _isLegacy(CurveLaunchpad launchpad) internal view returns (bool) {
        (bool ok, bytes memory data) = address(launchpad).staticcall(abi.encodeWithSignature("walletCapBps()"));
        if (ok && data.length == 32) {
            require(abi.decode(data, (uint16)) == 500, "unsupported wallet cap");
            return false;
        }
        require(launchpad.CURVE_SUPPLY() == 800_000 ether, "unsupported legacy release");
        return true;
    }
}
