// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

interface ICheckpointToken is IERC20 {
    function getPastBalance(address account, uint256 blockNumber) external view returns (uint256);
    function totalSupply() external view returns (uint256);
}

/// @notice Fixed launch reserves. Creators choose rounds; past balances determine payments.
contract CurveHolderReserve is ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Launch {
        address creator;
        address curve;
        address pool;
        address vault;
        uint256 reserve;
        uint256 committed;
        uint256 graduationBlock;
        uint256 roundCount;
    }

    struct Round {
        uint256 snapshotBlock;
        uint256 amount;
        uint256 eligibleSupply;
    }

    address public immutable factory;
    mapping(address => Launch) public launches;
    mapping(address => mapping(uint256 => Round)) public rounds;
    mapping(address => mapping(uint256 => mapping(address => bool))) public claimed;

    event ReserveRegistered(address indexed token, address indexed creator, uint256 amount);
    event GraduationRecorded(address indexed token, address indexed pool, uint256 blockNumber);
    event RoundCreated(address indexed token, uint256 indexed roundId, uint256 snapshotBlock, uint256 amount, uint256 eligibleSupply);
    event Claimed(address indexed token, uint256 indexed roundId, address indexed holder, uint256 amount);

    constructor(address factory_) {
        require(factory_ != address(0), "bad factory");
        factory = factory_;
    }

    function register(address token, address creator, address curve, address vault, uint256 amount) external {
        require(msg.sender == factory && token != address(0) && creator != address(0) && curve != address(0) && vault != address(0), "factory only");
        require(launches[token].creator == address(0) && IERC20(token).balanceOf(address(this)) >= amount, "bad reserve");
        launches[token] = Launch(creator, curve, address(0), vault, amount, 0, 0, 0);
        emit ReserveRegistered(token, creator, amount);
    }

    function recordGraduation(address token, address pool) external {
        Launch storage launch = launches[token];
        require(msg.sender == factory && launch.creator != address(0) && launch.graduationBlock == 0 && pool != address(0), "bad graduation");
        launch.pool = pool;
        launch.graduationBlock = block.number;
        emit GraduationRecorded(token, pool, block.number);
    }

    function createRound(address token, uint256 snapshotBlock, uint256 amount) external returns (uint256 roundId) {
        Launch storage launch = launches[token];
        require(msg.sender == launch.creator && launch.creator != address(0), "creator only");
        require(launch.graduationBlock != 0 && snapshotBlock >= launch.graduationBlock && snapshotBlock < block.number, "bad snapshot");
        require(amount > 0 && amount <= launch.reserve - launch.committed, "bad amount");
        ICheckpointToken asset = ICheckpointToken(token);
        uint256 excluded = asset.getPastBalance(address(this), snapshotBlock)
            + asset.getPastBalance(launch.curve, snapshotBlock)
            + asset.getPastBalance(launch.pool, snapshotBlock)
            + asset.getPastBalance(launch.vault, snapshotBlock);
        uint256 eligible = asset.totalSupply() - excluded;
        require(eligible > 0, "no holders");
        roundId = launch.roundCount++;
        launch.committed += amount;
        rounds[token][roundId] = Round(snapshotBlock, amount, eligible);
        emit RoundCreated(token, roundId, snapshotBlock, amount, eligible);
    }

    function claimable(address token, uint256 roundId, address holder) public view returns (uint256) {
        Launch storage launch = launches[token];
        if (roundId >= launch.roundCount || claimed[token][roundId][holder] || holder == address(0)
            || holder == address(this) || holder == launch.curve || holder == launch.pool || holder == launch.vault) return 0;
        Round storage round = rounds[token][roundId];
        return round.amount * ICheckpointToken(token).getPastBalance(holder, round.snapshotBlock) / round.eligibleSupply;
    }

    function claim(address token, uint256 roundId, address holder) external nonReentrant returns (uint256 amount) {
        amount = claimable(token, roundId, holder);
        require(amount > 0, "nothing to claim");
        claimed[token][roundId][holder] = true;
        IERC20(token).safeTransfer(holder, amount);
        emit Claimed(token, roundId, holder, amount);
    }
}
