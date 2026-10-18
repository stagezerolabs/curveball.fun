# Curveball Domain

Curveball is a social trading launchpad where onchain market activity is the source of truth and social context is attached to verified wallets and trades.

## Markets and trading

**Market**:
A token's Curveball launch and its trading lifecycle from bonding curve through graduation.
_Avoid_: Coin, pair

**Curve Trade**:
A canonical buy or sell recorded by a Curveball bonding curve before graduation.
_Avoid_: Swap, order

**Graduation**:
The irreversible transition from a sold-out bonding curve into its external liquidity venue.
_Avoid_: Migration, listing

**Curve Position**:
The portion of a wallet's token position whose quantity and cost basis can be attributed to Curve Trades.
_Avoid_: Wallet balance, total position

**Known-basis PnL**:
Profit or loss calculated only from event-ordered Curve Trades with attributable acquisition cost.
_Avoid_: Wallet PnL, total PnL

**Canonical Event**:
An indexed onchain occurrence that remains in the accepted chain after confirmation and reorg reconciliation.
_Avoid_: Confirmed transaction, log

**System Account**:
A protocol-controlled address whose activity remains part of market accounting but is not attributed to a human trader.
_Avoid_: Bot, admin wallet

## Social trading

**Trader Profile**:
The wallet-owned public identity and visibility settings attached to a trading address.
_Avoid_: User account, creator profile

**Trade Note**:
Short context authored by the wallet responsible for a specific Curve Trade.
_Avoid_: Post, comment

**Conviction**:
The single social reaction available on a Curve Trade.
_Avoid_: Like, upvote

**Copy Intent**:
An immutable request to prepare a wallet-confirmed trade from a source Curve Trade.
_Avoid_: Copy trade, automatic copy

**Copy Execution**:
The verified onchain outcome associated with a submitted Copy Intent.
_Avoid_: Copy attempt, copied order
