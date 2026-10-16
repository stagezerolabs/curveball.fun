// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {CurveLaunchFactory} from "./CurveLaunchFactory.sol";

/// @notice Owns one factory. Dot retains full authority; the fee admin can change only its trading fee.
contract CurveFactoryFeeController is Ownable2Step {
    CurveLaunchFactory public immutable factory;
    address public feeAdmin;

    event FeeAdminUpdated(address indexed previousAdmin, address indexed newAdmin);

    constructor(address factory_, address superAdmin_, address feeAdmin_) Ownable(superAdmin_) {
        require(factory_.code.length > 0 && feeAdmin_ != address(0), "bad controller dependency");
        factory = CurveLaunchFactory(factory_);
        feeAdmin = feeAdmin_;
    }

    modifier onlyFeeEditor() {
        require(msg.sender == feeAdmin || msg.sender == owner(), "not fee editor");
        _;
    }

    function setTradingFeeBps(uint16 newFee) external onlyFeeEditor {
        require(factory.owner() == address(this), "controller is not factory owner");
        factory.setFeeDefaults(
            newFee, factory.creatorShareBps(), factory.buybackShareBps(), factory.creatorTaxCapBps(), factory.treasury()
        );
    }

    function setFeeAdmin(address newAdmin) external onlyOwner {
        emit FeeAdminUpdated(feeAdmin, newAdmin);
        feeAdmin = newAdmin;
    }

    function acceptFactoryOwnership() external onlyOwner {
        factory.acceptOwnership();
    }

    function transferFactoryOwnership(address newOwner) external onlyOwner {
        factory.transferOwnership(newOwner);
    }

    function renounceOwnership() public view override onlyOwner {
        revert("renounce disabled");
    }

    /// @notice Dot can exercise any factory-owner capability, including rescue and full policy updates.
    function executeFactory(bytes calldata data) external onlyOwner returns (bytes memory result) {
        require(factory.owner() == address(this), "controller is not factory owner");
        (bool success, bytes memory response) = address(factory).call(data);
        if (!success) {
            assembly { revert(add(response, 32), mload(response)) }
        }
        return response;
    }
}
