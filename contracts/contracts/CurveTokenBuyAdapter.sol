// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {CurveLaunchFactory} from "./CurveLaunchFactory.sol";
import {CurveBondingCurve} from "./CurveBondingCurve.sol";
import {FixedRateVenue} from "./mocks/FixedRateVenue.sol";

/// @notice Testnet beta adapter for one fixed mUSDC -> mWETH venue and registered curves.
contract CurveTokenBuyAdapter is ReentrancyGuard {
    using SafeERC20 for IERC20;
    address public immutable factory;
    address public immutable input;
    address public immutable quote;
    address public immutable venue;

    event TokenFundedBuy(address indexed token, address indexed buyer, uint256 inputSpent,
        uint256 quoteReceived, uint256 quoteSpent, uint256 tokensReceived);

    constructor(address factory_, address input_, address quote_, address venue_) {
        require(factory_ != address(0) && input_ != address(0) && quote_ != address(0) && venue_ != address(0), "bad dependency");
        require(factory_.code.length > 0 && venue_.code.length > 0, "missing dependency");
        require(CurveLaunchFactory(factory_).quote() == quote_, "factory quote mismatch");
        require(FixedRateVenue(venue_).input() == input_ && FixedRateVenue(venue_).quote() == quote_, "venue mismatch");
        factory = factory_;
        input = input_;
        quote = quote_;
        venue = venue_;
    }

    function buyWithToken(address token, uint256 maxInput, uint256 minQuoteOut, uint256 minTokensOut, uint256 deadline)
        external nonReentrant returns (uint256 tokensOut)
    {
        require(block.timestamp <= deadline && maxInput > 0 && minQuoteOut > 0 && minTokensOut > 0, "bad buy");
        CurveLaunchFactory registry = CurveLaunchFactory(factory);
        require(registry.tokenBuyAdapter() == address(this) && registry.tokenBuyEnabled(), "adapter disabled");
        (address curve,,,,,,) = registry.market(token);
        require(curve != address(0), "unknown market");

        uint256 inputBefore = IERC20(input).balanceOf(address(this));
        uint256 quoteBefore = IERC20(quote).balanceOf(address(this));
        IERC20(input).safeTransferFrom(msg.sender, address(this), maxInput);
        require(IERC20(input).balanceOf(address(this)) - inputBefore == maxInput, "unsupported input token");
        IERC20(input).forceApprove(venue, maxInput);
        uint256 reported = FixedRateVenue(venue).swapExactInput(maxInput, minQuoteOut, address(this));
        IERC20(input).forceApprove(venue, 0);
        uint256 quoteReceived = IERC20(quote).balanceOf(address(this)) - quoteBefore;
        require(quoteReceived == reported && quoteReceived >= minQuoteOut, "quote output mismatch");

        IERC20(quote).forceApprove(curve, quoteReceived);
        tokensOut = CurveBondingCurve(curve).buyTokensFor(msg.sender, quoteReceived, minTokensOut, deadline);
        IERC20(quote).forceApprove(curve, 0);
        uint256 refund = IERC20(quote).balanceOf(address(this)) - quoteBefore;
        if (refund > 0) IERC20(quote).safeTransfer(msg.sender, refund);
        require(IERC20(input).balanceOf(address(this)) == inputBefore, "input retained");
        emit TokenFundedBuy(token, msg.sender, maxInput, quoteReceived, quoteReceived - refund, tokensOut);
    }
}
