// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {IStork} from "../../contracts/interfaces/IStork.sol";

contract MockStork is IStork {
    uint64 public timestampNs;
    int192 public price;
    bool public unavailable;

    constructor() {
        timestampNs = uint64(block.timestamp * 1e9);
        price = 2_000 ether;
    }

    function setPrice(int192 value) external {
        price = value;
        timestampNs = uint64(block.timestamp * 1e9);
    }

    function setTimestamp(uint64 value) external {
        timestampNs = value;
    }

    function setUnavailable(bool value) external {
        unavailable = value;
    }

    function getTemporalNumericValueV1(bytes32 id) external view returns (TemporalNumericValue memory) {
        require(!unavailable, "oracle unavailable");
        require(id == 0x7965e1bfc07a34caf0c3aa8146b200264fbb7a0eb85b1d3b1fdceecffd736b02, "unknown feed");
        return TemporalNumericValue(timestampNs, price);
    }
}
