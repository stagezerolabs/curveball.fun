# Market keeper

A standalone Node.js worker for the active Curveball launchpad. It discovers launches and, for each market, takes the one permissionless action it needs. It needs no HTTP server.

| Market | Action |
|---|---|
| Ready (sold out) | `graduate`. Icarus's pause doesn't matter: graduation never checks it. |
| Ready past `GRADUATION_TIMEOUT`, and `graduate` would revert | `abortGraduation`, which reopens sells |
| Aborted and sold out again | `graduate` |
| Graduated, with a buyback balance and `BUYBACK_INTERVAL` elapsed | `escrow.buyback` |

A buyback that emits `BuybackSkipped` (too few TWAP observations, Icarus paused, or the price outside the band) spends nothing and doesn't start the interval, so the keeper backs off: one interval, then doubling up to six hours. Failed actions retry after a minute, doubling to the same cap.

## Run on a VPS

Install Node.js 20 or newer, then from this directory:

```bash
npm ci --omit=dev
npm start
```

Set the `KEEPER_*` environment variables in `.env.example` through your process manager. `npm start` does not load an `.env` file itself. Use a dedicated private key with native ETH for transaction fees; the keeper never needs WETH. Run **one instance** for that wallet and configure automatic restart and log monitoring. The private key must stay on the server; never use a `VITE_` variable or put it in Vercel.

`KEEPER_LAUNCHPAD_ADDRESS` and `KEEPER_DEPLOYMENT_BLOCK` must match the `launchpad` and `deploymentBlock` in `deployments/<chainId>/curveball.json`, and `KEEPER_CHAIN_ID` must be that chain. The worker scans from that block on every start so it can recover missed launches; there is no persisted cursor. Market reads run with bounded concurrency and wallet transactions run sequentially to preserve nonce order. The default interval is 10 seconds after each sweep finishes.

The worker logs submitted transaction hashes, graduations, aborts, buyback skips with their reason, and failures. It has no HTTP health endpoint or built-in alerting. Monitor the process, logs, and keeper ETH balance.

Run `npm test` to check the decision table and the sweep's retry behaviour locally.
