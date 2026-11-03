# RISE ETH/USD oracle research for a $1 launch fee

Checked on 2026-11-03 against RISE mainnet (4153) and testnet (11155931).
The current launchpad charges an immutable `0.001 WETH` launch fee; this note does
not change that fee.

| Provider | Testnet | Mainnet | Finding |
| --- | --- | --- | --- |
| Stork | Contract and ETH/USD feed exist | Same | The freshness-checked getter reverts `StaleValue` on both chains. The last ETH/USD updates were 2026-08-14. |
| RedStone Pull | Chain-agnostic Solidity consumer | Same | No RISE feed contract is needed, but live signed payloads require authenticated gateway access and a private proxy. Access and live delivery on RISE remain untested. |
| Supra Pull | Contract exists; ETH/USD pair ID 19 | No RISE deployment listed or code at the testnet address | Useful for a testnet prototype, but requires a signed proof in each launch transaction. |
| Pyth, Chainlink | No official RISE feed listing found | No official RISE feed listing found | No verified turnkey ETH/USD feed on both chains. |
| DIA, Chronicle, API3 | No verified RISE feed found | No verified RISE feed found | Provider engagement or custom integration would be needed. |

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

RedStone's [Pull guide](https://docs.redstone.finance/docs/stage1-market-data/price-feeds/pull-model/)
describes signed price data appended to transaction calldata and requires
authenticated gateway keys for live payloads. Browser users would need a
secret-holding proxy. Its [production consumer](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/evm-connector/contracts/data-services/PrimaryProdDataServiceConsumerBase.sol)
verifies 3 of 5 authorized signers, and the [default verifier window](https://github.com/redstone-finance/redstone-oracles-monorepo/blob/main/packages/evm-connector/contracts/core/RedstoneDefaultsLib.sol)
allows prices up to three minutes old. This path can verify inside a custom
launchpad on either RISE chain without a predeployed oracle. We have not
tested live ETH/USD payload access; the [official EVM examples](https://github.com/redstone-finance/redstone-evm-examples)
require API keys outside mock tests. Provider terms and availability must be
confirmed.

## Proposed implementation once live data access is secured

1. Prove a fresh signed ETH/USD update on **both** RISE networks. For Stork,
   confirm subscriber access and either a funded pusher or per-interaction
   updates. For RedStone, confirm gateway access and signed payload delivery
   through a private proxy. Confirm the ongoing cost and operational owner.
2. Replace the immutable WETH launch fee with an oracle-derived quote. With an
   18-decimal positive ETH/USD price `P`, a $1 fee is `ceil(10^36 / P)` WETH wei.
   Check feed ID, timestamp, freshness, positive value, signer validity where
   applicable, and arithmetic bounds. Revert when price data is invalid or
   stale.
3. Read the fee and charge it atomically in `launch`. Expose the current quote
   and an expected-maximum-fee argument so a wallet can set a slippage bound.
   Update the SDK, launch UI, deployment configuration, and fee tests. Since
   the current fee is immutable, this requires a new launchpad deployment and
   rewiring its dependent contracts; it cannot be activated by an owner call.

The $1 fee should not be switched on using the stale Stork reads. RedStone
Pull may avoid a continuously funded onchain pusher, but its authenticated
gateway and proxy must work before deployment. A testnet-only Supra prototype
would not establish a mainnet oracle path.
