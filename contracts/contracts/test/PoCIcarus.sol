// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IIcarusFactory, IIcarusPool} from "../interfaces/IIcarus.sol";

// Solidly-style pool whose accrued-fee figure can be set, to emulate a pool
// whose creator wash-traded it into a large fee balance.
contract PoCFeePool is ERC20("LP", "LP"), IIcarusPool {
    address public a;
    address public b;
    uint256 r0;
    uint256 r1;
    uint256 public f0; // fees reported by claimFees()
    uint256 public f1;
    uint256 public p0; // fees actually delivered by claimFees()
    uint256 public p1;

    constructor(address x, address y) {
        a = x;
        b = y;
    }

    /// A pool may report more than it delivers -- callers must not trust the returned tuple.
    function setFees(uint256 report0, uint256 report1, uint256 pay0, uint256 pay1) external {
        f0 = report0;
        f1 = report1;
        p0 = pay0;
        p1 = pay1;
    }

    function totalSupply() public view override(ERC20, IIcarusPool) returns (uint256) {
        return super.totalSupply();
    }

    function token0() external view returns (address) {
        return a;
    }

    function token1() external view returns (address) {
        return b;
    }

    function getReserves() external view returns (uint256, uint256, uint256) {
        return (r0, r1, 0);
    }

    function mint(address to) external returns (uint256 l) {
        uint256 x = IERC20(a).balanceOf(address(this)) - r0;
        uint256 y = IERC20(b).balanceOf(address(this)) - r1;
        l = _sqrt(x * y);
        _mint(to, l);
        r0 += x;
        r1 += y;
    }

    function skim(address to) external {
        IERC20(a).transfer(to, IERC20(a).balanceOf(address(this)) - r0);
        IERC20(b).transfer(to, IERC20(b).balanceOf(address(this)) - r1);
    }

    function claimFees() external returns (uint256 x, uint256 y) {
        (x, y) = (f0, f1);
        (f0, f1) = (0, 0);
        if (p0 > 0) IERC20(a).transfer(msg.sender, p0);
        if (p1 > 0) IERC20(b).transfer(msg.sender, p1);
        (p0, p1) = (0, 0);
    }

    function _sqrt(uint256 y) private pure returns (uint256 z) {
        z = y;
        uint256 x = y / 2 + 1;
        while (x < z) {
            z = x;
            x = (y / x + x) / 2;
        }
    }
}

contract PoCFactory is IIcarusFactory {
    mapping(bytes32 => address) p;
    mapping(address => bool) public override isPool;

    function isPaused() external pure returns (bool) { return false; }

    function getPool(address a, address b, bool) external view returns (address) {
        return p[_k(a, b)];
    }

    function createPool(address a, address b, bool) external returns (address x) {
        x = address(new PoCFeePool(a, b));
        p[_k(a, b)] = x;
        isPool[x] = true;
    }

    function _k(address a, address b) private pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }
}

// Emulates the Icarus factory being paused (it exposes isPaused()/pauser()), and then unpaused.
contract PoCBrokenFactory is IIcarusFactory {
    mapping(bytes32 => address) p;
    mapping(address => bool) public override isPool;
    bool public broken = true;

    function isPaused() external view returns (bool) { return broken; }

    function setBroken(bool v) external {
        broken = v;
    }

    function getPool(address x, address y, bool) external view returns (address) {
        return p[_k(x, y)];
    }

    function createPool(address x, address y, bool) external returns (address z) {
        require(!broken, "PAUSED");
        z = address(new PoCFeePool(x, y));
        p[_k(x, y)] = z;
        isPool[z] = true;
    }

    function _k(address x, address y) private pure returns (bytes32) {
        return x < y ? keccak256(abi.encode(x, y)) : keccak256(abi.encode(y, x));
    }
}
