// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script} from "forge-std/Script.sol";
import {CurveDeploy} from "./CurveDeploy.sol";
import {CurveLaunchpad} from "../contracts/CurveLaunchpad.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @notice Deploys mainnet governance and the four singletons through `CurveDeploy`.
/// @dev Run with `--account`; the broadcasting account is the deployer whose nonce predicts the
///      launchpad address. On testnet 11155931 the owner, guardian and treasury use the configured
///      testnet operator. On mainnet 4153, Curveball's dedicated keystore deploys a self-administered
///      two-day timelock, then owns the launchpad through it. The deployer can propose, execute and
///      cancel timelock operations, and serves as guardian. Protocol fees go to the pinned treasury.
contract Deploy is Script, CurveDeploy {
    uint256 internal constant MAINNET = 4_153;
    uint256 internal constant TESTNET = 11_155_931;
    address internal constant WETH = 0x4200000000000000000000000000000000000006;
    address internal constant MAINNET_ICARUS = 0xEe10C6a0f158bFEeef3d48Dc0D26130Cf6115615;
    address internal constant TESTNET_ICARUS = 0x8221dfB70c9A2dE60253dcfC58231FD529bbF4F9;
    address internal constant TESTNET_OPERATOR = 0xd07988eCBCf446b9650dC93Ed9c61Bf97F02a8d3;
    address internal constant MAINNET_DEPLOYER = 0xeEb364Ba1a9A4B6a75C41A39c4B91144a4aF156A;
    address internal constant MAINNET_TREASURY = 0x7e6B1bEfC7dd622c20961140779eF61cd9C62Ce4;
    bytes32 internal constant PROPOSER_ROLE = keccak256("PROPOSER_ROLE");
    bytes32 internal constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    uint256 internal constant LAUNCH_FEE = 0.00045 ether;
    uint256 internal constant TESTNET_TARGET = 4 ether;
    uint256 internal constant MIN_MAINNET_TIMELOCK_DELAY = 2 days;

    error UnsupportedChain(uint256 chainId);
    error Preflight(string check);

    function run() external returns (Deployment memory d) {
        Params memory p = params();
        preflight(p);
        vm.startBroadcast();
        (, address deployer,) = vm.readCallers();
        if (block.chainid == MAINNET) {
            _require(deployer == MAINNET_DEPLOYER, "unexpected mainnet deployer");
            address[] memory operators = new address[](1);
            operators[0] = MAINNET_DEPLOYER;
            TimelockController timelock =
                new TimelockController(MIN_MAINNET_TIMELOCK_DELAY, operators, operators, address(0));
            p.owner = address(timelock);
            _require(timelock.getMinDelay() == MIN_MAINNET_TIMELOCK_DELAY, "wrong timelock delay");
            _require(timelock.hasRole(PROPOSER_ROLE, deployer), "deployer lacks proposer role");
            _require(timelock.hasRole(EXECUTOR_ROLE, deployer), "deployer lacks executor role");
            _require(timelock.hasRole(DEFAULT_ADMIN_ROLE, address(timelock)), "timelock is not self-administered");
            _require(!timelock.hasRole(DEFAULT_ADMIN_ROLE, deployer), "deployer retains timelock admin role");
        }
        d = _deployCurve(deployer, p);
        vm.stopBroadcast();
    }

    function params() public view returns (Params memory p) {
        p.quoteToken = WETH;
        p.launchFee = LAUNCH_FEE;
        p.walletCapBps = 500;
        p.fees = CurveLaunchpad.FeeDefaults({feeBps: 75, creatorShareBps: 5_000, buybackShareBps: 2_500, taxCapBps: 50});
        if (block.chainid == TESTNET) {
            (p.owner, p.guardian, p.treasury) = (TESTNET_OPERATOR, TESTNET_OPERATOR, TESTNET_OPERATOR);
            p.icarusFactory = TESTNET_ICARUS;
            p.graduationTarget = TESTNET_TARGET;
        } else if (block.chainid == MAINNET) {
            p.guardian = MAINNET_DEPLOYER;
            p.treasury = MAINNET_TREASURY;
            p.icarusFactory = MAINNET_ICARUS;
            p.graduationTarget = 4 ether;
        } else {
            revert UnsupportedChain(block.chainid);
        }
    }

    /// @notice Checks external dependencies and pinned policy before the timelock is deployed.
    function preflight(Params memory p) public view {
        _require(WETH.code.length != 0, "WETH has no code");
        _require(p.icarusFactory.code.length != 0, "Icarus factory has no code");
        // Icarus pause blocks swaps only. Launches, pool creation and liquidity seeding remain usable.
        _require(p.graduationTarget >= 4 ether, "graduation target below MIN_TARGET");
        _require(p.walletCapBps == 500, "wallet cap must be 5 percent");
        if (block.chainid != MAINNET) return;

        _require(p.guardian == MAINNET_DEPLOYER, "unexpected mainnet guardian");
        _require(p.treasury == MAINNET_TREASURY, "unexpected mainnet treasury");
    }

    function _require(bool ok, string memory check) internal pure {
        if (!ok) revert Preflight(check);
    }
}
