# Graduation keeper

A standalone Node.js worker for the active Curveball factory. It discovers launches, watches curves, and submits the two graduation transactions when a curve sells out. It needs no HTTP server.

## Run on a VPS

Install Node.js 20 or newer, then from this directory:

```bash
npm ci --omit=dev
npm start
```

Set the `KEEPER_*` environment variables in `.env.example` through your process manager. `npm start` does not load an `.env` file itself. Use a dedicated private key with native ETH for transaction fees. Run **one instance** for that wallet and configure automatic restart and log monitoring. The private key must stay on the server; never use a `VITE_` variable or put it in Vercel.

`KEEPER_CHAIN_ID` must be `4153`. `KEEPER_FACTORY_ADDRESS` and `KEEPER_DEPLOYMENT_BLOCK` must match `deployments/4153/curveball.json`. The worker scans from that block on every start so it can recover missed launches; there is no persisted cursor. Active market reads run with bounded concurrency and wallet transactions run sequentially to preserve nonce order. The default interval is 10 seconds after each sweep finishes. Deferred graduations retry with exponential backoff, capped at one hour.

The worker logs submitted transaction hashes, confirmed pools, venue deferrals, and failures. It has no HTTP health endpoint or built-in alerting. Monitor the process, logs, and keeper ETH balance.

Run `npm test` to check the graduation and retry flow locally. The production preflight separately exercises a complete lifecycle against Icarus on a fresh mainnet fork.
