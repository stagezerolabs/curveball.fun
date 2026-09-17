// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {MemeToken} from "./MemeToken.sol";
import {LpLocker} from "./LpLocker.sol";
import {IIcarusFactory, IIcarusPool} from "./interfaces/IIcarus.sol";

contract CurveballLaunchpad is ReentrancyGuard {
    using SafeERC20 for IERC20;
    using SafeCast for uint256;

    struct Market {
        address creator;
        uint128 vt;
        uint128 vq;
        uint128 realQ;
        uint128 sold;
        bool graduated;
        bool pending;
        address pool;
    }
    IERC20 public immutable quote;
    IIcarusFactory public immutable factory;
    LpLocker public immutable locker;
    uint256 public immutable supply;
    uint256 public immutable curveSupply;
    uint256 public immutable initialVQ;
    mapping(address => Market) public markets;
    mapping(address => uint256) public creatorNonce;
    event TokenCreated(address indexed token, address indexed creator, string name, string symbol, string uri);
    event Trade(
        address indexed token,
        address indexed trader,
        bool isBuy,
        uint256 quoteAmount,
        uint256 tokenAmount,
        uint256 vQAfter,
        uint256 vTAfter,
        uint256 soldAfter
    );
    event GraduationDeferred(address indexed token, bytes reason);
    event Graduated(
        address indexed token, address indexed pool, uint256 tokenLiquidity, uint256 quoteLiquidity, uint256 liquidity
    );

    constructor(address q, address f, address l, uint256 s, uint256 cs, uint256 vq) {
        require(s > cs && vq > 0 && s <= type(uint128).max && vq <= type(uint128).max, "bad curve");
        quote = IERC20(q);
        factory = IIcarusFactory(f);
        locker = LpLocker(l);
        supply = s;
        curveSupply = cs;
        initialVQ = vq;
    }

    function createToken(string calldata n, string calldata s, string calldata uri) external returns (address token) {
        bytes32 salt = keccak256(abi.encode(msg.sender, creatorNonce[msg.sender]++, block.chainid));
        token = address(new MemeToken{salt: salt}(n, s, uri, supply, address(this)));
        markets[token] = Market(msg.sender, supply.toUint128(), initialVQ.toUint128(), 0, 0, false, false, address(0));
        emit TokenCreated(token, msg.sender, n, s, uri);
    }

    function quoteBuy(address token, uint256 quoteIn) public view returns (uint256 out) {
        Market memory m = markets[token];
        uint256 k = uint256(m.vt) * m.vq;
        uint256 newVt = (k + uint256(m.vq) + quoteIn - 1) / (uint256(m.vq) + quoteIn);
        out = uint256(m.vt) - newVt;
        if (uint256(m.sold) + out > curveSupply) out = curveSupply - m.sold;
    }

    function quoteSell(address token, uint256 amount) public view returns (uint256 out) {
        Market memory m = markets[token];
        uint256 k = uint256(m.vt) * m.vq;
        uint256 newVq = (k + uint256(m.vt) + amount - 1) / (uint256(m.vt) + amount);
        out = uint256(m.vq) - newVq;
    }

    function buyTokens(address token, uint256 quoteIn, uint256 minOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 out)
    {
        require(block.timestamp <= deadline, "expired");
        Market storage m = markets[token];
        require(m.creator != address(0) && !m.graduated && !m.pending && quoteIn > 0, "inactive");
        uint256 k = uint256(m.vt) * m.vq;
        uint256 newVt = k / (uint256(m.vq) + quoteIn);
        if (k % (uint256(m.vq) + quoteIn) > 0) newVt++;
        out = uint256(m.vt) - newVt;
        uint256 used = quoteIn;
        if (uint256(m.sold) + out >= curveSupply) {
            out = curveSupply - m.sold;
            newVt = uint256(m.vt) - out;
            uint256 newVq = (k + newVt - 1) / newVt;
            used = newVq - m.vq;
            m.vq = newVq.toUint128();
        } else {
            m.vq += quoteIn.toUint128();
        }
        require(out >= minOut && out > 0, "slippage");
        quote.safeTransferFrom(msg.sender, address(this), quoteIn);
        if (quoteIn > used) quote.safeTransfer(msg.sender, quoteIn - used);
        m.vt = newVt.toUint128();
        m.sold += out.toUint128();
        m.realQ += used.toUint128();
        IERC20(token).safeTransfer(msg.sender, out);
        emit Trade(token, msg.sender, true, used, out, m.vq, m.vt, m.sold);
        if (m.sold == curveSupply) {
            try this.graduateExternal(token) {}
            catch (bytes memory reason) {
                m.pending = true;
                emit GraduationDeferred(token, reason);
            }
        }
    }

    function sellTokens(address token, uint256 amount, uint256 minOut, uint256 deadline)
        external
        nonReentrant
        returns (uint256 out)
    {
        require(block.timestamp <= deadline, "expired");
        Market storage m = markets[token];
        // Deliberately reachable while `m.pending`: a market whose graduation keeps reverting must not
        // trap holders. Selling stays solvent regardless, because `m.vq == initialVQ + m.realQ` holds on
        // every path, so `out` can never exceed this market's own quote balance.
        require(m.creator != address(0) && !m.graduated && amount <= m.sold, "inactive");
        uint256 k = uint256(m.vt) * m.vq;
        uint256 newVt = uint256(m.vt) + amount;
        uint256 newVq = (k + newVt - 1) / newVt;
        out = uint256(m.vq) - newVq;
        require(out >= minOut && out <= m.realQ, "slippage");
        IERC20(token).safeTransferFrom(msg.sender, address(this), amount);
        m.vt = newVt.toUint128();
        m.vq = newVq.toUint128();
        m.sold -= amount.toUint128();
        m.realQ -= out.toUint128();
        // The curve is no longer full, so it is no longer awaiting graduation. Clearing this reopens
        // buying, and the next buy that refills the curve retries graduation on its own.
        if (m.pending && m.sold < curveSupply) m.pending = false;
        quote.safeTransfer(msg.sender, out);
        emit Trade(token, msg.sender, false, out, amount, m.vq, m.vt, m.sold);
    }

    function graduate(address token) external nonReentrant {
        Market storage m = markets[token];
        require(m.sold == curveSupply && !m.graduated, "not ready");
        m.pending = false;
        _graduate(token, m);
    }

    function graduateExternal(address token) external {
        require(msg.sender == address(this));
        Market storage m = markets[token];
        _graduate(token, m);
    }

    function _graduate(address token, Market storage m) private {
        address pool = factory.getPool(token, address(quote), false);
        if (pool == address(0)) pool = factory.createPool(token, address(quote), false);
        require(factory.isPool(pool) && IIcarusPool(pool).totalSupply() == 0, "bad pool");
        MemeToken(token).enableTrading();
        IIcarusPool(pool).skim(address(locker));
        uint256 tokenL = IERC20(token).balanceOf(address(this));
        uint256 quoteL = m.realQ;
        require(tokenL > 0 && quoteL > 1_000_000 / tokenL, "liquidity too small to graduate");
        IERC20(token).safeTransfer(pool, tokenL);
        quote.safeTransfer(pool, quoteL);
        uint256 liq = IIcarusPool(pool).mint(address(locker));
        require(liq > 0, "no liquidity");
        locker.register(pool, m.creator);
        m.realQ = 0;
        m.graduated = true;
        m.pool = pool;
        emit Graduated(token, pool, tokenL, quoteL, liq);
    }
}
