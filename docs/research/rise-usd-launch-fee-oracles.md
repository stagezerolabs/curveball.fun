# RISE ETH/USD oracle research for a $1 launch fee

Checked on 2026-11-03 against RISE mainnet (4153) and testnet (11155931).
The current launchpad charges an immutable `0.001 WETH` launch fee; this note does
not change that fee.

| Provider | Testnet | Mainnet | Finding |
| --- | --- | --- | --- |
| Stork | Contract and ETH/USD feed exist | Same | The freshness-checked getter reverts `StaleValue` on both chains. The last ETH/USD updates were 2026-08-14. |
| Supra Pull | Contract exists; ETH/USD pair ID 19 | No RISE deployment listed or code at the testnet address | Useful for a testnet prototype, but requires a signed proof in each launch transaction. |
| Pyth, Chainlink | No official RISE feed listing found | No official RISE feed listing found | No verified turnkey ETH/USD feed on both chains. |
| RedStone, DIA, Chronicle, API3 | No verified RISE feed found | No verified RISE feed found | Provider engagement or custom integration would be needed. |

Stork's [RISE contract directory](https://docs.stork.network/resources/contract-addresses/evm)
lists `0xacC0a0cF13571d30B4b8637996F5D6D774d4fd62` on both networks.
Its [asset registry](https://docs.stork.network/resources/asset-id-registry) gives
`ETHUSD` ID `0x59102b37de83bdda9f38ac8254e596f0d9ac61d2035c07936675e87342817160`
and `WETHUSD` ID `0x8afba5f1a5d4969d23c3b42db1b88f8a9c8176392de5bf066752260478ce82b8`.
The deployed contracts report a 3,600-second feed validity period and currently
charge 1 wei per signed update, plus gas. Both feeds are stale on both chains;
the unsafe getter must not be used to price a launch.

Stork's [EVM API](https://docs.stork.network/api-reference/contract-apis/evm)
returns an 18-decimal signed USD price and a nanosecond timestamp. Fresh signed
updates require access to Stork's [authenticated API](https://docs.stork.network/api-reference/rest-api)
and a payable onchain update. The [publisher guide](https://docs.stork.network/getting-started/putting-data-on-chain)
describes a pusher or per-interaction update. Neither is currently operating
reliably for these feeds on RISE, based on their onchain timestamps.

Supra lists its [testnet pull contract](https://docs.supra.com/oracles/data-feeds/pull-oracle/networks)
at `0x391Ab9ad5C4BFee04eA508b0a0Cf499198D015e3` and [ETH/USD pair ID 19](https://docs.supra.com/oracles/data-feeds/data-feeds-index).
Its RISE mainnet counterpart is not listed. The [Pyth](https://docs.pyth.network/pro/contract-addresses)
and [Chainlink](https://docs.chain.link/data-feeds/price-feeds/addresses)
directories likewise have no verified RISE ETH/USD deployment. These are
directory findings, not claims that the providers cannot support RISE.

## Proposed implementation once a live feed is secured

1. Confirm Stork subscription, signed-update access, and a working ETH/USD
   update on **both** RISE networks. Decide whether a funded pusher or a signed
   update included in each launch transaction will keep the feed live. Confirm
   the ongoing cost and operational owner before committing to the provider.
2. Replace the immutable WETH launch fee with an oracle-derived quote. With an
   18-decimal positive ETH/USD price `P`, a $1 fee is `ceil(10^36 / P)` WETH wei.
   Check feed ID, timestamp, freshness (a stricter application limit than the
   provider's one-hour window), positive value, and arithmetic bounds. Revert
   when price data is invalid or stale.
3. Read the fee and charge it atomically in `launch`. Expose the current quote
   and an expected-maximum-fee argument so a wallet can set a slippage bound.
   Update the SDK, launch UI, deployment configuration, and fee tests. Since
   the current fee is immutable, this requires a new launchpad deployment and
   rewiring its dependent contracts; it cannot be activated by an owner call.

The $1 fee should not be switched on while both Stork feeds remain stale. A
testnet-only Supra prototype is possible but would not establish a mainnet
oracle path.
