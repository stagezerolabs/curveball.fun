# Aero / Icarus MEV research brief

**Research cutoff:** 21 October 2026
**Scope:** read-only research for a zero-capital Aero/Base monitor. This is not a trading recommendation or an authorization to send transactions.

## Executive answer

The checked-in Icarus deployment snapshot is still a narrow fork of the legacy Aerodrome V2 pool system. The supplied diff is 233 lines across only `PoolFactory.sol` and `Pool.sol`. Its one material economic addition is an **unstaked-fee split**: a configurable percentage of the already-charged fixed swap fee is sent to a separate `gaugeFees` escrow, while the remainder stays claimable by LP-token holders. It does not increase the trader's fee, inspect volatility or transaction priority, or classify MEV.

Aero is a protocol-generation change, not an incremental fee patch. Against the six requested feature families, the checked-in Icarus snapshot has **0 fully present, 0 partial, and 6 absent**. Icarus has one *adjacent but non-equivalent* fee-routing primitive. A repository-wide search of the checked-in deployment and source material found none of MetaDEX03's distinctive contracts or terms. That is strong evidence about this repository snapshot; whether a different, later Icarus deployment exists onchain is **UNVERIFIED**.

The best first paper signal is **legacy Aerodrome-to-Aero liquidity fragmentation during migration**. It is observable, has an objective executable-price test, and is the closest match to chaintraxer's existing event watcher and Aerodrome/Slipstream adapters. It should be tested from historical Base blocks with exact fee and gas replay, never by sending a transaction.

## 1. Delta map: legacy Aerodrome → Icarus → Aero

### What Icarus actually changed

The local source of truth is [`deployments/4153/icarus-vs-aerodrome.diff`](../../deployments/4153/icarus-vs-aerodrome.diff), compared with Aerodrome's legacy [contract specification](https://github.com/aerodrome-finance/contracts/blob/main/SPECIFICATION.md) and [Pool contract](https://github.com/aerodrome-finance/contracts/blob/main/contracts/Pool.sol).

The Icarus delta does four things:

1. Updates Solidity from 0.8.19 to 0.8.30, changes licence headers, and adapts the OpenZeppelin reentrancy/import and ERC-20 update hooks.
2. Adds a global and per-pool `unstakedFee`, capped at 50% of the swap fee. The deployed default in the checked-in source is 0%.
3. Creates a second `PoolFees` escrow named `gaugeFees`.
4. On a swap, computes the ordinary legacy fee, sends `fee × unstakedFee` to `gaugeFees`, and accrues the balance to ordinary LP holders. The registered gauge can claim the `gaugeFees` balance.

This changes **who receives a fixed fee**, not how large the fee is. Legacy defaults remain 0.05% for stable pools and 0.30% for volatile pools; a fee manager can set a custom pool fee up to 3%. The legacy design remains weekly and ve(3,3)-based: voters direct emissions once per epoch, gauged LPs give up fees for emissions, and foregone fees are paid to voters in the next epoch ([Aerodrome specification](https://github.com/aerodrome-finance/contracts/blob/main/SPECIFICATION.md)).

### Requested feature-by-feature map

| Aero feature family | In checked-in Icarus? | What Aero adds or removes | What adoption would mean for Icarus |
|---|---:|---|---|
| **MetaDEX03 core** | **No** | New canonical token/migration, root `Voter` plus per-chain `LeafVoter`, continuous accounting, modular fee and hook infrastructure, token registry, Pool Tape, new gauges, Metarouter, and Hyperlane message orchestration. Weekly epochs stop being the core timing mechanism. The public auditor guide inventories these components ([MetaDEX03 auditor guide](https://github.com/dromos-labs/metadex-public/blob/main/audits/sherlock-contest-auditor-guide.md)); the public repository describes the full contract set ([metadex-public](https://github.com/dromos-labs/metadex-public)). | This would be a system migration or replacement, not a safe two-file upgrade. Icarus would need new factories/pools, voting and emissions accounting, registry/indexation, deployment tooling, audits, and a migration path. The current Icarus pool ABI and economics would no longer describe the whole venue. |
| **Slipstream V3 dynamic fees** | **No** | Concentrated liquidity, active-tick rewards, swap hooks, Pool Tape, fee discounts, and a fee that responds to the current tick's displacement from a recent TWAP. Aero describes Slipstream as its concentrated-liquidity AMM with dynamic fees and MEV capture ([Aero Slipstream](https://aero.xyz/features/slipstream/)); its CL implementation is public separately ([metadex-slipstream-public](https://github.com/dromos-labs/metadex-slipstream-public)). | Icarus would gain concentrated positions and price ranges rather than fungible V2 LP shares. Quote simulation, LP accounting, routing, indexing, and launch migration would all need V3-aware code. The fee could vary by block, so the current fixed-fee quote assumption would be unsafe. |
| **MEV recapture** | **No** | On supported L2 pools, an additional swap-input fee can be derived from the transaction's priority fee. It is routed through the same pool fee path, while the sequencer still keeps the priority fee ([Aero Economy](https://aero.xyz/articles/the-aero-economy/); [priority-fee module](https://github.com/dromos-labs/metadex-public/blob/main/V3/src/fees/PriorityFeeMevTaxModule.sol)). | Icarus would need a fee module/hook, reliable chain-specific gas semantics, parameter governance, event/index support, and quote simulation that includes both gas bids and input-token tax. Its present `unstakedFee` could route value after capture, but does not itself capture MEV. |
| **Predictive Allocation** | **No** | Continuous, cross-chain allocation and live revenue distribution replace backward-looking weekly voting. At launch, an sAERO position can reallocate subject to a roughly 48-hour cooldown; revenue redirects when allocation changes ([Predictive Allocation](https://aero.xyz/features/predictive-allocation/); the launch hub specifies a 47-hour launch cooldown and Base-paid cross-chain allocation ([Aero Upgrade Hub](https://aero.xyz/aero-upgrade/)). The legacy weekly rebase is also removed in favour of gauge caps, lazy minting/claiming, and market-linked rewards ([Aero Economy](https://aero.xyz/articles/the-aero-economy/)). | Icarus would need to replace weekly voter snapshots and reward distribution with continuous checkpoints, cooldowns, caps, and streaming. This is a governance/economic rewrite, not a UI change. Allocation changes would also become a valuable monitoring signal. |
| **Metaswaps** | **No** | A single approved instruction can swap into a transport asset, move cross-chain, swap on the destination, and deliver. Aero says this uses its onchain pools through MetaRouter rather than a solver network or dedicated bridge-liquidity pool ([Aero Metaswaps](https://aero.xyz/features/metaswaps/)). | Icarus would need a MetaRouter-compatible action compiler, cross-chain message adapters, transport assets, destination execution and failure/refund handling. New cross-chain latency, replay, liveness, and price-risk assumptions would enter the threat model. |
| **Cross-chain liquidity unification** | **No** | Aero launches one token/economic system on seven announced networks, with Base as root and the others as leaves connected through Hyperlane in the published architecture ([Aero launch article](https://aero.xyz/articles/aero-launches-today/); [MetaDEX03 auditor guide](https://github.com/dromos-labs/metadex-public/blob/main/audits/sherlock-contest-auditor-guide.md)). “Unified liquidity” means cross-chain reachability and coordinated incentives; it does **not** mean one synchronous reserve shared atomically by all chains. | Icarus would move from a RISE-local venue to a root/leaf system. It would need chain registries, message finality and retry policy, cross-chain accounting, transport routes, and monitoring of both local pools and message state. The new attack surface would include delayed, duplicated, censored, or mispriced cross-chain actions. |

### What Aero removed from the old model

Aero's upgrade retires the old token-economy path: legacy gauges are deactivated and legacy emissions cease; token and veNFT upgrades are irreversible ([Aero Upgrade Hub](https://aero.xyz/aero-upgrade/)). The public MetaDEX03 guide also describes continuous timing in place of weekly epochs and a new canonical AERO migration ([auditor guide](https://github.com/dromos-labs/metadex-public/blob/main/audits/sherlock-contest-auditor-guide.md)). Aero's economic paper says fixed weekly rebases are replaced by gauge caps and that allocations can move continuously rather than voting on last week's fees ([Aero Economy](https://aero.xyz/articles/the-aero-economy/)).

The predecessor documentation corroborates the operational break: Aerodrome describes weekly votes and prior-epoch revenue distribution ([Aerodrome docs](https://aerodrome.finance/docs)), while Velodrome's upgrade guide moves a veVELO lock from OP Mainnet into sAERO on Base and requires legacy rewards/rebase claims before conversion ([Velodrome upgrade guide](https://velodrome.finance/docs/upgrade)).

The launch article announced Base, Ethereum Mainnet, OP Mainnet, Arc, Ink, Robinhood Chain and Arbitrum, at 00:00 UTC on 22 October 2026 ([launch article](https://aero.xyz/articles/aero-launches-today/); [upgrade hub](https://aero.xyz/aero-upgrade/)). Exact live status and feature activation for every pool on every chain at this research cutoff are **UNVERIFIED**. In particular, Aero says the MEV module will roll out gradually, so published code and a deployed pool using that code are not the same fact ([Aero Economy](https://aero.xyz/articles/the-aero-economy/)).

## 2. MEV recapture mechanics

### The exact fee calculation in the published contracts

There are two separate additions to the ordinary trading fee.

**Volatility-driven dynamic fee.** For a configured Slipstream V3 pool, the hook looks back over `secondsAgo` (600 seconds by default), obtains the time-weighted average tick, and computes:

```text
dynamicFee = abs(currentTick - twapTick) × scalingFactor / 1e6
blockFee   = min(baseFee + dynamicFee, feeCap)
```

The first swap of a block computes and stores the block-wide fee. Pool configuration can override the base fee, scaling factor and cap; the published hook caps the ordinary stored fee at 5%, while its base-fee setter permits up to 3%. An optional first-transaction fee can override the first transaction's fee and may bypass the ordinary cap. Registered callers can receive discounts except on that initial fee. These are code-level facts from [`DynamicSwapFeeHook.sol`](https://github.com/dromos-labs/metadex-public/blob/main/V3/src/hooks/dynamic/DynamicSwapFeeHook.sol), not proof of the parameters active on a particular Base pool.

**Priority-fee MEV tax.** The published module first computes the native-gas priority component:

```text
priority  = tx.gasprice - block.basefee
threshold = max(baseFeeFactor × block.basefee, minThreshold)

if priority <= threshold:
    mevTax = 0; toxic = false
else:
    mevTax = min(ceil((priority - threshold) × priorityFeeMultiplier / 1e12), 10%)
    toxic = true
```

The tax is denominated as a percentage of swap input and combined with the pool fee subject to the swap-hook ceiling. The owner can change the multiplier and threshold parameters. This follows the published [`PriorityFeeMevTaxModule.sol`](https://github.com/dromos-labs/metadex-public/blob/main/V3/src/fees/PriorityFeeMevTaxModule.sol) and [`DynamicSwapFeeHook.sol`](https://github.com/dromos-labs/metadex-public/blob/main/V3/src/hooks/dynamic/DynamicSwapFeeHook.sol).

There are explicit limitations. OP Stack deposit transactions with zero gas price receive zero tax; a failed tax lookup is caught so the swap can proceed untaxed; the module should not be enabled where gas price and base fee can use different fee currencies; and the optional initial fee can be consumed with a tiny first swap before a larger same-block swap. These are accepted behaviours in the project's [auditor guide](https://github.com/dromos-labs/metadex-public/blob/main/audits/sherlock-contest-auditor-guide.md). Whether any additional production mitigation or different deployed code exists is **UNVERIFIED**.

### Who captures what from whom

For a taxed arbitrage swap on a supported L2:

1. **The searcher/trader pays two different assets to two different destinations.** It pays L2 gas plus a priority fee in the chain's gas token, and it pays the trading fee, dynamic premium and MEV tax from the swap input token.
2. **The sequencer captures the full priority fee.** Aero explicitly says the sequencer's priority payment is not reduced ([Aero Economy](https://aero.xyz/articles/the-aero-economy/)).
3. **The pool fee path captures the MEV tax and dynamic premium.** For fee-earning, unstaked liquidity, LPs keep Smart Fees minus the pool's unstaked fee. At launch Aero lists 0% unstaked fee on Ethereum, Arbitrum and Robinhood Chain and 5% on Arc, OP, Ink and Base. For AERO-earning, staked liquidity, the Smart Fees go to the sAERO Token Operators allocating rewards to that pool. The unstaked-fee share also goes to Token Operators ([Aero Economy](https://aero.xyz/articles/the-aero-economy/)).
4. **The victim receives no direct refund.** Recaptured value goes to LPs or Token Operators, not back to the adversely executed trader. Calling the mechanism “recapture” is therefore more precise than “sandwich protection.”

The immediate economic effect on a competitive arbitrage searcher is:

```text
net searcher edge
  = gross price discrepancy
  - base trading fees
  - volatility-driven fee premium
  - priority-fee MEV tax, if above threshold
  - gas and priority tip
  - slippage and execution risk
```

Above the retail threshold, increasing the tip can create a double marginal cost: more gas-token revenue for the sequencer and a larger input-token fee for the pool. That should compress some priority-gas auctions and redirect part of the stale-price margin to liquidity providers or allocators. Whether it does so in production depends on deployed parameters, pool activation, ordering rules and alternative private paths; those empirical effects are **UNVERIFIED**.

### Comparison with vanilla ve(3,3)

In the legacy Aerodrome/Icarus design, the pool takes a configured percentage of input. Unstaked LP holders accrue it; gauged LPs forgo fees for emissions, and the fees flow to voters in the following epoch ([Aerodrome specification](https://github.com/aerodrome-finance/contracts/blob/main/SPECIFICATION.md)). Neither the trader's priority fee nor recent price volatility changes the swap fee. The sequencer captures the priority bid and the arbitrageur keeps residual price-correction value after the fixed pool fee and gas.

Aero makes both the fee amount and its destination conditional. Volatility can increase the swap fee. A high priority bid can add a separate MEV fee. Staking determines whether Smart Fees go to the LP position or the Token Operators supporting it. Distribution is live rather than tied to the next weekly epoch ([Aero Economy](https://aero.xyz/articles/the-aero-economy/); [Predictive Allocation](https://aero.xyz/features/predictive-allocation/)).

### Comparison with sandwich economics and the IMC '25 Jito result

A vanilla two-leg sandwich has the rough form:

```text
attacker profit
  = value extracted from the victim's allowed slippage
  - front-leg and back-leg swap fees
  - gas / ordering payments
  - execution and inventory risk
```

The victim receives a worse price; LPs receive ordinary fees but can still bear adverse selection. Under Aero, the attacker can additionally pay the dynamic premium on both legs and the priority-fee tax on any leg whose bid crosses the threshold. That reduces the profitable victim-slippage region and redirects part of it through the fee path. It does **not** prove prevention: an attacker able to obtain ordering with a low visible priority fee, a private arrangement, or another sequencing technique may avoid the signal. Whether such evasion is possible on current Base infrastructure, and at what scale, is **UNVERIFIED**.

The IMC '25 Jito paper is useful as a methodological warning, not as direct evidence about Base. Its authors measured more than 400,000 suspected sandwiches and more than $5 million in victim loss over more than three months, while also finding widespread defensive behaviour despite sandwiches being relatively rare overall ([ACM IMC program and abstract](https://conferences.sigcomm.org/imc/2025/program/); [paper PDF](https://cnitarot.github.io/papers/imc26_solana.pdf)). Jito's own documentation says its `jitodontfront` mechanism may reduce sandwiches but does not cover all transaction-ordering variants ([Jito documentation](https://docs.jito.wtf/lowlatencytxnsend/)). The lesson for Aero is to measure realized attacker profit, victim execution and fee destinations from ordered transactions. A priority-sensitive tax is an economic friction, not a cryptographic ordering guarantee.

## 3. Candidate launch/migration-window signals on Aero/Base

All three signals are for observation and simulation only. Every candidate quote must use state available at that block/transaction boundary, include the actual fee configuration, and be rejected if it needs future information or an assumed fill.

### Rank 1 — Legacy-to-Aero migration fragmentation

**Signal.** A legacy Aerodrome liquidity withdrawal/burn or gauge deactivation is followed by an Aero pool launch/migration/liquidity mint for the same economic pair, while the two venues show a net executable-price difference. The public indexer schema exposes `Launch`, `Migrate`, pool creation and fee-module events suitable for discovery ([Velodrome indexer configuration](https://github.com/velodrome-finance/indexer/blob/main/config.yaml)); official deployment addresses should be pinned from the [Dromos deployment files](https://github.com/dromos-labs/metadex-public/tree/main/deployment-addresses).

**Detection.** Subscribe to legacy V2 `Sync`/`Swap`/`Mint`/`Burn` plus Aero factory, launcher, CL mint/burn and swap events. Map pools by ordered token pair and decimals. After every relevant log, compute exact executable quotes in both directions at fixed notionals on both venues, then compare with an independent liquid reference. Record block number, transaction index, reserves/ticks, liquidity, fee modules, gas price, base fee and quoted output.

**Inefficiency thesis.** Migration is asynchronous at the user, router, indexer and liquidity-provider layers. Liquidity and order flow can split before every frontend and aggregator prefers the new venue. One pool may retain a stale marginal price or insufficient depth after the other receives the first large flow.

**Backtest/simulation.** Replay Base archive blocks from several hours before the announced launch through at least 72 hours after. Reconstruct legacy and Aero state transaction-by-transaction. For every detected divergence, fork immediately before the hypothetical trade and use `eth_call`/simulation against the actual routers. Apply dynamic and MEV fees from recorded block and transaction data, plus observed gas. Also test a one-block-late entry; same-block opportunities that disappear before observation are not actionable.

**Expected edge.** Potentially tens of basis points in thin or abruptly moved pools, but probably short-lived and concentrated around the cutover. Magnitude is **UNVERIFIED** until replayed.

**What kills it.** Atomic/coordinated migration, MetaRouter and aggregator updates, existing professional searchers, shallow exit liquidity, token transfer restrictions, or Smart Fees plus gas exceeding the spread. A spread visible only after the correcting transaction is not an opportunity.

**Why first.** It is a labelled natural experiment, the profitability test is objective, and chaintraxer already understands Aerodrome V2, Slipstream generations, pool events and route simulation. It needs isolation and correctness work, not a brand-new strategy engine.

### Rank 2 — Post-toxic-flow residual after MEV tax

**Signal.** A large swap is MEV-classified or pays a priority fee above the published threshold, Pool Tape records toxic/MEV volume, and Aero remains off an external executable reference after the transaction. Pool Tape is specifically intended to record fees, volume and MEV-classified activity ([Aero Slipstream](https://aero.xyz/features/slipstream/); [auditor guide](https://github.com/dromos-labs/metadex-public/blob/main/audits/sherlock-contest-auditor-guide.md)).

**Detection.** Decode swap and Pool Tape events; calculate `tx.gasprice - block.basefee`; load the exact pool hook/module and parameters; reconstruct the post-transaction CL state; and compare a range of executable sizes with a second liquid venue. Separate an observable next-block residual from an intra-block backrun that a public RPC subscriber can never reach.

**Inefficiency thesis.** Dynamic fees and the priority tax raise the first corrector's cost. If the tax is large enough, a price gap may need to grow or persist longer before correction becomes profitable, leaving a residual for lower-urgency flow.

**Backtest/simulation.** On an archive node, replay ordered Base transactions and recompute both fee components exactly. Simulate a trade directly after the toxic swap, at block end, and one block later. Compare duration and net spread in taxed versus untaxed pools while controlling for pair liquidity and volatility.

**Expected edge.** Fewer but possibly wider residual gaps than on a flat-fee venue. This is **UNVERIFIED** and could be negative: the same tax that delays competitors also charges this strategy.

**What kills it.** Same-block private searchers, low-tip ordering that avoids the classifier, fee ceilings, a failed/disabled module, or dynamic fees consuming the entire discrepancy. Exact Base activation and parameter values are **UNVERIFIED** and must be read onchain.

### Rank 3 — Predictive Allocation leads liquidity, then price discovery

**Signal.** A material sAERO allocation change, gauge-cap change, launch/liquidity payment, or reward-stream start precedes a jump in deposits, depth or flow for a Base pool.

**Detection.** Index allocation and cap checkpoints, reward rate, stake/mint/burn events, active liquidity and quoted depth. Normalize allocation by total allocation and pool revenue. Trigger only on changes large relative to the pool's prior seven-day baseline, then watch cross-venue price and depth over 5-minute, 30-minute and 2-hour windows.

**Inefficiency thesis.** Allocation is a public capital-coordination signal. Rewards may draw liquidity before demand arrives; conversely, price routers and traders may be slow to recognize suddenly improved depth. Early allocators are explicitly intended to position ahead of demand ([Predictive Allocation](https://aero.xyz/features/predictive-allocation/); [Aero Economy](https://aero.xyz/articles/the-aero-economy/)).

**Backtest/simulation.** Run an event study across all Base pools. Compare post-allocation changes with matched pools of similar liquidity, age and volatility. Simulate routing improvements and cross-venue execution, not token-price direction. Exclude allocations announced or acted on before the onchain checkpoint.

**Expected edge.** More likely useful for pool selection and risk scoring than immediate arbitrage. Directional price edge is **UNVERIFIED**.

**What kills it.** The signal is public, the launch cooldown makes changes partly predictable, sophisticated LPs arrive immediately, allocation fails to create organic demand, or emissions attract mercenary liquidity without a price lag.

## 4. Staged revival plan for chaintraxer

### What the repository is today

The local `chaintraxer-bot` is an execution-oriented, multi-chain arbitrage system, not a safe read-only monitor. It already contains useful Aerodrome V2 and several Slipstream adapters, V2/V3 maths, event watchers and route checking. But `npm start` runs `main.ts`, which starts the bot and database tasks, loads accounts/balances/nonces, performs token approvals, watches many networks, and constructs `Executor` instances when routes are found. `ENVIRONMENT=TEST` short-circuits one periodic execution path, but it does not remove startup approval calls or the watcher executor. Therefore:

> **Do not run the current `npm start`, even with `ENVIRONMENT=TEST`, using any funded wallet or signing key for this research mode.**

### Stage 0 — prove isolation offline

Future implementation should add a dedicated monitor entry point that imports only public-client, ABI, decoding, state-reconstruction, quote and persistence modules. It must not import `Executor`, account/private-key modules, approvers, bundlers, bridges, rebalancers, nonce loaders or Telegram transaction actions. Enforce the boundary with an import-deny test and start without any private-key environment variable. A local fork's send methods should fail closed.

Run sequence after that isolated entry point exists:

```text
npm test -- --runInBand
npx ts-node monitor/aero-base.ts --mode replay --from-block <start> --to-block <end>
npx ts-node monitor/aero-base.ts --mode live --paper --hours 72
```

The exact future file name and flags are a plan, not current repository functionality. No code was changed for this brief.

### Stage 1 — read-only Base monitor

Watch only Base at first:

- official legacy Aerodrome and Aero factories, launchers, routers, fee modules and Pool Tape addresses, pinned from published deployment files;
- pool creation/migration, mint/burn, stake/unstake, allocation/cap, fee-parameter and swap events;
- block base fee, transaction effective gas price/priority, transaction index and receipts;
- exact V2 reserves and V3 tick/liquidity state;
- executable quotes at several fixed notionals, plus independent venue references;
- data quality: WSS disconnects, missed/reorged blocks, RPC latency and replay gaps.

Store append-only observations and deterministic simulation inputs. Alerting may be Telegram-only, but every alert should include block, transaction, pool, before/after quote, assumed notional, full fee breakdown, gas assumption and a Base explorer link. It must never expose keys because monitor mode should have none.

**Cost.** There is no gas cost and no capital requirement. A public RPC may be enough for a small live log set; archive replay, ordered transaction data and repeated `eth_call` can require a paid provider. A rough three-day infrastructure range of **$0–$50 is UNVERIFIED and provider-dependent**. Request count, rate limits and archive access should be measured before choosing a plan.

### Stage 2 — three-day paper window

Run 72 continuous hours beginning with a fully synced historical catch-up. For every signal, freeze the decision using only then-visible state and simulate three cases:

1. immediate post-event execution, for market-structure measurement;
2. realistic observation plus measured RPC latency;
3. a conservative one-block-late execution.

Use fixed notionals such as $1,000, $5,000 and $10,000, but never assume the full quote fills. Subtract base/dynamic/MEV fees, gas, priority tip, slippage, approvals if a real strategy would need them, and failure/revert cost. Deduplicate repeated alerts caused by the same underlying dislocation.

### Go/no-go gate before any money

The 72-hour run is a filter, not enough evidence by itself to fund a bot.

**GO only to a longer shadow test** if there are at least 30 independent, executable observations and the bootstrap 95% lower confidence bound of net profit at a fixed $10,000 notional is above zero **after** exact pool fees and MEV tax, one-block delay, and 2× observed gas cost, with at least 95% fork-simulation success. Otherwise it is a **NO-GO**. No mainnet capital should be used until that result repeats over a longer sample covering quiet and volatile conditions. This deliberately prevents one launch-day outlier from becoming a deployment decision.

### Honest edge check

The repository is public and its basic event subscription, AMM maths and route search are commodity infrastructure. None of those is an edge. A plausible edge could come only from:

- correctly labelling migration and allocation events before general-purpose indexers;
- transaction-ordered state reconstruction rather than end-of-block reserve comparisons;
- exact simulation of the dynamic-fee and priority-tax path;
- better pool/token risk filters and launch-history data;
- lower and more reliable observation latency;
- calibrated fill/failure probabilities rather than theoretical quote spreads.

If the paper result disappears under one-block delay, 2× gas, exact Smart Fees, or realistic failure rates, there is no demonstrated edge. The monitor can still be valuable as market telemetry, but it should not become an execution bot.

## Source and verification notes

- Local Icarus evidence: [`deployments/4153/icarus-vs-aerodrome.diff`](../../deployments/4153/icarus-vs-aerodrome.diff), plus the adjacent checked-in Icarus/Aerodrome deployment sources.
- Local chaintraxer evidence: `/Users/macbook/Desktop/projects/chaintraxer-bot/main.ts`, `src/watcher/run-watcher.ts`, `src/checker.ts`, and its Aerodrome/Slipstream adapters. No configuration values or secrets are reproduced here.
- Current Aero primary sources: [launch article](https://aero.xyz/articles/aero-launches-today/), [upgrade hub](https://aero.xyz/aero-upgrade/), [Aero Economy](https://aero.xyz/articles/the-aero-economy/), [Slipstream](https://aero.xyz/features/slipstream/), [Metaswaps](https://aero.xyz/features/metaswaps/), and [Predictive Allocation](https://aero.xyz/features/predictive-allocation/).
- Contract sources: [Dromos Labs](https://github.com/Dromos-Labs), [MetaDEX03 contracts](https://github.com/dromos-labs/metadex-public), [Slipstream contracts](https://github.com/dromos-labs/metadex-slipstream-public), [MEV-tax module](https://github.com/dromos-labs/metadex-public/blob/main/V3/src/fees/PriorityFeeMevTaxModule.sol), [dynamic-fee hook](https://github.com/dromos-labs/metadex-public/blob/main/V3/src/hooks/dynamic/DynamicSwapFeeHook.sol), and [auditor guide](https://github.com/dromos-labs/metadex-public/blob/main/audits/sherlock-contest-auditor-guide.md).
- Legacy comparison: [Aerodrome docs](https://aerodrome.finance/docs), [Velodrome docs](https://velodrome.finance/docs), [Velodrome upgrade guide](https://velodrome.finance/docs/upgrade), [Aerodrome contracts](https://github.com/aerodrome-finance/contracts), [specification](https://github.com/aerodrome-finance/contracts/blob/main/SPECIFICATION.md), and [legacy Pool](https://github.com/aerodrome-finance/contracts/blob/main/contracts/Pool.sol).
- Sandwich-measurement comparison: [ACM IMC '25 program](https://conferences.sigcomm.org/imc/2025/program/), [paper PDF](https://cnitarot.github.io/papers/imc26_solana.pdf), and [Jito transaction-send documentation](https://docs.jito.wtf/lowlatencytxnsend/).
