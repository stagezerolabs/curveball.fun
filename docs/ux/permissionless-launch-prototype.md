# Permissionless launch UX prototype

## Launch page

```text
                        Launch a token
      Anyone can create a market. Your wallet pays the network fee.

      ┌──────────────────────────────────────────────────────┐
      │ 1  Token details                                      │
      │ Token name *       [____________________________]     │
      │ Symbol *           [$ ____________]                  │
      │ Metadata URL       [____________________________]     │
      │                                                      │
      │ 2  Launch settings                                   │
      │ Creator tax        [None ▾]                          │
      │ Initial buy        [0 WETH]                          │
      │ Optional: a buy may need WETH wrap and approval.     │
      │                                                      │
      │ [Connect wallet] or [Review and create token →]      │
      └──────────────────────────────────────────────────────┘
      Creation is open to every connected wallet. No invitation.
```

The form stays centered and uses one column at every width. Required fields have labels and short examples. The primary action connects the wallet when disconnected; after connection it submits the form. It never shows an invitation status for a permissionless deployment.

## Transaction dialog

The dialog opens on a valid submit. It shows the current real stage: preparing, optional WETH wrap, optional WETH approval, wallet confirmation, transaction submitted with explorer link, on-chain confirmation, and market discovery. The user can close a failure and retry without losing form entries. After confirmation, Markets opens automatically with the new token highlighted, even if the indexer is catching up.

## Market and trade page

Any connected wallet can buy while the curve is open. A sold-out, ready, or graduated market still uses its existing trading rules. The trade panel explains a blocked buy by market state, never by invitation status. Markets lists tokens from the active factory only.
