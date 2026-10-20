// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Fixture} from "../Fixture.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockIcarusPool} from "../mocks/MockIcarus.sol";
import {CurveLaunchpad} from "../../contracts/CurveLaunchpad.sol";
import {CurveToken} from "../../contracts/CurveToken.sol";

contract DebugLockTest is Fixture {
    function test_debugTransferLock() public {
        address token = _launch(alice, 0, 0);
        _buy(bob, token, 100 ether);

        address pool = icarus.createPool(token, address(weth), false);
        address poolViaGet = icarus.getPool(token, address(weth), false);

        emit log_named_address("token        ", token);
        emit log_named_address("pool created ", pool);
        emit log_named_address("pool via get ", poolViaGet);
        emit log_named_uint("bob balance  ", IERC20(token).balanceOf(bob));
        emit log_named_uint("launchpad bal", IERC20(token).balanceOf(address(launchpad)));
        emit log_named_uint("unlocked     ", CurveToken(token).unlocked() ? 1 : 0);

        // Try transferring to a random EOA (definitely not the launchpad).
        address randomEoa = makeAddr("randomEoa");
        vm.prank(bob);
        try IERC20(token).transfer(randomEoa, 1) returns (bool ok) {
            emit log_named_uint("transfer to EOA SUCCEEDED? ", ok ? 1 : 0);
        } catch {
            emit log("transfer to EOA REVERTED (lock works)");
        }

        // Now try transferring to the pool address we created.
        vm.prank(bob);
        try IERC20(token).transfer(pool, 1) returns (bool ok2) {
            emit log_named_uint("transfer to POOL SUCCEEDED? ", ok2 ? 1 : 0);
        } catch {
            emit log("transfer to POOL REVERTED (lock works)");
        }

        emit log_named_uint("pool token bal after", IERC20(token).balanceOf(pool));
    }
}
