# Curveball mainnet economics — decision draft

**Status: decision draft for the core team · 30 October 2026.** The three headline numbers below are proposals for the next Curveball mainnet design, not approved settings. Please challenge them together: changing the graduation target also changes the starting price, the pool's opening size, and how much buyers must spend.

## Proposed mainnet numbers

| Decision | Proposed value | What the team is approving |
| --- | ---: | --- |
| Token supply | **1,000,000,000 tokens minted per launch** | A standard token denomination for every launch. Under the current allocation, 800 million would be sold on the curve; the other 200 million would be available for pool seeding, an optional holder reserve, or a graduation burn. |
| Launch fee | **WETH equal to $5 at launch time** | A USD-priced creator fee. The WETH quantity changes with the ETH/USD oracle price. Network gas and any separate initial token purchase are additional. |
| Graduation target | **20 WETH of net curve proceeds** | The curve completes when it has retained 20 WETH for the first liquidity pool. This is an ETH-denominated goal, so its USD value changes with ETH's price. |

**Meaning of “1 billion supply.”** Curveball would mint 1 billion at launch, then may burn some unused tokens at graduation and later burn tokens bought back. It would **not** promise that 1 billion remains outstanding forever. The team should confirm that this is the intended public wording.

## What the figures imply

**The $5 launch fee is variable in WETH.** At illustrative ETH prices of $2,000, $3,000, and $4,000, the fee would be approximately 0.0025, 0.001667, and 0.00125 WETH. Curveball's present fixed 0.001 WETH fee would be worth $2, $3, and $4 in those same examples. A live oracle quote is required when the creator launches; these are examples, not a live ETH price. The fee currently goes to Curveball's treasury.

**The 20 WETH target is net of trading fees.** With the current 0.75% curve trading fee, no creator tax, and a simple path with buys but no sells, buyers would spend about **20.15 WETH** to leave 20 WETH in the curve. At the current maximum 0.5% creator tax, that becomes about **20.25 WETH**. Sales, later buys, rounding, and future fee changes alter the total spent. “20 ETH raised” would be misleading unless we define whether it means buyer spend or WETH retained for liquidity.

**The 80% curve allocation fixes a notable price path.** If we keep the current curve shape, selling 800 million tokens into a 20 WETH target starts at an indicative full-supply valuation of **5 ETH** and reaches **125 ETH** at the curve's final marginal price, a 25× change in marginal token price. Those are spot-price calculations, not cash proceeds or a price forecast. Changing 1 million tokens to 1 billion while keeping the same percentages and 20 WETH target makes each token's price 1,000× smaller; it does **not** by itself make the launch 1,000× cheaper or more valuable.

**At graduation, the first pool would normally receive about 20 WETH plus 160 million tokens.** At the curve's closing price, those tokens have an indicative value of another 20 ETH, so the opening pool is roughly **40 ETH in combined token value**. This is the marked value of both sides, not 40 ETH available for withdrawal as WETH. If the optional holder reserve is zero, roughly 40 million of the initially minted tokens are burned at graduation, leaving about 960 million outstanding before later buybacks. If the holder reserve takes its 4% maximum, 40 million go to that reserve and the ordinary graduation burn can be zero. These figures assume an exact sellout, no donated assets, and the current 80/20 allocation; actual transactions have rounding.

| Net graduation target | WETH side of first pool | Indicative combined pool value | Indicative full-supply valuation at final curve price |
| ---: | ---: | ---: | ---: |
| 10 WETH | 10 ETH | ~20 ETH | ~62.5 ETH |
| **20 WETH** | **20 ETH** | **~40 ETH** | **~125 ETH** |
| 40 WETH | 40 ETH | ~80 ETH | ~250 ETH |

This sensitivity holds the current 80/20 allocation and curve shape fixed. A 20 ETH target is about $40,000, $60,000, or $80,000 in retained WETH at the illustrative ETH prices above. The target is a liquidity threshold, **not** evidence that a token is safe, successful, or worth its indicated valuation.

## Pons benchmark and Curveball's intended differences

The benchmark for the next iteration is **[Pons V2](https://docs.ponsfamily.com/v2)**. Pons V2 launches on a bonding curve, then creates a permanently locked Uniswap V4 pool. Supply, graduation threshold, curve fee, and pool parameters are chosen from launch configurations; its published V2 model does not establish 1 billion supply, a 20 ETH threshold, or a $5 oracle-priced launch fee as universal V2 values. The often-quoted **1 billion supply, 0.0005 ETH launch fee, 1% pool fee, and 4.2 ETH default graduation threshold** belong to [Pons V1](https://docs.ponsfamily.com/), which starts trading in a pool rather than a curve. We should not copy those figures into a V2 comparison.

| Topic | Pons V2 | Curveball now / proposed next iteration |
| --- | --- | --- |
| Chain and trading venue | Robinhood Chain; curve then Uniswap V4 pool | RISE; curve then Icarus pool |
| Pairing asset | Native ETH or an approved custom token | WETH only in the current design |
| Supply and target | Selected from launch configurations | Proposed standard **1 billion minted**, **20 WETH** target |
| Launch fee | A launch fee read from the factory; the V2 docs do not establish USD oracle pricing | Proposed **$5 worth of WETH**, priced at launch |
| Buyback funding | Optional, deducted from the creator's share after the protocol share | Current Curveball reserves 25% of the base trading fee for buybacks on every launch. Proposed: make that allocation creator-funded and optional |
| When buybacks trade | Can operate during the curve and after graduation | Current Curveball buys only after graduation. Proposed: also buy during the curve |
| Bought tokens | [Locked and vested over five years](https://docs.ponsfamily.com/v2), eventually released to creator and protocol | Current and proposed Curveball policy: **burn bought tokens permanently** |
| Trading fee after graduation | Same effective protocol rate before and after; the V4 pool itself adds no fee | Curveball currently uses its own curve fee, then an Icarus pool fee; effective rates need a separate decision |
| Graduation | Normally completes in the final buy, with a permissionless fallback | Current Curveball requires a separate graduation action, which a keeper can send |

**The central economic choice is who pays for the burn.** Pons V2 deducts optional buybacks from the creator's fee entitlement. Curveball's present 25% buyback allocation is automatic. A straightforward creator-funded version would keep a 25% protocol share of the base fee, then give creators a choice: if buybacks are off, they receive the remaining 75%; if on, 25 percentage points of the whole fee go to buybacks and 50 go to the creator. The optional creator tax remains entirely the creator's. The table below is an illustration for the team's decision, not an approved fee schedule.

| Share of the base trading fee | Current Curveball | Proposed, buyback on | Proposed, buyback off |
| --- | ---: | ---: | ---: |
| Protocol | 25% | 25% | 25% |
| Creator cash payout | 50% | 50% | 75% |
| Buyback and burn | 25% | 25% | 0% |

At the current 0.75% curve trading fee, a 25% share of that fee equals **0.1875% of trade volume**. This must be described as a share *of the fee*, not “25% of trades.” We still need to decide whether the same effective fee and split apply in the pool after graduation.

## Other values the team should challenge

| Decision still open | Present Curveball setting | Why it matters for mainnet |
| --- | --- | --- |
| Curve allocation | 80% sold on curve; 20% outside it | Drives the starting valuation, final price multiple, pool token amount, and possible graduation burn. |
| Holder reserve | Creator can choose 0–4% of initial supply | At 1 billion tokens this is 0–40 million tokens. A larger reserve reduces the graduation burn; decide whether this feature stays and how its distribution is explained. |
| Curve trading fee | 0.75% base fee | Determines buyer cost, creator income, protocol income, and funding for burns. Decide the rate alongside the 20 WETH target. |
| Creator tax | Optional, capped at 0.5%, paid to creator | Affects buyer cost and may obscure the advertised fee. Decide whether to keep, lower, or remove it. |
| Fee split / optional buyback | 50% creator, 25% buyback, 25% protocol today | Confirm the creator-funded on/off economics above and whether creators may later switch their choice. |
| Post-graduation fee | Set by the Icarus pool, separately from the curve fee | Decide the *total* trader fee after graduation and whether Curveball can deliver the promised split from the pool's actual fees. |
| Buyback pacing | Current post-graduation buybacks run at most hourly, in small price-bounded chunks | Pre-graduation buys need their own size and timing limits. Large buys can move price and change who reaches graduation. |
| Graduation recovery | Current sold-out curve can abort after 7 days if graduation remains stuck | Decide whether the same user promise is acceptable for mainnet and who operates the keeper. |

**A pre-graduation buyback changes the meaning of graduation.** If Curveball spends fee-funded WETH buying on its own curve, that purchase can add WETH to the same 20 WETH target and remove tokens that otherwise would have gone to public buyers. The team must decide whether fee-funded buys count toward the target, and whether tokens bought and burned before graduation count toward the 800 million curve-sale allocation and any holder-reserve calculation. We should settle this before publishing “20 ETH raised.” It also affects whether buying a token is always possible up to graduation and whether the pool opens with the expected 160 million tokens.

## How far this moves from the current build

| Proposed change | Size of change | Practical consequence |
| --- | --- | --- |
| Mint 1 billion rather than 1 million tokens | **1,000× more token units** | A denomination and contract/UI change. With the same allocation and 20 WETH target, each token's quoted price is 1,000× lower; launch economics measured in WETH do not change because of supply alone. |
| Set 20 WETH graduation target | **2,000× the current testnet setting of 0.01 WETH** | A much larger liquidity hurdle and a different starting price. Mainnet has no recorded Curveball deployment or approved target yet, so the testnet figure is a development reference only. |
| Replace fixed 0.001 WETH launch fee with $5 in WETH | **New pricing dependency** | The creator's WETH payment moves with ETH/USD. It needs a verified mainnet oracle, a freshness rule, a quoted maximum charge, and a decision for outages. |
| Make buybacks creator-funded and optional | **Fee-policy change** | With the illustrative split above, turning buybacks off redirects their 25% fee share to the creator; protocol share stays 25%. |
| Buy on the curve as well as in the pool | **Major trading and accounting change** | Fee-funded purchases may advance graduation, alter token distribution, and require new price-impact and anti-abuse limits. |
| Burn bought tokens instead of vesting them | **Already Curveball's burn policy** | The difference is from Pons V2's five-year vesting model, not from Curveball's existing post-graduation burns. |

These are planning estimates of change, not effort or cost estimates. The final design must define pre-graduation buyback accounting before anyone can treat the 20 WETH threshold as a settled launch promise.

## Mainnet launch gates

1. **Verify a usable ETH/USD oracle on RISE mainnet.** Pyth and Chainlink are examples, not selected providers. The public [Pyth contract list](https://docs.pyth.network/pro/contract-addresses) reviewed for this draft did not establish a RISE mainnet deployment; the [Chainlink feed address directory](https://docs.chain.link/data-feeds/price-feeds/addresses) likewise did not establish a RISE mainnet ETH/USD feed. Confirm the exact feed address and update mechanism on the intended chain before promising an oracle-priced launch fee.

2. **Set an explicit fee-quote policy.** Decide how fresh the price must be, what happens when it is stale or unavailable, whether the creator can set a maximum WETH fee before confirming, and how fee rounding works. The simplest user promise is that a launch pauses when a trustworthy price is unavailable; any fallback fee should be an explicit business decision.

3. **Approve all launch economics as one package.** The 1 billion mint, 80% curve allocation, 20 WETH threshold, $5 fee, trading fees, creator tax, holder reserve, and buyback split influence one another. Publish the approved package and a plain-language example before deployment.

4. **Update and verify the production release.** The current code and production checks assume a 1 million token mint and a fixed 0.001 WETH launch fee. There is no recorded RISE mainnet Curveball deployment in this workspace as of this draft. The approved figures require contract, deployment-check, interface, and operational changes before mainnet release.

## Questions for the core team

1. Is **1 billion** the right *initial mint*, knowing graduation and buyback burns may reduce outstanding supply?

2. Should the **20 WETH** threshold represent net WETH reserved for liquidity, as it does today? What minimum opening WETH liquidity and implied final valuation are acceptable?

3. Should creator-funded buybacks on the curve count toward that 20 WETH? If yes, what will we call the target publicly?

4. Does the 80/20 allocation and optional 0–4% holder reserve still fit the intended launch experience?

5. Is **$5** the right creator fee across ETH price scenarios and gas conditions? Which verified RISE mainnet ETH/USD feed will price it?

6. Should the standard curve trading fee remain **0.75%**, the creator tax cap remain **0.5%**, and the protocol retain **25% of the base fee**?

7. When buybacks are off, should the creator receive the full non-protocol 75% of the base fee? When on, is 25% of the whole fee the right burn allocation?

8. Should effective trading costs be the same before and after graduation, as in Pons V2? What numerical rate can the Icarus pool support?

9. Should the creator be able to switch buybacks on or off later, and should pre-graduation and post-graduation purchases have different limits?

**Review fields:** Decision owner: **[add name]** · Review date: **[add date]** · Approved launch figures: **[fill after debate]** · Rejected options and reasons: **[fill after debate]**.

**Source basis.** Curveball figures and behavior were checked against the workspace's README, CurveLaunchpad, CurveMath, CurveFeeEscrow, CurveHolderReserve, deployment script, and production-recording script on 30 October 2026. Pons comparisons come from the official [V2 documentation](https://docs.ponsfamily.com/v2) and separately identified [V1 documentation](https://docs.ponsfamily.com/). All USD examples are hypothetical ETH-price scenarios; no live price was used.
