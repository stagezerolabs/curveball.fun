# Perp-backed launches: product scope

Status: design draft, 2026-11-17. No contract, deployment, or live trading change is authorized by this document.

## Product promise

A creator can launch a token with a published, enforceable minimum USDC redemption value and a separate, isolated perpetual position on RISEx. Holders can burn tokens for the published USDC floor. Realized perp profits can raise that floor after USDC actually reaches the reserve. A losing or liquidated position cannot spend the floor reserve.

The token's market price can move above or below the redemption value. “Floor” means the amount a holder can redeem from the reserve under the contract rules, not an Icarus swap price, guaranteed execution price, or protection against USDC, chain, or contract failure.

This is a new launch type. Existing Curveball tokens and the ordinary WETH launch flow are unchanged.

## Why a new launch type is needed

The current `CurveLaunchpad` launches a fixed 1 billion token supply, sells up to 800 million tokens for WETH, and immediately opens trading. Its `realQuote` is owed to curve sellers before graduation and becomes permanently locked Icarus liquidity at graduation. Its launch fee goes directly to the treasury. None of these funds can also be pledged as a redemption reserve or RISEx margin. The current token can burn its holder's balance but has no reserve redemption method. See `contracts/docs/protocol-spec.md` and `contracts/contracts/CurveToken.sol`.

RISEx's integration guide describes an account wallet, a registered order signer, REST order submission, 10× leverage configuration, and isolated margin. Opening a position through its API and launching a Curveball token are separate transactions. A product must handle partial completion, failed fills, and recovery explicitly.

## Economic model

Use three separate ledgers for every launch:

| Ledger               | Source                                                             | Permitted use                                            |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------- |
| Floor reserve `R`    | Creator's USDC deposit at creation; later realized profit deposits | Holder redemptions only                                  |
| Trading margin `M`   | Separate creator USDC deposit                                      | One isolated RISEx position; may be lost entirely        |
| Market liquidity `L` | Separate launch capital and token inventory                        | Curve trades and Icarus pool; never counted as the floor |

For redeemable supply `N`, the published floor is `R / N` USDC per token, rounded down to USDC base units when paying a redemption. The reserve liability is bounded by the USDC held by the reserve contract. No unrealized P&L, RISEx account equity, WETH pool reserve, unclaimed fees, or promised future deposits count toward `R`. The design must count all minted tokens that can eventually circulate, including unsold curve inventory and tokens designated for LP, until they are burned. It must use integer USDC units throughout. At 1 billion tokens and 6-decimal USDC, even a one-micro-USDC floor per whole token requires $1,000 in reserve.

Example: a 1 billion token launch with a $0.00001 redemption floor needs $10,000 USDC in the reserve. A separate $1,000 margin deposit can support roughly $10,000 notional at 10×. If that position is liquidated, its $1,000 may be lost; the $10,000 redemption reserve remains. Fees, funding, slippage, and maintenance margin make the actual liquidation threshold different from a simple 10% price move.

The creator pays for both `R` and `M`. Buying tokens on the curve does not create or top up either ledger in this version. The floor is set at activation and may only increase when additional USDC reaches the reserve. It never decreases per outstanding token through normal operation. Redemption reduces `R` and `N` proportionally at the current floor; rounding dust stays in the reserve.

## Holder rights and lifecycle

1. **Prepare:** creator chooses a supported RISEx market, long or short, a 10× target, floor amount, and trading margin. The UI shows total USDC needed, expected notional, funding and liquidation examples, and whether the asset is currently listed.
2. **Fund:** a dedicated reserve contract receives `R`; a separate market account receives `M`. Neither amount comes from the existing WETH curve reserve or the protocol's shared buyback treasury.
3. **Open:** the operator sets isolated margin, submits a bounded order, and verifies an actual fill and resulting position. An accepted order is insufficient. Partial fills must either meet a declared minimum exposure or be closed before activation.
4. **Activate:** the new launch type mints tokens and enables trading only after reserve funding and position verification. The public market record binds one token, one reserve, one RISEx account, one market, one direction, and the launch policy. If preparation fails or times out, no “backed” market opens; the recovery path closes exposure and returns unencumbered creator funds.
5. **Trade:** Curveball displays the token market and a separate live backing panel. Holders may redeem at any time, including before graduation and during a RISEx outage or liquidation. This requires a new token/launch design: the current transfer lock, held ledger, and curve sell path cannot simply be given a second unrestricted exit without economic and accounting tests.
6. **Settle profits:** the operator can close or reduce the position. A floor increase is recorded only after realized USDC is withdrawn from RISEx and deposited into the reserve contract. Version one sends all realized net profit committed to holders to this reserve; buybacks are a later, separately specified policy.
7. **Graduate:** normal market liquidity may move into an Icarus pool. The reserve and redemption right continue unchanged. Tokens held in the pool remain redeemable once a user acquires them. Graduation must never send reserve USDC or trading margin into LP.
8. **End state:** if the position is liquidated, show it as liquidated and keep redemption open. The launch cannot silently create a replacement position or spend reserve funds to recapitalize it.

## Required invariants

- Each market has its own reserve and RISEx account. No cross-market collateral or shared P&L.
- Reserve USDC is held by a contract whose payout rule is fixed for holders. The creator, operator, and protocol cannot withdraw the amount owed to outstanding tokens.
- RISEx exposure uses isolated margin. No cross margin, borrowing against the reserve, or automatic margin top-up from the reserve.
- The trading signer cannot change the market, direction, maximum notional, or withdrawal destination outside the published policy. Whether RISEx supports the required account and signer restrictions is a feasibility gate, not an assumption.
- `reserve balance >= redeemable supply × published floor`, allowing defined integer rounding. Every redemption burns the paid tokens atomically with the USDC transfer.
- No “backed,” “active,” or floor badge until the reserve and filled position have been verified. If market data becomes stale, the position display says so; the on-chain redemption quote remains available.
- A reported profit cannot raise the floor until the reserve contract actually receives USDC.

## Product surface

**Launch form:** a distinct “Backed launch” path; market and direction; fixed 10× target; creator USDC commitment split into floor reserve and margin; floor per token; worst-case trading-margin loss; estimated liquidation price and funding sensitivity; final review of all transactions. The ordinary launch remains simple.

**Market card:** a backed badge only for activated markets, with current USDC redemption value per token. A pending or liquidated position has its own status rather than being hidden.

**Market page:** reserve balance and contract link; redeemable supply and floor; RISEx account link; position side, size, entry, mark, margin health, funding, and liquidation state; last successful update time; historical top-ups; separate buttons for ordinary trade and on-chain redemption. Show Icarus pool price and redemption value separately.

**Operator view:** funding, order, and activation state; reconciliation of API and chain balances; stale data and margin alerts; close/reduce controls within policy; failed-step recovery and audit log. A backend may observe and submit permitted actions, but should not become the only source of truth for holder redemption rights.

The public name should make the economics legible: “Floor-backed launch with a perp strategy” describes this design more accurately than “perp-backed launch.” The position supplies potential upside; the reserve supplies the redemption floor.

## Integration and ownership boundary

- Build the reserve and redemption rule on-chain. Use a dedicated RISEx account for each market. Prefer a contract-controlled account with scoped trading authority if RISEx supports it. Test EIP-1271/smart-account signing, deposit, withdrawal, and signer revocation before claiming trustless position custody.
- If RISEx requires an externally controlled account, use a disclosed multisig/operator arrangement for the position and keep the floor reserve independently enforceable. The position's profits then depend on operator execution until transferred to the reserve; describe that limit in the UI.
- Read RISEx market configuration at runtime. Use portfolio details for equity, position and margin-health display, and reconcile against on-chain transactions. Set explicit freshness and failure states.
- Do not use the existing `CurveBuybackTreasury`: it pools fees across markets and permanently selects one CURVE token. Per-market holder backing needs independent accounting.
- Determine whether a USDC-quoted Icarus market and curve are needed. The present Curveball contracts require an 18-decimal WETH quote, while a USD redemption floor needs USDC. A WETH pool can coexist with USDC redemption, but all UI comparisons require a trustworthy WETH/USD conversion and the extra swap friction weakens price arbitrage.

## Explicit exclusions for version one

- Existing tokens becoming backed retroactively.
- Automatic 10× re-leveraging after drawdowns, auto top-ups, or using the reserve as margin.
- Perp profit forecasts, guaranteed trading profit, or a guaranteed Icarus market price.
- Community-funded position shares, creator withdrawals from the floor, dynamic leverage, multiple positions, and per-market buybacks.
- Treating an unfilled order, unrealized P&L, or an operator-held wallet balance as reserve backing.

## Feasibility gates before implementation

1. **Market:** verify the intended underlying is listed and supports the desired order size and leverage. The 2026-11-17 mainnet `/v1/markets` response has no `RISE/USDC` pair; if “RISE perp” means the RISE token, this is currently unavailable.
2. **Account control:** prove a dedicated account can be owned by the proposed vault or smart wallet, and that its signer permissions and withdrawal destination can be constrained as required. Otherwise document and accept operator custody for the trading leg.
3. **Redemption economics:** simulate simultaneous curve sell and reserve redemption, token supply changes, arbitrage, rounding, and graduation. Decide whether the backed variant should use a USDC curve/pool rather than the current WETH venue.
4. **Execution:** demonstrate deposit, signer registration, isolated-margin configuration, bounded order, confirmed fill, close, withdrawal, and reconciliation on testnet. Include partial fills and a failed launch after a position is opened.
5. **Operations and assurance:** specify who holds emergency authority, how a signer is revoked, what happens when RISEx or its API is unavailable, independent contract review, and any legal review needed before marketing a redeemable financial product.

## Delivery stages and acceptance checks

1. **Economic prototype:** model reserve and supply accounting across creation, curve buys and sells, redemptions, burn at graduation, and Icarus swaps. Show that redeeming every outstanding token never requires more than reserve USDC and that a perp wipeout cannot change this result.
2. **RISEx proof of concept:** use a dedicated testnet account to complete the full funding-to-withdrawal path, including a partially filled order and signer revocation. Record whether a smart contract account can own the position and enforce withdrawal restrictions.
3. **New launch contracts:** implement reserve custody, redemption, activation states, token accounting, and Icarus graduation for the backed variant. Review the contract boundary independently before any value-bearing release.
4. **App and operations:** build the separate launch flow, market status and redemption UI, indexer, reconciliation, monitoring, and failure recovery. Verify that no market is labeled active before a confirmed fill, and that redemption still works when the trading operator is offline or the position is liquidated.

## Decisions to make

| Decision                                 | Working recommendation                                                     |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| What does “backed” mean?                 | An on-chain USDC redemption right per token, separate from the perp margin |
| Who funds it?                            | Creator funds both floor reserve and margin up front                       |
| What position?                           | One isolated 10× position, chosen from currently supported markets         |
| Who receives profit?                     | Realized net USDC deposited into the reserve, raising the floor            |
| What happens on loss?                    | Trading margin may go to zero; floor reserve and redemption continue       |
| Where does token trading occur?          | New backed launch path, with Icarus liquidity after graduation             |
| Can the operator control holder backing? | No; reserve withdrawals are only holder redemptions                        |

The primary unresolved choice is whether the product promise really requires an enforceable redemption floor. If it does, the reserve, token accounting, and activation rules above are core requirements. If the intended promise is instead a token treasury that takes a 10× trade and buys back tokens with wins, that should be scoped and named as a different launch type without a floor claim.

## References checked

- Curveball current behavior: `contracts/docs/protocol-spec.md`, `contracts/docs/architecture.md`, `contracts/contracts/CurveLaunchpad.sol`, and `contracts/contracts/CurveToken.sol`.
- RISEx integration: https://developer.rise.trade/reference/integration
- RISEx portfolio fields: https://developer.rise.trade/reference/accountservice_getportfoliodetails
- RISEx current market inventory: https://api.rise.trade/v1/markets
